# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 管线编排器
=================================

这是自研编排管线的核心调度引擎。

职责：
  - 按顺序调度各个阶段
  - 管理全局进度和状态
  - 处理阶段间的依赖关系
  - 收集各阶段的执行结果
  - 提供任务取消和超时控制
  - 生成最终结果报告

核心设计理念：
  这不是简单的"调用一个 SDK 完成全部工作"，
  而是将数字人视频生成拆解为多个独立阶段，
  每个阶段可以独立配置、替换、跳过，
  由编排器统一调度。

  云端模型（LLM、TTS、视频生成）是被调用的"零件"，
  编排逻辑、流程控制、错误处理、进度管理 100% 自研。
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .stages import (
    PipelineStage,
    StageContext,
    StageStatus,
    ScriptOptimizationStage,
    TTSSynthesisStage,
    AvatarProcessingStage,
    CloudSynthesisStage,
    PostProcessingStage,
    ProgressCallback,
)

logger = logging.getLogger("aurora.pipeline.orchestrator")


# ============================================================
# 管线配置
# ============================================================

@dataclass
class PipelineConfig:
    """
    管线配置。

    控制管线各阶段的行为和参数。
    """
    # ---- 文案优化 ----
    enable_script_optimization: bool = True    # 是否启用 LLM 文案优化
    script_style: str = "natural"              # 优化风格
    script_max_length: int = 2000              # 最大字数

    # ---- TTS ----
    use_cloud_tts: bool = False                # 是否使用云端 TTS（否则用本地 edge-tts）

    # ---- 形象处理 ----
    enable_avatar_processing: bool = True      # 是否启用图片预处理

    # ---- 云端合成 ----
    provider_id: str = "aliyun_wan"            # 云端提供商
    model_name: str = "emo"                    # 模型名称
    resolution: str = "480p"                   # 分辨率
    poll_interval: float = 3.0                 # 轮询间隔（秒）
    timeout: float = 600.0                     # 超时时间（秒）

    # ---- 后处理 ----
    add_watermark: bool = False                # 添加水印
    add_subtitles: bool = False                # 添加字幕
    output_format: str = "mp4"                 # 输出格式

    # ---- LLM 配置 ----
    llm_backend: str = "qwen"                  # LLM 后端
    llm_api_key: str = ""                      # LLM API Key
    llm_model: str = ""                        # LLM 模型名称
    llm_base_url: str = ""                     # LLM API 地址

    # ---- 云端提供商配置 ----
    provider_config: Dict[str, Any] = field(default_factory=dict)


# ============================================================
# 管线结果
# ============================================================

@dataclass
class PipelineResult:
    """管线执行结果"""
    task_id: str = ""
    success: bool = False
    error: str = ""

    # 产物
    optimized_script: str = ""
    audio_path: str = ""
    audio_duration: float = 0.0
    video_path: str = ""
    video_url: str = ""

    # 各阶段状态
    stages: List[Dict[str, Any]] = field(default_factory=list)

    # 性能数据
    total_duration: float = 0.0
    stage_timings: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "task_id": self.task_id,
            "success": self.success,
            "error": self.error,
            "optimized_script": self.optimized_script,
            "audio_path": self.audio_path,
            "audio_duration": self.audio_duration,
            "video_path": self.video_path,
            "video_url": self.video_url,
            "stages": self.stages,
            "total_duration": round(self.total_duration, 2),
            "stage_timings": {k: round(v, 2) for k, v in self.stage_timings.items()},
        }


# ============================================================
# 管线编排器
# ============================================================

class PipelineOrchestrator:
    """
    管线编排器。

    负责按顺序调度各个阶段，管理进度和状态。

    用法：
        config = PipelineConfig(provider_id="aliyun_wan", ...)
        orchestrator = PipelineOrchestrator(config)

        result = await orchestrator.run(
            script="大家好...",
            avatar_path="/path/to/avatar.png",
            voice="zh-CN-XiaoxiaoNeural",
        )
    """

    # 阶段权重（用于全局进度计算）
    # 总和为 100
    STAGE_WEIGHTS = {
        "script_optimization": 10,   # 文案优化占 10%
        "tts_synthesis": 15,         # TTS 占 15%
        "avatar_processing": 5,      # 形象处理占 5%
        "cloud_synthesis": 60,       # 云端合成占 60%（最耗时）
        "post_processing": 10,       # 后处理占 10%
    }

    def __init__(
        self,
        config: Optional[PipelineConfig] = None,
        tts_engine: Optional[Any] = None,
        cloud_provider: Optional[Any] = None,
        script_optimizer: Optional[Any] = None,
    ):
        """
        Args:
            config: 管线配置
            tts_engine: TTS 引擎实例
            cloud_provider: 云端提供商实例
            script_optimizer: 文案优化器实例
        """
        self.config = config or PipelineConfig()
        self._tts_engine = tts_engine
        self._cloud_provider = cloud_provider
        self._script_optimizer = script_optimizer

        # 任务状态
        self._tasks: Dict[str, dict] = {}
        self._cancelled: set = set()

        logger.info("管线编排器已初始化")

    def set_tts_engine(self, engine: Any):
        """设置 TTS 引擎"""
        self._tts_engine = engine

    def set_cloud_provider(self, provider: Any):
        """设置云端提供商"""
        self._cloud_provider = provider

    def set_script_optimizer(self, optimizer: Any):
        """设置文案优化器"""
        self._script_optimizer = optimizer

    def _build_stages(self) -> List[PipelineStage]:
        """根据配置构建阶段列表"""
        stages = []

        # Stage 1: 文案优化
        stages.append(ScriptOptimizationStage(
            optimizer=self._script_optimizer,
            enable=self.config.enable_script_optimization,
        ))

        # Stage 2: TTS 合成
        stages.append(TTSSynthesisStage(
            tts_engine=self._tts_engine,
            use_cloud_tts=self.config.use_cloud_tts,
        ))

        # Stage 3: 形象处理
        stages.append(AvatarProcessingStage(
            enable=self.config.enable_avatar_processing,
        ))

        # Stage 4: 云端合成
        stages.append(CloudSynthesisStage(
            provider=self._cloud_provider,
            poll_interval=self.config.poll_interval,
            timeout=self.config.timeout,
        ))

        # Stage 5: 后处理
        stages.append(PostProcessingStage(
            provider=self._cloud_provider,
            add_watermark=self.config.add_watermark,
            add_subtitles=self.config.add_subtitles,
            output_format=self.config.output_format,
        ))

        return stages

    async def run(
        self,
        script: str,
        avatar_path: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        tts_rate: str = "+0%",
        tts_volume: str = "+0%",
        tts_pitch: str = "+0%",
        extra_params: Optional[Dict[str, Any]] = None,
        progress_cb: Optional[ProgressCallback] = None,
    ) -> PipelineResult:
        """
        运行完整管线。

        Args:
            script: 脚本文案
            avatar_path: 人物图片路径
            voice: TTS 语音 ID
            tts_rate: TTS 语速
            tts_volume: TTS 音量
            tts_pitch: TTS 音调
            extra_params: 额外参数
            progress_cb: 进度回调

        Returns:
            管线执行结果
        """
        task_id = uuid.uuid4().hex[:12]
        start_time = time.time()

        # 构建上下文
        ctx = StageContext(
            original_script=script,
            avatar_path=avatar_path,
            voice=voice,
            tts_rate=tts_rate,
            tts_volume=tts_volume,
            tts_pitch=tts_pitch,
            provider_id=self.config.provider_id,
            model_name=self.config.model_name,
            resolution=self.config.resolution,
            extra_params={
                "script_style": self.config.script_style,
                "script_max_length": self.config.script_max_length,
                **(extra_params or {}),
            },
            task_id=task_id,
            started_at=start_time,
        )

        # 记录任务
        self._tasks[task_id] = {
            "task_id": task_id,
            "status": "running",
            "started_at": start_time,
            "ctx": ctx,
        }

        logger.info(
            f"管线启动: task_id={task_id}, "
            f"provider={self.config.provider_id}, "
            f"model={self.config.model_name}"
        )

        # 构建阶段
        stages = self._build_stages()

        # 全局进度跟踪
        stage_results = []
        completed_weight = 0

        def global_progress(stage_name: str, stage_progress: int, message: str):
            """将阶段进度映射到全局进度"""
            nonlocal completed_weight

            # 计算已完成阶段的权重
            total_weight = sum(self.STAGE_WEIGHTS.values())
            current_weight = self.STAGE_WEIGHTS.get(stage_name, 0)
            global_progress_val = int(
                ((completed_weight + current_weight * stage_progress / 100) / total_weight) * 100
            )

            if progress_cb:
                progress_cb(stage_name, stage_progress, message)

            # 记录到任务状态
            self._tasks[task_id]["global_progress"] = global_progress_val
            self._tasks[task_id]["current_stage"] = stage_name
            self._tasks[task_id]["message"] = message

        # 依次执行阶段
        for i, stage in enumerate(stages):
            # 检查是否已取消
            if task_id in self._cancelled:
                logger.info(f"任务已取消: {task_id}")
                return PipelineResult(
                    task_id=task_id,
                    success=False,
                    error="任务已取消",
                    stages=stage_results,
                    total_duration=time.time() - start_time,
                )

            stage_start = time.time()

            try:
                # 执行阶段
                ctx = await stage.run(ctx, global_progress)

                stage_elapsed = time.time() - stage_start
                stage_results.append({
                    "name": stage.name,
                    "description": stage.description,
                    "status": stage.status.value,
                    "duration": round(stage_elapsed, 2),
                    "error": stage.error,
                })

                # 累加已完成权重
                if stage.status != StageStatus.SKIPPED:
                    completed_weight += self.STAGE_WEIGHTS.get(stage.name, 0)

            except Exception as e:
                # 阶段失败
                stage_elapsed = time.time() - stage_start
                stage_results.append({
                    "name": stage.name,
                    "description": stage.description,
                    "status": StageStatus.FAILED.value,
                    "duration": round(stage_elapsed, 2),
                    "error": str(e),
                })

                total_elapsed = time.time() - start_time
                self._tasks[task_id]["status"] = "failed"
                self._tasks[task_id]["error"] = str(e)

                logger.error(
                    f"管线失败: task_id={task_id}, "
                    f"failed_stage={stage.name}, error={e}"
                )

                return PipelineResult(
                    task_id=task_id,
                    success=False,
                    error=f"阶段 [{stage.description}] 失败: {e}",
                    stages=stage_results,
                    total_duration=total_elapsed,
                    stage_timings=ctx.stage_timings,
                )

        # 管线完成
        total_elapsed = time.time() - start_time
        ctx.completed_at = time.time()
        self._tasks[task_id]["status"] = "completed"

        logger.info(
            f"管线完成: task_id={task_id}, "
            f"total_duration={total_elapsed:.1f}s, "
            f"stages={len(stage_results)}"
        )

        return PipelineResult(
            task_id=task_id,
            success=True,
            optimized_script=ctx.optimized_script,
            audio_path=ctx.audio_path,
            audio_duration=ctx.audio_duration,
            video_path=ctx.result_video_path,
            video_url=ctx.result_video_url,
            stages=stage_results,
            total_duration=total_elapsed,
            stage_timings=ctx.stage_timings,
        )

    def cancel(self, task_id: str):
        """取消任务"""
        self._cancelled.add(task_id)
        if task_id in self._tasks:
            self._tasks[task_id]["status"] = "cancelled"
        logger.info(f"任务取消请求: {task_id}")

    def get_task_status(self, task_id: str) -> Optional[dict]:
        """获取任务状态"""
        task = self._tasks.get(task_id)
        if task is None:
            return None

        return {
            "task_id": task_id,
            "status": task.get("status", "unknown"),
            "global_progress": task.get("global_progress", 0),
            "current_stage": task.get("current_stage", ""),
            "message": task.get("message", ""),
            "started_at": task.get("started_at", 0),
        }

    def list_active_tasks(self) -> List[str]:
        """列出活跃任务"""
        return [
            tid for tid, task in self._tasks.items()
            if task.get("status") == "running"
        ]
