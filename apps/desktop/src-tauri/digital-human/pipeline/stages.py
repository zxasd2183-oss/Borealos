# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 管线阶段定义
=================================

定义管线中每个阶段的抽象基类和具体实现。

每个阶段：
  - 接收上一阶段的输出和共享上下文
  - 执行自己的逻辑（可能调用云端模型）
  - 返回阶段结果和更新后的上下文
  - 支持进度回调

阶段设计为可独立替换：
  - 不满意某个阶段的效果？替换实现即可
  - 不需要某个阶段？设置 skip=True 即可跳过
  - 想加新阶段？继承 PipelineStage 实现即可
"""

import asyncio
import logging
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("aurora.pipeline.stages")


# ============================================================
# 阶段状态枚举
# ============================================================

class StageStatus(Enum):
    """阶段执行状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    FAILED = "failed"


# ============================================================
# 阶段上下文
# ============================================================

@dataclass
class StageContext:
    """
    管线共享上下文。

    所有阶段共享此上下文对象，用于传递中间结果。
    每个阶段从上下文中读取输入，将输出写入上下文。
    """
    # 原始输入
    original_script: str = ""               # 用户输入的原始脚本文案
    avatar_path: str = ""                   # 用户选择的人物图片路径
    voice: str = "zh-CN-XiaoxiaoNeural"     # TTS 语音 ID
    tts_rate: str = "+0%"                   # TTS 语速
    tts_volume: str = "+0%"                 # TTS 音量
    tts_pitch: str = "+0%"                  # TTS 音调

    # 云端配置
    provider_id: str = ""                   # 云端提供商 ID
    model_name: str = ""                    # 模型名称
    resolution: str = "480p"               # 输出分辨率
    extra_params: Dict[str, Any] = field(default_factory=dict)

    # 中间产物
    optimized_script: str = ""              # Stage 1 输出：优化后的文案
    audio_path: str = ""                    # Stage 2 输出：TTS 生成的音频路径
    audio_duration: float = 0.0             # 音频时长（秒）
    processed_avatar_path: str = ""         # Stage 3 输出：处理后的人物图片路径
    cloud_task_id: str = ""                 # Stage 4 输出：云端任务 ID
    result_video_url: str = ""              # Stage 4 输出：云端视频 URL
    result_video_path: str = ""             # Stage 5 输出：本地视频路径

    # 元数据
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    started_at: float = 0.0
    completed_at: float = 0.0
    error: str = ""

    # 各阶段耗时（用于性能分析）
    stage_timings: Dict[str, float] = field(default_factory=dict)


# ============================================================
# 阶段进度回调
# ============================================================

ProgressCallback = Callable[[str, int, str], None]
"""
进度回调函数类型。

参数：
    stage_name: 阶段名称
    progress: 0-100 的进度值
    message: 进度描述信息
"""


# ============================================================
# 阶段抽象基类
# ============================================================

class PipelineStage(ABC):
    """
    管线阶段抽象基类。

    所有阶段必须继承此类并实现 execute() 方法。
    """

    def __init__(self, name: str, description: str = ""):
        """
        Args:
            name: 阶段名称（唯一标识）
            description: 阶段描述
        """
        self.name = name
        self.description = description
        self.status = StageStatus.PENDING
        self.skip = False  # 是否跳过此阶段
        self.error: Optional[str] = None

    @abstractmethod
    async def execute(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        """
        执行阶段逻辑。

        Args:
            ctx: 共享上下文
            progress_cb: 进度回调

        Returns:
            更新后的上下文
        """
        ...

    async def run(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        """
        运行阶段（包含状态管理和错误处理）。

        这是框架方法，子类只需实现 execute()。
        """
        if self.skip:
            self.status = StageStatus.SKIPPED
            logger.info(f"[{self.name}] 阶段已跳过")
            if progress_cb:
                progress_cb(self.name, 100, "已跳过")
            return ctx

        self.status = StageStatus.RUNNING
        start_time = time.time()

        if progress_cb:
            progress_cb(self.name, 0, f"开始 {self.description or self.name}...")

        try:
            ctx = await self.execute(ctx, progress_cb)
            elapsed = time.time() - start_time
            ctx.stage_timings[self.name] = elapsed
            self.status = StageStatus.COMPLETED

            if progress_cb:
                progress_cb(self.name, 100, f"{self.name} 完成 ({elapsed:.1f}s)")

            logger.info(f"[{self.name}] 完成，耗时 {elapsed:.1f}s")
            return ctx

        except Exception as e:
            elapsed = time.time() - start_time
            ctx.stage_timings[self.name] = elapsed
            self.status = StageStatus.FAILED
            self.error = str(e)
            ctx.error = f"[{self.name}] {e}"

            logger.error(f"[{self.name}] 失败 ({elapsed:.1f}s): {e}", exc_info=True)

            if progress_cb:
                progress_cb(self.name, 0, f"{self.name} 失败: {e}")

            raise


# ============================================================
# Stage 1: 文案优化
# ============================================================

class ScriptOptimizationStage(PipelineStage):
    """
    Stage 1: 文案优化

    调用云端 LLM 对用户输入的脚本文案进行优化：
      - 修正语法错误
      - 优化表达方式，使其更适合语音播报
      - 添加适当的停顿标记
      - 控制文案长度（如果太长）

    可跳过：如果用户不想要 LLM 优化，直接使用原文案。
    """

    def __init__(self, optimizer: Optional[Any] = None, enable: bool = True):
        super().__init__(
            name="script_optimization",
            description="文案优化",
        )
        self._optimizer = optimizer
        self.skip = not enable

    async def execute(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        if not self._optimizer:
            logger.info("未配置文案优化器，使用原始文案")
            ctx.optimized_script = ctx.original_script
            if progress_cb:
                progress_cb(self.name, 50, "使用原始文案（未配置优化器）")
            return ctx

        if progress_cb:
            progress_cb(self.name, 20, "正在调用 LLM 优化文案...")

        # 调用 LLM 优化文案
        optimized = await self._optimizer.optimize(
            text=ctx.original_script,
            style=ctx.extra_params.get("script_style", "natural"),
            max_length=ctx.extra_params.get("script_max_length", 2000),
        )

        ctx.optimized_script = optimized

        if progress_cb:
            progress_cb(self.name, 80, "文案优化完成")

        logger.info(
            f"文案优化: {len(ctx.original_script)}字 → {len(optimized)}字"
        )

        return ctx


# ============================================================
# Stage 2: TTS 语音合成
# ============================================================

class TTSSynthesisStage(PipelineStage):
    """
    Stage 2: TTS 语音合成

    将优化后的文案合成为语音文件。
    支持两种模式：
      - 本地 TTS：使用 edge-tts（免费，需要网络但不需 API Key）
      - 云端 TTS：使用阿里云/火山引擎等云端 TTS 服务（更高质量）

    默认使用本地 TTS，可在配置中切换。
    """

    def __init__(self, tts_engine: Optional[Any] = None, use_cloud_tts: bool = False):
        super().__init__(
            name="tts_synthesis",
            description="语音合成",
        )
        self._tts_engine = tts_engine
        self._use_cloud_tts = use_cloud_tts

    async def execute(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        if not self._tts_engine:
            raise RuntimeError("TTS 引擎未初始化")

        # 使用优化后的文案（如果有），否则使用原始文案
        text = ctx.optimized_script or ctx.original_script
        if not text:
            raise ValueError("没有可合成的文案")

        if progress_cb:
            progress_cb(self.name, 20, f"正在合成语音 ({len(text)}字)...")

        # 生成输出路径
        output_filename = f"tts_{ctx.task_id}_{int(time.time())}.wav"
        output_path = str(Path.home() / ".aurora" / "output" / "tts" / output_filename)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # 调用 TTS 引擎
        result = await self._tts_engine.synthesize(
            text=text,
            voice=ctx.voice,
            output_path=output_path,
            rate=ctx.tts_rate,
            volume=ctx.tts_volume,
            pitch=ctx.tts_pitch,
        )

        ctx.audio_path = result["path"]
        ctx.audio_duration = result.get("duration", 0.0)

        if progress_cb:
            progress_cb(self.name, 80, f"语音合成完成 ({ctx.audio_duration:.1f}s)")

        logger.info(
            f"TTS 合成完成: voice={ctx.voice}, "
            f"duration={ctx.audio_duration:.1f}s, path={ctx.audio_path}"
        )

        return ctx


# ============================================================
# Stage 3: 形象处理
# ============================================================

class AvatarProcessingStage(PipelineStage):
    """
    Stage 3: 形象处理

    对人物图片进行预处理：
      - 裁剪为合适比例（如 1:1 肖像）
      - 缩放到目标分辨率
      - 可选：人脸检测和居中
      - 可选：背景去除/替换
      - 可选：画质增强

    如果图片已经符合要求，此阶段可跳过。
    """

    def __init__(self, enable: bool = True):
        super().__init__(
            name="avatar_processing",
            description="形象处理",
        )
        self.skip = not enable

    async def execute(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        if not ctx.avatar_path:
            raise ValueError("未提供人物图片")

        if not Path(ctx.avatar_path).exists():
            raise FileNotFoundError(f"人物图片不存在: {ctx.avatar_path}")

        if progress_cb:
            progress_cb(self.name, 20, "正在处理人物图片...")

        # 生成处理后的图片路径
        ext = Path(ctx.avatar_path).suffix
        output_filename = f"avatar_{ctx.task_id}{ext}"
        output_path = str(Path.home() / ".aurora" / "output" / "avatars" / output_filename)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        try:
            from PIL import Image

            if progress_cb:
                progress_cb(self.name, 40, "正在裁剪和缩放图片...")

            # 打开图片
            img = Image.open(ctx.avatar_path)

            # 转换为 RGB（去掉 alpha 通道）
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            # 根据模型要求裁剪为正方形（大多数数字人模型需要正方形输入）
            # 保留中心区域
            min_side = min(img.width, img.height)
            left = (img.width - min_side) // 2
            top = (img.height - min_side) // 2
            img = img.crop((left, top, left + min_side, top + min_side))

            # 缩放到目标尺寸
            # 根据 resolution 确定目标尺寸
            size_map = {
                "480p": 480,
                "720p": 720,
                "1080p": 1080,
            }
            target_size = size_map.get(ctx.resolution, 512)
            img = img.resize((target_size, target_size), Image.LANCZOS)

            # 保存
            img.save(output_path, quality=95)

            ctx.processed_avatar_path = output_path

            if progress_cb:
                progress_cb(self.name, 80, f"图片处理完成 ({target_size}x{target_size})")

            logger.info(
                f"形象处理: {ctx.avatar_path} → {output_path} "
                f"({target_size}x{target_size})"
            )

        except ImportError:
            logger.warning("Pillow 未安装，跳过图片处理")
            ctx.processed_avatar_path = ctx.avatar_path
            if progress_cb:
                progress_cb(self.name, 50, "Pillow 未安装，使用原始图片")

        ctx.processed_avatar_path = ctx.processed_avatar_path or ctx.avatar_path
        return ctx


# ============================================================
# Stage 4: 云端视频合成
# ============================================================

class CloudSynthesisStage(PipelineStage):
    """
    Stage 4: 云端视频合成

    将处理后的图片和音频提交到云端视频生成服务：
      1. 上传图片和音频到云端（获取公网 URL）
      2. 提交视频生成任务
      3. 轮询任务状态直到完成
      4. 获取结果视频 URL

    这是管线的核心阶段，调用云端 AI 模型进行视频合成。
    """

    def __init__(self, provider: Optional[Any] = None, poll_interval: float = 3.0, timeout: float = 600.0):
        super().__init__(
            name="cloud_synthesis",
            description="云端视频合成",
        )
        self._provider = provider
        self._poll_interval = poll_interval   # 轮询间隔（秒）
        self._timeout = timeout               # 超时时间（秒）

    async def execute(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        if not self._provider:
            raise RuntimeError("未配置云端提供商")

        if not self._provider.validate_config():
            raise RuntimeError(
                f"提供商 {self._provider.PROVIDER_NAME} 配置无效，"
                f"请检查 API Key 等配置"
            )

        # 确定要使用的图片路径
        avatar_path = ctx.processed_avatar_path or ctx.avatar_path
        audio_path = ctx.audio_path

        if not audio_path:
            raise ValueError("没有音频文件，请先执行 TTS 合成阶段")

        # ---- 步骤 1: 上传文件 ----
        if progress_cb:
            progress_cb(self.name, 5, "正在上传人物图片...")

        image_url = await self._provider.upload_image(avatar_path)

        if progress_cb:
            progress_cb(self.name, 15, "正在上传音频文件...")

        audio_url = await self._provider.upload_audio(audio_path)

        logger.info(f"文件上传完成: image={image_url[:80]}..., audio={audio_url[:80]}...")

        # ---- 步骤 2: 提交任务 ----
        if progress_cb:
            progress_cb(self.name, 25, "正在提交视频生成任务...")

        cloud_task_id = await self._provider.submit_task(
            image_url=image_url,
            audio_url=audio_url,
            model_name=ctx.model_name,
            resolution=ctx.resolution,
            extra_params=ctx.extra_params,
        )

        ctx.cloud_task_id = cloud_task_id
        logger.info(f"云端任务已提交: {cloud_task_id}")

        # ---- 步骤 3: 轮询状态 ----
        if progress_cb:
            progress_cb(self.name, 30, "任务已提交，等待云端处理...")

        start_time = time.time()
        last_progress = 30

        while True:
            elapsed = time.time() - start_time
            if elapsed > self._timeout:
                raise TimeoutError(
                    f"云端任务超时 ({self._timeout}s): task_id={cloud_task_id}"
                )

            await asyncio.sleep(self._poll_interval)

            status = await self._provider.poll_task(cloud_task_id)

            cloud_status = status.get("status", "pending")
            progress = status.get("progress", 0)
            message = status.get("message", "")
            video_url = status.get("video_url", "")
            error = status.get("error", "")

            # 映射进度：云端 0-100 → 阶段 30-95
            mapped_progress = 30 + int(progress * 0.65)

            if mapped_progress != last_progress:
                last_progress = mapped_progress
                if progress_cb:
                    progress_cb(self.name, mapped_progress, message)

            if cloud_status == "succeeded":
                ctx.result_video_url = video_url
                if progress_cb:
                    progress_cb(self.name, 95, "视频生成完成，准备下载...")
                logger.info(f"云端任务完成: video_url={video_url[:80]}...")
                break

            elif cloud_status == "failed":
                raise RuntimeError(
                    f"云端视频生成失败: {error or message}"
                )

            # 继续等待
            logger.debug(
                f"轮询中: status={cloud_status}, progress={progress}%, "
                f"elapsed={elapsed:.0f}s"
            )

        return ctx


# ============================================================
# Stage 5: 后处理
# ============================================================

class PostProcessingStage(PipelineStage):
    """
    Stage 5: 后处理

    下载云端生成的视频，并进行可选的后处理：
      - 下载视频到本地
      - 可选：添加字幕（基于 TTS 文案）
      - 可选：添加水印
      - 可选：转码为指定格式

    如果不需要后处理，仅执行下载。
    """

    def __init__(
        self,
        provider: Optional[Any] = None,
        add_watermark: bool = False,
        add_subtitles: bool = False,
        output_format: str = "mp4",
    ):
        super().__init__(
            name="post_processing",
            description="后处理",
        )
        self._provider = provider
        self._add_watermark = add_watermark
        self._add_subtitles = add_subtitles
        self._output_format = output_format

    async def execute(
        self,
        ctx: StageContext,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> StageContext:
        if not ctx.result_video_url:
            raise ValueError("没有可下载的视频 URL")

        if not self._provider:
            raise RuntimeError("未配置云端提供商")

        # 生成输出路径
        output_filename = f"aurora_dh_{ctx.task_id}.{self._output_format}"
        output_path = str(Path.home() / ".aurora" / "output" / output_filename)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # ---- 下载视频 ----
        if progress_cb:
            progress_cb(self.name, 20, "正在下载视频...")

        await self._provider.download_result(
            video_url=ctx.result_video_url,
            local_path=output_path,
        )

        ctx.result_video_path = output_path
        logger.info(f"视频已下载: {output_path}")

        # ---- 可选：添加字幕 ----
        if self._add_subtitles and ctx.optimized_script:
            if progress_cb:
                progress_cb(self.name, 50, "正在添加字幕...")

            try:
                output_path = await self._add_subtitles_to_video(
                    video_path=output_path,
                    text=ctx.optimized_script,
                    duration=ctx.audio_duration,
                )
                ctx.result_video_path = output_path
                logger.info("字幕添加完成")
            except Exception as e:
                logger.warning(f"字幕添加失败（不影响视频）: {e}")

        # ---- 可选：添加水印 ----
        if self._add_watermark:
            if progress_cb:
                progress_cb(self.name, 70, "正在添加水印...")

            try:
                output_path = await self._add_watermark_to_video(output_path)
                ctx.result_video_path = output_path
                logger.info("水印添加完成")
            except Exception as e:
                logger.warning(f"水印添加失败（不影响视频）: {e}")

        if progress_cb:
            progress_cb(self.name, 90, "后处理完成")

        # 获取视频文件大小
        file_size = Path(output_path).stat().st_size if Path(output_path).exists() else 0
        ctx.completed_at = time.time()

        logger.info(
            f"后处理完成: path={output_path}, "
            f"size={file_size / 1024 / 1024:.1f}MB"
        )

        return ctx

    async def _add_subtitles_to_video(
        self,
        video_path: str,
        text: str,
        duration: float,
    ) -> str:
        """使用 FFmpeg 添加字幕到视频"""
        from utils.ffmpeg import FFmpegManager

        ffmpeg = FFmpegManager()
        if not ffmpeg.available:
            raise RuntimeError("FFmpeg 不可用")

        # 生成 SRT 字幕文件
        srt_path = video_path.replace(".mp4", ".srt")
        self._generate_srt(srt_path, text, duration)

        # 使用 FFmpeg 烧录字幕
        output_path = video_path.replace(".mp4", "_subtitled.mp4")
        cmd = [
            ffmpeg.ffmpeg_path, "-y",
            "-i", video_path,
            "-vf", f"subtitles={srt_path}",
            "-c:a", "copy",
            output_path,
        ]

        import subprocess
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg 字幕添加失败: {result.stderr}")

        # 删除临时文件
        Path(srt_path).unlink(missing_ok=True)
        Path(video_path).unlink(missing_ok=True)

        return output_path

    def _generate_srt(self, srt_path: str, text: str, duration: float):
        """生成简单的 SRT 字幕文件"""
        # 按标点分句
        import re
        sentences = re.split(r'[。！？!?\n]', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        if not sentences:
            return

        # 平均分配时间
        per_sentence = duration / len(sentences) if sentences else duration

        with open(srt_path, "w", encoding="utf-8") as f:
            for i, sentence in enumerate(sentences):
                start = i * per_sentence
                end = min((i + 1) * per_sentence, duration)

                def format_time(t):
                    h = int(t // 3600)
                    m = int((t % 3600) // 60)
                    s = int(t % 60)
                    ms = int((t % 1) * 1000)
                    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

                f.write(f"{i + 1}\n")
                f.write(f"{format_time(start)} --> {format_time(end)}\n")
                f.write(f"{sentence}\n\n")

    async def _add_watermark_to_video(self, video_path: str) -> str:
        """使用 FFmpeg 添加水印到视频"""
        from utils.ffmpeg import FFmpegManager

        ffmpeg = FFmpegManager()
        if not ffmpeg.available:
            raise RuntimeError("FFmpeg 不可用")

        output_path = video_path.replace(".mp4", "_watermarked.mp4")

        # 添加文字水印 "Aurora"
        cmd = [
            ffmpeg.ffmpeg_path, "-y",
            "-i", video_path,
            "-vf", "drawtext=text='Aurora':fontsize=24:fontcolor=white@0.5:"
                   "x=w-tw-20:y=h-th-20",
            "-c:a", "copy",
            output_path,
        ]

        import subprocess
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg 水印添加失败: {result.stderr}")

        Path(video_path).unlink(missing_ok=True)
        return output_path
