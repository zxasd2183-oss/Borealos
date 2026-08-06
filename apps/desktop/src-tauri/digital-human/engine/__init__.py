# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 推理引擎模块
================================

本包包含数字人视频生成的所有模型封装，提供统一的接口：
  - BaseLipSyncModel: 所有模型的抽象基类
  - MuseTalkModel: 实时口型同步模型
  - SadTalkerModel: 3DMM 驱动的头部运动生成模型
  - Wav2LipModel: 轻量级口型同步模型
  - EchoMimicModel: 半身动画生成模型
  - Hallo2Model: 4K 高分辨率长视频生成模型
  - ModelRegistry: 模型注册表（延迟加载 + 显存管理）

使用方式：
    from engine import ModelRegistry
    registry = ModelRegistry()
    model = await registry.get_model("musetalk")
    output = await model.generate(image_path, audio_path, output_path, callback)
"""

from engine.base import BaseLipSyncModel
from engine.musetalk import MuseTalkModel
from engine.sadtalker import SadTalkerModel
from engine.wav2lip import Wav2LipModel
from engine.echomimic import EchoMimicModel
from engine.hallo2 import Hallo2Model
from engine.registry import ModelRegistry

__all__ = [
    "BaseLipSyncModel",
    "MuseTalkModel",
    "SadTalkerModel",
    "Wav2LipModel",
    "EchoMimicModel",
    "Hallo2Model",
    "ModelRegistry",
]
