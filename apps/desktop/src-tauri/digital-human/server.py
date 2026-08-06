# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — FastAPI 主服务
===================================

本模块实现了数字人推理服务的 HTTP API 服务器，基于 FastAPI 框架。

提供的 API 端点：

系统端点：
  - GET  /health                 健康检查
  - GET  /system/info            返回 GPU/CPU/显存/CUDA/FFmpeg 检测信息
  - GET  /models/list            列出所有支持的模型及其安装状态
  - POST /models/download         下载指定模型
  - GET  /models/download/status  SSE 流式返回下载进度

生成端点：
  - POST /generate               生成数字人视频
  - GET  /generate/status         SSE 流式返回生成进度

TTS 端点：
  - POST /tts/synthesize          文字转语音

头像端点：
  - POST /avatar/upload           上传头像图片
  - GET  /avatar/presets          获取预设头像列表

启动流程：
  1. 初始化配置和目录
  2. 检测 GPU/CUDA 环境
  3. 检测 FFmpeg 是否可用
  4. 扫描已安装的模型
  5. 启动 FastAPI 服务器，监听 127.0.0.1:7861
"""

import asyncio
import json
import logging
import os
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

# 将当前目录加入 Python 路径，确保模块导入正确
sys.path.insert(0, str(Path(__file__).parent))

# ============================================================
# 配置和日志初始化
# ============================================================

from config import (
    SERVER, PATHS, MODEL_META, MODEL_DOWNLOADS,
    TTS, INFERENCE, PRESETS, LOGGING,
    init_environment,
)

# 配置日志
logging.basicConfig(
    level=getattr(logging, LOGGING.LEVEL.upper(), logging.INFO),
    format=LOGGING.FORMAT,
    datefmt=LOGGING.DATE_FORMAT,
)
logger = logging.getLogger("aurora.server")

# 初始化运行环境（创建目录等）
init_environment()

# ============================================================
# FastAPI 应用
# ============================================================

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from pydantic import BaseModel, Field

# 导入引擎和工具模块
from engine.registry import ModelRegistry
from tts.engine import TTSEngine
from utils.gpu import detect_gpu, get_vram_info, format_bytes
from utils.ffmpeg import FFmpegManager
from utils.download import ModelDownloader, DownloadStatus

# ============================================================
# 全局实例
# ============================================================

app = FastAPI(
    title="Aurora Digital Human Engine",
    description="自研数字人推理服务 — 不依赖任何第三方云 API",
    version="1.0.0",
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=SERVER.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局实例（延迟初始化）
_registry: Optional[ModelRegistry] = None
_tts_engine: Optional[TTSEngine] = None
_ffmpeg: Optional[FFmpegManager] = None
_downloader: Optional[ModelDownloader] = None

# 生成任务状态管理
_generation_tasks: Dict[str, dict] = {}

# 下载任务状态管理
_download_tasks: Dict[str, dict] = {}


# ============================================================
# Pydantic 请求模型
# ============================================================

class GenerateRequest(BaseModel):
    """生成数字人视频请求"""
    avatar_path: str = Field(..., description="人物图片路径")
    model_type: str = Field(
        "musetalk",
        description="模型类型: musetalk/sadtalker/wav2lip/echomimic/hallo2"
    )
    audio_source: str = Field(
        "tts",
        description="音频来源: tts（TTS 合成）或 upload（上传音频）"
    )
    tts_text: Optional[str] = Field(None, description="TTS 文字内容")
    tts_voice: Optional[str] = Field(
        "zh-CN-XiaoxiaoNeural",
        description="TTS 语音 ID（如 zh-CN-XiaoxiaoNeural）"
    )
    audio_path: Optional[str] = Field(None, description="上传的音频文件路径")
    output_resolution: int = Field(512, description="输出分辨率")
    fps: int = Field(25, description="帧率")
    enable_4k: bool = Field(False, description="是否启用 4K 超分辨率（仅 hallo2）")


class TTSRequest(BaseModel):
    """TTS 语音合成请求"""
    text: str = Field(..., description="要合成的文字内容")
    voice: str = Field("zh-CN-XiaoxiaoNeural", description="语音 ID")
    rate: Optional[str] = Field(None, description="语速，如 +50% 或 -20%")
    volume: Optional[str] = Field(None, description="音量")
    pitch: Optional[str] = Field(None, description="音调")


class ModelDownloadRequest(BaseModel):
    """模型下载请求"""
    model_type: str = Field(..., description="要下载的模型类型")


# ============================================================
# 初始化函数
# ============================================================

async def init_app():
    """初始化应用的全局实例"""
    global _registry, _tts_engine, _ffmpeg, _downloader

    logger.info("=" * 60)
    logger.info("Aurora Digital Human Engine — 正在初始化...")
    logger.info("=" * 60)

    # 检测 GPU 环境
    gpu_info = detect_gpu()
    logger.info(
        f"GPU 检测: {gpu_info['device_name']} "
        f"(CUDA: {gpu_info.get('cuda_version', 'N/A')}, "
        f"方式: {gpu_info['fallback']})"
    )
    if gpu_info["available"]:
        logger.info(
            f"显存: {format_bytes(gpu_info['vram_free'])} 可用 / "
            f"{format_bytes(gpu_info['vram_total'])} 总计"
        )

    # 检测 FFmpeg
    _ffmpeg = FFmpegManager()
    if _ffmpeg.available:
        logger.info(f"FFmpeg 已就绪: 版本 {_ffmpeg.version}")
    else:
        logger.warning("FFmpeg 未安装，视频合成功能将不可用")

    # 初始化 TTS 引擎
    _tts_engine = TTSEngine()
    if _tts_engine.available:
        logger.info(f"TTS 引擎已就绪: 默认语音 {TTS.DEFAULT_VOICE}")
    else:
        logger.warning("TTS 引擎不可用（edge-tts 未安装）")

    # 初始化模型下载器
    _downloader = ModelDownloader()
    logger.info("模型下载器已就绪")

    # 初始化模型注册表
    _registry = ModelRegistry()
    installed = _registry.get_installed_models()
    logger.info(
        f"模型注册表已就绪: "
        f"支持 {len(_registry.list_supported_models())} 个模型, "
        f"已安装 {len(installed)} 个: {installed}"
    )

    logger.info("=" * 60)
    logger.info(
        f"Aurora Digital Human Engine 已启动: "
        f"http://{SERVER.HOST}:{SERVER.PORT}"
    )
    logger.info("=" * 60)


@app.on_event("startup")
async def startup_event():
    """FastAPI 启动事件"""
    await init_app()


# ============================================================
# 系统端点
# ============================================================

@app.get("/health")
async def health_check():
    """
    健康检查端点。

    返回服务运行状态，用于监控和负载均衡器健康探测。

    Returns:
        dict: {"status": "ok", "timestamp": ...}
    """
    return {
        "status": "ok",
        "timestamp": time.time(),
        "service": "aurora-digital-human",
        "version": "1.0.0",
    }


@app.get("/system/info")
async def system_info():
    """
    系统信息端点。

    返回 GPU/CPU/显存/CUDA/FFmpeg 等环境检测信息。

    Returns:
        dict: 包含 GPU 信息、显存使用、FFmpeg 状态、已安装模型等
    """
    gpu_info = detect_gpu()
    vram = get_vram_info()

    # CPU 信息
    cpu_info = {
        "count": os.cpu_count(),
    }
    try:
        import psutil
        cpu_info["usage_percent"] = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        cpu_info["memory_total"] = mem.total
        cpu_info["memory_used"] = mem.used
        cpu_info["memory_percent"] = mem.percent
    except ImportError:
        pass

    # FFmpeg 信息
    ffmpeg_info = {
        "available": _ffmpeg.available if _ffmpeg else False,
        "version": _ffmpeg.version if _ffmpeg else None,
        "path": _ffmpeg.ffmpeg_path if _ffmpeg else None,
    }

    # 模型信息
    models_info = []
    if _registry:
        models_info = _registry.get_all_models_info()

    return {
        "gpu": {
            "available": gpu_info["available"],
            "device_name": gpu_info["device_name"],
            "vram_total": gpu_info["vram_total"],
            "vram_free": gpu_info["vram_free"],
            "vram_used": gpu_info["vram_used"],
            "vram_total_formatted": format_bytes(gpu_info["vram_total"]),
            "vram_free_formatted": format_bytes(gpu_info["vram_free"]),
            "vram_used_formatted": format_bytes(gpu_info["vram_used"]),
            "cuda_version": gpu_info.get("cuda_version"),
            "torch_version": gpu_info.get("torch_version"),
            "device_count": gpu_info.get("device_count", 0),
            "fallback": gpu_info["fallback"],
        },
        "vram_realtime": {
            "total": vram["total"],
            "free": vram["free"],
            "used": vram["used"],
            "total_formatted": format_bytes(vram["total"]),
            "free_formatted": format_bytes(vram["free"]),
            "used_formatted": format_bytes(vram["used"]),
        },
        "cpu": cpu_info,
        "ffmpeg": ffmpeg_info,
        "tts": {
            "available": _tts_engine.available if _tts_engine else False,
            "default_voice": TTS.DEFAULT_VOICE,
        },
        "models": {
            "supported": _registry.list_supported_models() if _registry else [],
            "installed": _registry.get_installed_models() if _registry else [],
            "current": _registry.get_current_model() if _registry else None,
        },
        "paths": {
            "models_dir": str(PATHS.MODELS_DIR),
            "output_dir": str(PATHS.OUTPUT_DIR),
            "upload_dir": str(PATHS.UPLOAD_DIR),
        },
    }


# ============================================================
# 模型管理端点
# ============================================================

@app.get("/models/list")
async def list_models():
    """
    列出所有支持的模型及其安装状态。

    Returns:
        dict: 包含模型列表和注册表状态
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    models = _registry.get_all_models_info()

    return {
        "models": models,
        "supported_count": len(models),
        "installed_count": len([m for m in models if m.get("installed")]),
        "current_model": _registry.get_current_model(),
        "vram_usage": _registry.get_vram_usage(),
    }


@app.post("/models/download")
async def download_model(request: ModelDownloadRequest, background_tasks: BackgroundTasks):
    """
    下载指定模型。

    在后台启动模型下载任务，返回任务 ID。
    可通过 /models/download/status 端点以 SSE 方式获取下载进度。

    Args:
        request: 包含 model_type 的请求体

    Returns:
        dict: 包含任务 ID 和初始状态
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    model_type = request.model_type

    if not _registry.is_supported(model_type):
        raise HTTPException(
            status_code=400,
            detail=f"不支持的模型类型: {model_type}. "
                   f"支持的类型: {_registry.list_supported_models()}"
        )

    # 检查是否已安装
    info = _registry.get_model_info(model_type)
    if info and info.get("installed"):
        return {
            "task_id": None,
            "model_type": model_type,
            "status": "already_installed",
            "message": f"模型 {model_type} 已安装，无需重复下载",
        }

    # 生成任务 ID
    task_id = f"download_{model_type}_{int(time.time())}"

    # 创建下载任务
    download_task = _downloader.create_task(model_type)

    # 记录任务状态
    _download_tasks[task_id] = {
        "task_id": task_id,
        "model_type": model_type,
        "status": "pending",
        "progress": 0.0,
        "message": "等待开始下载...",
        "download_task": download_task,
        "created_at": time.time(),
        "updated_at": time.time(),
    }

    # 在后台启动下载
    background_tasks.add_task(_run_download, task_id, model_type)

    return {
        "task_id": task_id,
        "model_type": model_type,
        "status": "pending",
        "message": f"开始下载模型 {model_type}",
        "status_endpoint": f"/models/download/status?task_id={task_id}",
    }


async def _run_download(task_id: str, model_type: str):
    """
    后台执行模型下载任务。

    Args:
        task_id: 任务 ID
        model_type: 模型类型
    """
    task_info = _download_tasks.get(task_id)
    if task_info is None:
        return

    download_task = task_info["download_task"]

    def on_progress(t):
        """下载进度回调"""
        task_info["status"] = t.status.value
        task_info["progress"] = t.progress.progress
        task_info["message"] = (
            f"正在下载 {t.progress.filename}: "
            f"{t.progress.progress:.1f}% "
            f"({format_bytes(t.progress.downloaded_bytes)}/"
            f"{format_bytes(t.progress.total_bytes)}) "
            f"速度: {format_bytes(int(t.progress.speed_bytes_per_sec))}/s"
        )
        task_info["updated_at"] = time.time()

    try:
        task_info["status"] = "downloading"
        task_info["message"] = "开始下载..."
        task_info["updated_at"] = time.time()

        # 获取模型实例并执行下载
        model = await _registry._get_or_create_model(model_type)
        await model.download(progress_callback=on_progress)

        task_info["status"] = "completed"
        task_info["progress"] = 100.0
        task_info["message"] = f"模型 {model_type} 下载完成"
        task_info["updated_at"] = time.time()

        logger.info(f"下载任务完成: {task_id}")

    except Exception as e:
        task_info["status"] = "failed"
        task_info["message"] = f"下载失败: {str(e)}"
        task_info["updated_at"] = time.time()
        logger.error(f"下载任务失败: {task_id} - {e}")


@app.get("/models/download/status")
async def download_status(task_id: str):
    """
    SSE 流式返回下载进度。

    通过 Server-Sent Events 实时推送下载进度信息。
    客户端可以使用 EventSource API 接收事件。

    Args:
        task_id: 下载任务 ID

    Returns:
        StreamingResponse: SSE 事件流
    """
    if task_id not in _download_tasks:
        raise HTTPException(status_code=404, detail=f"下载任务不存在: {task_id}")

    async def event_stream():
        """SSE 事件流生成器"""
        while True:
            task_info = _download_tasks.get(task_id)
            if task_info is None:
                yield f"data: {json.dumps({'error': '任务不存在'})}\n\n"
                break

            # 构建状态数据
            data = {
                "task_id": task_id,
                "model_type": task_info["model_type"],
                "status": task_info["status"],
                "progress": task_info["progress"],
                "message": task_info["message"],
                "timestamp": time.time(),
            }

            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

            # 如果任务已完成或失败，发送结束事件并退出
            if task_info["status"] in ("completed", "failed"):
                yield f"data: {json.dumps({'event': 'done', 'status': task_info['status']})}\n\n"
                break

            # 等待一段时间再发送下一次更新
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# 生成端点
# ============================================================

@app.post("/generate")
async def generate_video(request: GenerateRequest, background_tasks: BackgroundTasks):
    """
    生成数字人视频。

    接收生成参数，在后台启动视频生成任务，返回任务 ID。
    可通过 /generate/status 端点以 SSE 方式获取生成进度。

    Args:
        request: 生成请求参数
        background_tasks: FastAPI 后台任务

    Returns:
        dict: 包含任务 ID 和初始状态
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    # 验证模型类型
    if not _registry.is_supported(request.model_type):
        raise HTTPException(
            status_code=400,
            detail=f"不支持的模型类型: {request.model_type}. "
                   f"支持的类型: {_registry.list_supported_models()}"
        )

    # 验证模型是否已安装
    info = _registry.get_model_info(request.model_type)
    if not info or not info.get("installed"):
        raise HTTPException(
            status_code=400,
            detail=f"模型 {request.model_type} 未安装，请先下载模型"
        )

    # 验证头像图片
    if not Path(request.avatar_path).exists():
        raise HTTPException(
            status_code=400,
            detail=f"头像图片不存在: {request.avatar_path}"
        )

    # 验证音频来源
    if request.audio_source == "tts":
        if not request.tts_text or not request.tts_text.strip():
            raise HTTPException(
                status_code=400,
                detail="audio_source 为 tts 时，tts_text 不能为空"
            )
    elif request.audio_source == "upload":
        if not request.audio_path or not Path(request.audio_path).exists():
            raise HTTPException(
                status_code=400,
                detail="audio_source 为 upload 时，audio_path 必须指向存在的音频文件"
            )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的音频来源: {request.audio_source}. 支持: tts, upload"
        )

    # 生成任务 ID
    task_id = f"gen_{request.model_type}_{uuid.uuid4().hex[:8]}"

    # 生成输出路径
    output_filename = f"{task_id}.mp4"
    output_path = str(PATHS.OUTPUT_DIR / output_filename)

    # 记录任务状态
    _generation_tasks[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "progress": 0,
        "message": "任务已创建，等待开始...",
        "logs": [],
        "output_path": output_path,
        "model_type": request.model_type,
        "created_at": time.time(),
        "updated_at": time.time(),
        "error": None,
    }

    # 在后台启动生成任务
    background_tasks.add_task(
        _run_generation,
        task_id,
        request.dict(),
        output_path,
    )

    return {
        "task_id": task_id,
        "status": "pending",
        "message": "视频生成任务已创建",
        "output_path": output_path,
        "status_endpoint": f"/generate/status?task_id={task_id}",
    }


async def _run_generation(task_id: str, params: dict, output_path: str):
    """
    后台执行视频生成任务。

    Args:
        task_id: 任务 ID
        params: 生成参数
        output_path: 输出视频路径
    """
    task_info = _generation_tasks.get(task_id)
    if task_info is None:
        return

    def progress_callback(progress: int, message: str):
        """生成进度回调"""
        task_info["progress"] = progress
        task_info["message"] = message
        task_info["logs"].append({
            "timestamp": time.time(),
            "progress": progress,
            "message": message,
        })
        task_info["updated_at"] = time.time()
        # 限制日志数量
        if len(task_info["logs"]) > 200:
            task_info["logs"] = task_info["logs"][-100:]

    try:
        task_info["status"] = "running"
        task_info["message"] = "正在准备生成..."
        task_info["updated_at"] = time.time()

        logger.info(f"生成任务开始: {task_id}, 模型: {params['model_type']}")

        # 步骤 1: 准备音频
        audio_path = params.get("audio_path")

        if params["audio_source"] == "tts":
            # TTS 合成音频
            progress_callback(1, "正在合成 TTS 语音...")

            if not _tts_engine or not _tts_engine.available:
                raise RuntimeError("TTS 引擎不可用，请安装 edge-tts")

            tts_result = await _tts_engine.synthesize_to_temp(
                text=params["tts_text"],
                voice=params.get("tts_voice") or TTS.DEFAULT_VOICE,
            )
            audio_path = tts_result["path"]
            progress_callback(
                5,
                f"TTS 合成完成: 时长 {tts_result['duration']:.1f}s"
            )

        if not audio_path or not Path(audio_path).exists():
            raise RuntimeError(f"音频文件不存在: {audio_path}")

        # 步骤 2: 获取模型并生成视频
        progress_callback(8, f"正在加载模型 {params['model_type']}...")
        model = await _registry.get_model(params["model_type"])

        progress_callback(10, "模型加载完成，开始生成视频...")

        # 构建生成参数
        generate_kwargs = {
            "fps": params.get("fps", INFERENCE.DEFAULT_FPS),
            "resolution": params.get("output_resolution", INFERENCE.DEFAULT_RESOLUTION),
        }

        # hallo2 特有参数
        if params["model_type"] == "hallo2":
            generate_kwargs["enable_4k"] = params.get("enable_4k", False)

        # 调用模型生成
        result_path = await model.generate(
            image_path=params["avatar_path"],
            audio_path=audio_path,
            output_path=output_path,
            progress_callback=progress_callback,
            **generate_kwargs,
        )

        # 更新任务状态
        task_info["status"] = "completed"
        task_info["progress"] = 100
        task_info["message"] = "视频生成完成"
        task_info["output_path"] = result_path
        task_info["updated_at"] = time.time()

        logger.info(f"生成任务完成: {task_id}, 输出: {result_path}")

    except Exception as e:
        task_info["status"] = "failed"
        task_info["error"] = str(e)
        task_info["message"] = f"生成失败: {str(e)}"
        task_info["updated_at"] = time.time()
        logger.error(f"生成任务失败: {task_id} - {e}", exc_info=True)


@app.get("/generate/status")
async def generation_status(task_id: str):
    """
    SSE 流式返回生成进度。

    通过 Server-Sent Events 实时推送视频生成进度信息。
    每条事件包含 progress (0-100)、message 和 logs。

    Args:
        task_id: 生成任务 ID

    Returns:
        StreamingResponse: SSE 事件流
    """
    if task_id not in _generation_tasks:
        raise HTTPException(status_code=404, detail=f"生成任务不存在: {task_id}")

    async def event_stream():
        """SSE 事件流生成器"""
        last_log_count = 0

        while True:
            task_info = _generation_tasks.get(task_id)
            if task_info is None:
                yield f"data: {json.dumps({'error': '任务不存在'})}\n\n"
                break

            # 获取新增的日志
            current_logs = task_info.get("logs", [])
            new_logs = current_logs[last_log_count:]
            last_log_count = len(current_logs)

            # 构建状态数据
            data = {
                "task_id": task_id,
                "status": task_info["status"],
                "progress": task_info["progress"],
                "message": task_info["message"],
                "logs": new_logs,
                "output_path": task_info.get("output_path"),
                "error": task_info.get("error"),
                "timestamp": time.time(),
            }

            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

            # 如果任务已完成或失败，发送结束事件并退出
            if task_info["status"] in ("completed", "failed"):
                yield f"data: {json.dumps({'event': 'done', 'status': task_info['status']})}\n\n"

                # 如果已完成，发送输出文件信息
                if task_info["status"] == "completed":
                    final_data = {
                        "event": "result",
                        "output_path": task_info.get("output_path"),
                        "download_url": f"/generate/download?task_id={task_id}",
                    }
                    yield f"data: {json.dumps(final_data, ensure_ascii=False)}\n\n"
                break

            # 等待一段时间再发送下一次更新
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/generate/download")
async def download_video(task_id: str):
    """
    下载生成的视频文件。

    Args:
        task_id: 生成任务 ID

    Returns:
        FileResponse: 视频文件
    """
    if task_id not in _generation_tasks:
        raise HTTPException(status_code=404, detail=f"生成任务不存在: {task_id}")

    task_info = _generation_tasks[task_id]
    if task_info["status"] != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"任务未完成，当前状态: {task_info['status']}"
        )

    output_path = task_info.get("output_path")
    if not output_path or not Path(output_path).exists():
        raise HTTPException(status_code=404, detail="输出文件不存在")

    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=Path(output_path).name,
    )


# ============================================================
# TTS 端点
# ============================================================

@app.post("/tts/synthesize")
async def tts_synthesize(request: TTSRequest):
    """
    文字转语音。

    将文字合成为语音文件，返回音频文件路径和时长。

    Args:
        request: TTS 请求参数

    Returns:
        dict: 包含音频文件路径、时长、采样率等信息
    """
    if not _tts_engine or not _tts_engine.available:
        raise HTTPException(
            status_code=503,
            detail="TTS 引擎不可用，请安装 edge-tts: pip install edge-tts"
        )

    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="合成文字不能为空")

    try:
        result = await _tts_engine.synthesize_to_temp(
            text=request.text,
            voice=request.voice,
            rate=request.rate,
            volume=request.volume,
            pitch=request.pitch,
        )

        return {
            "success": True,
            "path": result["path"],
            "duration": result["duration"],
            "sample_rate": result["sample_rate"],
            "voice": result["voice"],
            "text": request.text,
        }

    except Exception as e:
        logger.error(f"TTS 合成失败: {e}")
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")


@app.get("/tts/voices")
async def list_tts_voices(language: Optional[str] = None):
    """
    列出可用的 TTS 语音。

    Args:
        language: 语言代码（如 zh, en, ja, ko），None 返回全部

    Returns:
        dict: 语音列表
    """
    if not _tts_engine:
        raise HTTPException(status_code=503, detail="TTS 引擎尚未初始化")

    voices = _tts_engine.list_voices(language)

    return {
        "voices": voices,
        "count": len(voices),
        "language": language,
    }


# ============================================================
# 头像端点
# ============================================================

@app.post("/avatar/upload")
async def upload_avatar(file: UploadFile = File(...)):
    """
    上传头像图片。

    接收上传的图片文件，保存到上传目录，返回文件路径。

    Args:
        file: 上传的图片文件

    Returns:
        dict: 包含文件路径和基本信息
    """
    # 验证文件类型
    allowed_types = {
        "image/jpeg", "image/png", "image/webp", "image/bmp",
    }
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file.content_type}. "
                   f"支持的类型: {', '.join(allowed_types)}"
        )

    # 验证文件大小
    content = await file.read()
    if len(content) > SERVER.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"文件大小超过限制: {SERVER.MAX_UPLOAD_SIZE_MB}MB"
        )

    # 生成文件名
    ext = Path(file.filename).suffix if file.filename else ".png"
    filename = f"avatar_{uuid.uuid4().hex[:12]}{ext}"
    file_path = PATHS.UPLOAD_DIR / filename

    # 保存文件
    with open(file_path, "wb") as f:
        f.write(content)

    logger.info(f"头像已上传: {file_path}")

    return {
        "success": True,
        "path": str(file_path),
        "filename": filename,
        "original_name": file.filename,
        "size": len(content),
        "size_formatted": format_bytes(len(content)),
    }


@app.get("/avatar/presets")
async def list_avatar_presets():
    """
    获取预设头像列表。

    返回内置的预设头像信息。预设头像图片存储在 PRESETS_DIR 目录。

    Returns:
        dict: 预设头像列表
    """
    presets = []

    for preset in PRESETS.PRESETS:
        # 检查预设头像图片是否存在
        image_path = PATHS.PRESETS_DIR / f"{preset['id']}.png"
        image_exists = image_path.exists()

        preset_info = {
            "id": preset["id"],
            "name": preset["name"],
            "gender": preset["gender"],
            "style": preset["style"],
            "available": image_exists,
        }

        if image_exists:
            preset_info["path"] = str(image_path)
            preset_info["url"] = f"/avatar/presets/{preset['id']}"

        presets.append(preset_info)

    return {
        "presets": presets,
        "count": len(presets),
        "available_count": len([p for p in presets if p["available"]]),
    }


@app.get("/avatar/presets/{preset_id}")
async def get_preset_avatar(preset_id: str):
    """
    获取预设头像图片。

    Args:
        preset_id: 预设头像 ID

    Returns:
        FileResponse: 头像图片文件
    """
    # 验证预设 ID 是否有效
    valid_ids = [p["id"] for p in PRESETS.PRESETS]
    if preset_id not in valid_ids:
        raise HTTPException(status_code=404, detail=f"预设头像不存在: {preset_id}")

    # 查找图片文件
    for ext in [".png", ".jpg", ".jpeg", ".webp"]:
        image_path = PATHS.PRESETS_DIR / f"{preset_id}{ext}"
        if image_path.exists():
            return FileResponse(
                path=str(image_path),
                media_type=f"image/{ext[1:]}",
                filename=image_path.name,
            )

    raise HTTPException(
        status_code=404,
        detail=f"预设头像图片文件不存在: {preset_id}"
    )


# ============================================================
# 管理端点
# ============================================================

@app.post("/models/unload")
async def unload_model(model_type: str):
    """
    卸载指定模型，释放显存。

    Args:
        model_type: 模型类型

    Returns:
        dict: 操作结果
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    if not _registry.is_supported(model_type):
        raise HTTPException(status_code=400, detail=f"不支持的模型类型: {model_type}")

    await _registry.unload_model(model_type)

    return {
        "success": True,
        "message": f"模型 {model_type} 已卸载",
        "vram_usage": _registry.get_vram_usage(),
    }


@app.post("/models/unload_all")
async def unload_all_models():
    """
    卸载所有模型，释放全部显存。

    Returns:
        dict: 操作结果
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    await _registry.unload_all()

    return {
        "success": True,
        "message": "所有模型已卸载",
        "vram_usage": _registry.get_vram_usage(),
    }


@app.post("/models/preload")
async def preload_model(model_type: str):
    """
    预加载模型到显存。

    在不生成视频的情况下，提前将模型加载到显存。

    Args:
        model_type: 模型类型

    Returns:
        dict: 操作结果
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    if not _registry.is_supported(model_type):
        raise HTTPException(status_code=400, detail=f"不支持的模型类型: {model_type}")

    info = _registry.get_model_info(model_type)
    if not info or not info.get("installed"):
        raise HTTPException(
            status_code=400,
            detail=f"模型 {model_type} 未安装，请先下载"
        )

    await _registry.preload_model(model_type)

    return {
        "success": True,
        "message": f"模型 {model_type} 预加载完成",
        "current_model": _registry.get_current_model(),
        "vram_usage": _registry.get_vram_usage(),
    }


@app.get("/registry/status")
async def registry_status():
    """
    获取模型注册表的完整状态。

    Returns:
        dict: 注册表状态信息
    """
    if not _registry:
        raise HTTPException(status_code=503, detail="模型注册表尚未初始化")

    return _registry.get_status()


# ============================================================
# 自研编排管线端点
# ============================================================

# 管线编排器实例
_pipeline_orchestrator: Optional[Any] = None

# 管线任务状态（用于 SSE 推送）
_pipeline_tasks: Dict[str, dict] = {}

# 云端提供商配置存储
_cloud_provider_configs: Dict[str, Dict[str, Any]] = {}


class PipelineRunRequest(BaseModel):
    """启动管线请求"""
    script: str = Field(..., description="脚本文案")
    avatar_path: str = Field(..., description="人物图片路径")
    voice: str = Field("zh-CN-XiaoxiaoNeural", description="TTS 语音 ID")
    tts_rate: str = Field("+0%", description="TTS 语速")
    tts_volume: str = Field("+0%", description="TTS 音量")
    tts_pitch: str = Field("+0%", description="TTS 音调")

    # 云端配置
    provider_id: str = Field("aliyun_wan", description="云端提供商 ID")
    model_name: str = Field("emo", description="模型名称")
    resolution: str = Field("480p", description="输出分辨率")

    # 文案优化
    enable_script_optimization: bool = Field(True, description="是否启用 LLM 文案优化")
    script_style: str = Field("natural", description="优化风格")
    llm_api_key: str = Field("", description="LLM API Key（用于文案优化）")

    # 后处理
    add_watermark: bool = Field(False, description="添加水印")
    add_subtitles: bool = Field(False, description="添加字幕")

    # 额外参数
    extra_params: Dict[str, Any] = Field(default_factory=dict, description="额外参数")


class CloudConfigureRequest(BaseModel):
    """配置云端提供商请求"""
    provider_id: str = Field(..., description="提供商 ID")
    config: Dict[str, Any] = Field(..., description="提供商配置")


@app.post("/pipeline/run")
async def pipeline_run(request: PipelineRunRequest, background_tasks: BackgroundTasks):
    """
    启动自研编排管线。

    完整流程：
      Stage 1: LLM 文案优化
      Stage 2: TTS 语音合成
      Stage 3: 形象图片处理
      Stage 4: 云端视频合成
      Stage 5: 后处理（下载/字幕/水印）

    返回任务 ID，可通过 /pipeline/status 获取实时进度。
    """
    global _pipeline_orchestrator

    # 验证输入
    if not request.script or not request.script.strip():
        raise HTTPException(status_code=400, detail="脚本文案不能为空")

    if not request.avatar_path or not Path(request.avatar_path).exists():
        raise HTTPException(status_code=400, detail=f"人物图片不存在: {request.avatar_path}")

    # 获取或创建云端提供商
    from cloud.base import CloudProviderFactory

    provider_config = _cloud_provider_configs.get(request.provider_id, {})
    provider = CloudProviderFactory.create(request.provider_id, provider_config)

    if not provider:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的提供商: {request.provider_id}"
        )

    if not provider.validate_config():
        raise HTTPException(
            status_code=400,
            detail=f"提供商 {provider.PROVIDER_NAME} 配置无效，请先配置 API Key"
        )

    # 创建管线配置
    from pipeline import PipelineConfig, PipelineOrchestrator, ScriptOptimizer

    config = PipelineConfig(
        enable_script_optimization=request.enable_script_optimization,
        script_style=request.script_style,
        provider_id=request.provider_id,
        model_name=request.model_name,
        resolution=request.resolution,
        add_watermark=request.add_watermark,
        add_subtitles=request.add_subtitles,
        llm_api_key=request.llm_api_key,
    )

    # 创建文案优化器（如果启用）
    script_optimizer = None
    if request.enable_script_optimization and request.llm_api_key:
        script_optimizer = ScriptOptimizer(
            backend="qwen",
            api_key=request.llm_api_key,
        )

    # 创建编排器
    _pipeline_orchestrator = PipelineOrchestrator(
        config=config,
        tts_engine=_tts_engine,
        cloud_provider=provider,
        script_optimizer=script_optimizer,
    )

    # 生成任务 ID
    task_id = f"pipe_{uuid.uuid4().hex[:12]}"

    # 记录任务状态
    _pipeline_tasks[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "global_progress": 0,
        "current_stage": "",
        "message": "管线任务已创建，等待启动...",
        "stage_history": [],
        "result": None,
        "error": None,
        "created_at": time.time(),
    }

    # 在后台运行管线
    background_tasks.add_task(
        _run_pipeline,
        task_id,
        request,
    )

    return {
        "task_id": task_id,
        "status": "pending",
        "message": "管线任务已创建",
        "stages": [
            {"name": "script_optimization", "description": "文案优化", "weight": 10},
            {"name": "tts_synthesis", "description": "语音合成", "weight": 15},
            {"name": "avatar_processing", "description": "形象处理", "weight": 5},
            {"name": "cloud_synthesis", "description": "云端视频合成", "weight": 60},
            {"name": "post_processing", "description": "后处理", "weight": 10},
        ],
        "status_endpoint": f"/pipeline/status?task_id={task_id}",
    }


async def _run_pipeline(task_id: str, request: PipelineRunRequest):
    """后台执行管线任务"""
    task_info = _pipeline_tasks.get(task_id)
    if task_info is None:
        return

    def progress_cb(stage_name: str, stage_progress: int, message: str):
        """管线进度回调"""
        task_info["current_stage"] = stage_name
        task_info["message"] = message
        task_info["status"] = "running"
        task_info["updated_at"] = time.time()

        # 记录阶段历史
        task_info["stage_history"].append({
            "stage": stage_name,
            "progress": stage_progress,
            "message": message,
            "timestamp": time.time(),
        })

        # 限制历史记录数量
        if len(task_info["stage_history"]) > 500:
            task_info["stage_history"] = task_info["stage_history"][-200:]

    try:
        # 运行管线
        result = await _pipeline_orchestrator.run(
            script=request.script,
            avatar_path=request.avatar_path,
            voice=request.voice,
            tts_rate=request.tts_rate,
            tts_volume=request.tts_volume,
            tts_pitch=request.tts_pitch,
            extra_params=request.extra_params,
            progress_cb=progress_cb,
        )

        task_info["status"] = "completed" if result.success else "failed"
        task_info["result"] = result.to_dict()
        task_info["error"] = result.error if not result.success else None
        task_info["global_progress"] = 100 if result.success else 0
        task_info["updated_at"] = time.time()

        logger.info(f"管线任务完成: {task_id}, success={result.success}")

    except Exception as e:
        task_info["status"] = "failed"
        task_info["error"] = str(e)
        task_info["message"] = f"管线执行失败: {e}"
        task_info["updated_at"] = time.time()
        logger.error(f"管线任务失败: {task_id} - {e}", exc_info=True)


@app.get("/pipeline/status")
async def pipeline_status(task_id: str):
    """
    SSE 流式返回管线执行进度。

    每条事件包含：
      - global_progress: 0-100 全局进度
      - current_stage: 当前阶段名称
      - message: 进度描述
      - stage_history: 阶段历史记录
    """
    if task_id not in _pipeline_tasks:
        raise HTTPException(status_code=404, detail=f"管线任务不存在: {task_id}")

    async def event_stream():
        last_history_count = 0

        while True:
            task_info = _pipeline_tasks.get(task_id)
            if task_info is None:
                yield f"data: {json.dumps({'error': '任务不存在'})}\n\n"
                break

            # 获取新增的阶段历史
            current_history = task_info.get("stage_history", [])
            new_history = current_history[last_history_count:]
            last_history_count = len(current_history)

            data = {
                "task_id": task_id,
                "status": task_info["status"],
                "global_progress": task_info.get("global_progress", 0),
                "current_stage": task_info.get("current_stage", ""),
                "message": task_info.get("message", ""),
                "new_events": new_history,
                "timestamp": time.time(),
            }

            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

            # 任务结束
            if task_info["status"] in ("completed", "failed"):
                # 发送最终结果
                final_data = {
                    "event": "done",
                    "status": task_info["status"],
                    "result": task_info.get("result"),
                    "error": task_info.get("error"),
                }
                yield f"data: {json.dumps(final_data, ensure_ascii=False)}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/pipeline/cancel")
async def pipeline_cancel(task_id: str):
    """取消管线任务"""
    if task_id not in _pipeline_tasks:
        raise HTTPException(status_code=404, detail=f"管线任务不存在: {task_id}")

    if _pipeline_orchestrator:
        _pipeline_orchestrator.cancel(task_id)

    _pipeline_tasks[task_id]["status"] = "cancelled"
    _pipeline_tasks[task_id]["message"] = "任务已取消"

    return {"success": True, "message": "任务已取消"}


# ============================================================
# 云端提供商管理端点
# ============================================================

@app.get("/cloud/providers")
async def list_cloud_providers():
    """
    列出所有可用的云端提供商及其配置状态。
    """
    from cloud.base import CloudProviderFactory

    provider_ids = CloudProviderFactory.list_providers()
    providers = []

    for pid in provider_ids:
        config = _cloud_provider_configs.get(pid, {})
        provider = CloudProviderFactory.create(pid, config)

        if provider:
            providers.append({
                "id": provider.PROVIDER_ID,
                "name": provider.PROVIDER_NAME,
                "requires_api_key": provider.REQUIRES_API_KEY,
                "china_available": provider.CHINA_AVAILABLE,
                "docs_url": provider.DOCS_URL,
                "configured": provider.validate_config(),
                "models": provider.get_models(),
            })

    return {
        "providers": providers,
        "count": len(providers),
        "configured_count": len([p for p in providers if p["configured"]]),
    }


@app.post("/cloud/configure")
async def configure_cloud_provider(request: CloudConfigureRequest):
    """
    配置云端提供商的 API Key 等参数。
    """
    from cloud.base import CloudProviderFactory

    provider = CloudProviderFactory.create(request.provider_id, request.config)
    if not provider:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的提供商: {request.provider_id}"
        )

    # 验证配置
    if not provider.validate_config():
        raise HTTPException(
            status_code=400,
            detail=f"配置无效，请检查必填字段"
        )

    # 保存配置
    _cloud_provider_configs[request.provider_id] = request.config

    logger.info(f"云端提供商已配置: {request.provider_id}")

    return {
        "success": True,
        "provider_id": request.provider_id,
        "provider_name": provider.PROVIDER_NAME,
        "message": f"{provider.PROVIDER_NAME} 配置成功",
    }


@app.get("/cloud/models")
async def list_cloud_models(provider_id: str):
    """
    获取指定提供商支持的模型列表。
    """
    from cloud.base import CloudProviderFactory

    config = _cloud_provider_configs.get(provider_id, {})
    provider = CloudProviderFactory.create(provider_id, config)

    if not provider:
        raise HTTPException(status_code=400, detail=f"不支持的提供商: {provider_id}")

    return {
        "provider_id": provider_id,
        "provider_name": provider.PROVIDER_NAME,
        "models": provider.get_models(),
    }


@app.get("/cloud/estimate")
async def estimate_cloud_cost(
    provider_id: str,
    model_name: str,
    duration_seconds: float = 30.0,
):
    """
    估算云端生成费用。
    """
    from cloud.base import CloudProviderFactory

    config = _cloud_provider_configs.get(provider_id, {})
    provider = CloudProviderFactory.create(provider_id, config)

    if not provider:
        raise HTTPException(status_code=400, detail=f"不支持的提供商: {provider_id}")

    estimate = provider.estimate_cost(duration_seconds, model_name)

    return {
        "provider_id": provider_id,
        "model_name": model_name,
        "duration_seconds": duration_seconds,
        "cost": estimate["cost"],
        "currency": estimate["currency"],
        "detail": estimate["detail"],
    }


# ============================================================
# 文案优化端点
# ============================================================

class ScriptOptimizeRequest(BaseModel):
    """文案优化请求"""
    text: str = Field(..., description="原始文案")
    style: str = Field("natural", description="优化风格")
    api_key: str = Field("", description="LLM API Key")
    backend: str = Field("qwen", description="LLM 后端")
    model: str = Field("", description="模型名称")


@app.post("/script/optimize")
async def optimize_script(request: ScriptOptimizeRequest):
    """
    使用 LLM 优化脚本文案。

    支持 5 种风格：自然流畅、专业正式、热情活泼、温和叙事、新闻播报。
    """
    from pipeline import ScriptOptimizer

    if not request.api_key and request.backend != "ollama":
        raise HTTPException(status_code=400, detail="需要提供 API Key")

    optimizer = ScriptOptimizer(
        backend=request.backend,
        api_key=request.api_key,
        model=request.model,
    )

    try:
        optimized = await optimizer.optimize(
            text=request.text,
            style=request.style,
        )

        return {
            "success": True,
            "original_text": request.text,
            "optimized_text": optimized,
            "original_length": len(request.text),
            "optimized_length": len(optimized),
            "style": request.style,
        }

    except Exception as e:
        logger.error(f"文案优化失败: {e}")
        raise HTTPException(status_code=500, detail=f"文案优化失败: {str(e)}")


@app.get("/script/styles")
async def list_script_styles():
    """
    获取所有可用的文案优化风格。
    """
    from pipeline import ScriptOptimizer

    optimizer = ScriptOptimizer(backend="qwen", api_key="")
    styles = optimizer.get_styles()

    return {
        "styles": styles,
        "count": len(styles),
    }


# ============================================================
# 主入口
# ============================================================

def main():
    """
    主函数：启动 FastAPI 服务器。

    使用 uvicorn 作为 ASGI 服务器，监听 127.0.0.1:7861。
    """
    import uvicorn

    logger.info("启动 Aurora Digital Human Engine 服务器...")
    logger.info(f"监听地址: http://{SERVER.HOST}:{SERVER.PORT}")

    uvicorn.run(
        app,
        host=SERVER.HOST,
        port=SERVER.PORT,
        workers=SERVER.WORKERS,
        log_level="info",
    )


if __name__ == "__main__":
    main()
