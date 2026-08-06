# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 云端提供商模块
==================================

自研编排管线的核心：通过统一的抽象层对接多个云端 AI 模型提供商，
我们自己的管线负责编排（TTS → 图片检测 → 云端视频生成 → 后处理），
云端模型只作为推理"零件"，不是直接套用第三方产品。

支持的提供商：
  1. aliyun_wan   — 阿里云通义万相 (wan2.2-s2v / EMO)，国内最便宜
  2. volcengine   — 火山引擎/即梦 (Seedance)，字节跳动生态
  3. did          — D-ID，国际知名
  4. heygen       — HeyGen，高质量 Avatar
  5. custom       — 自定义远程服务（用户自己的 GPU 服务器）
"""

from .base import CloudProviderBase, CloudProviderFactory
from .aliyun_wan import AliyunWanProvider
from .volcengine import VolcengineProvider
from .did import DIDProvider
from .heygen import HeyGenProvider
from .custom import CustomProvider

__all__ = [
    "CloudProviderBase",
    "CloudProviderFactory",
    "AliyunWanProvider",
    "VolcengineProvider",
    "DIDProvider",
    "HeyGenProvider",
    "CustomProvider",
]
