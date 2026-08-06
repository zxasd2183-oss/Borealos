# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 自研编排管线
=================================

这是 Aurora 数字人引擎的核心：一套完全自研的多阶段编排管线。

设计理念：
  - 管线调度逻辑 100% 自研，不依赖任何第三方 SDK 的完整流程
  - 云端 AI 模型（LLM / TTS / 视频生成）作为"零件"被管线调用
  - 可灵活切换不同云厂商，管线逻辑不受影响
  - 每个阶段独立可测、可替换、可跳过

管线阶段：
  Stage 1: 文案优化  — 调用云端 LLM 润色/优化用户输入的脚本文案
  Stage 2: TTS 合成  — 将优化后的文字合成为语音
  Stage 3: 形象处理  — 对人物图片进行裁剪/缩放/增强等预处理
  Stage 4: 云端合成  — 提交到云端视频生成服务，轮询等待结果
  Stage 5: 后处理    — 下载视频，可选添加字幕/水印/转码

用法：
    from pipeline import PipelineOrchestrator

    orchestrator = PipelineOrchestrator()
    result = await orchestrator.run(
        script="大家好，今天给大家介绍一款新产品...",
        avatar_path="/path/to/avatar.png",
        voice="zh-CN-XiaoxiaoNeural",
        provider_id="aliyun_wan",
        model_name="emo",
    )
"""

from .orchestrator import PipelineOrchestrator, PipelineConfig, PipelineResult
from .script_optimizer import ScriptOptimizer
from .stages import (
    PipelineStage,
    ScriptOptimizationStage,
    TTSSynthesisStage,
    AvatarProcessingStage,
    CloudSynthesisStage,
    PostProcessingStage,
)

__all__ = [
    "PipelineOrchestrator",
    "PipelineConfig",
    "PipelineResult",
    "ScriptOptimizer",
    "PipelineStage",
    "ScriptOptimizationStage",
    "TTSSynthesisStage",
    "AvatarProcessingStage",
    "CloudSynthesisStage",
    "PostProcessingStage",
]
