# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 云端提供商抽象基类
======================================

所有云端提供商实现统一接口，管线通过此抽象层调用不同提供商，
实现"一套管线、多家供应商"的灵活架构。

这正是"自研"的核心：
  - 管线设计是我们自己的
  - 编排逻辑是我们自己的
  - UI 交互是我们自己的
  - 云端模型只是被调用的"零件"
"""

import abc
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class GenerationTask:
    """一次数字人视频生成任务的上下文"""
    task_id: str
    avatar_path: str           # 人物图片本地路径或 URL
    audio_path: str            # 音频文件本地路径或 URL
    model_name: str            # 使用的模型名称（如 emo, wan2.2-s2v）
    resolution: str = "480p"   # 输出分辨率
    fps: int = 25              # 帧率
    extra_params: Dict[str, Any] = field(default_factory=dict)
    status: str = "pending"    # pending, uploading, generating, completed, error
    progress: int = 0          # 0-100
    message: str = ""
    result_video_url: str = ""
    result_video_path: str = ""
    error: str = ""
    created_at: float = field(default_factory=time.time)


class CloudProviderBase(abc.ABC):
    """
    云端提供商抽象基类。

    每个提供商需要实现以下方法：
      - validate_config()     验证配置是否有效
      - upload_image()        上传人物图片（返回 URL）
      - upload_audio()        上传音频文件（返回 URL）
      - submit_task()         提交视频生成任务（返回 task_id）
      - poll_task()           轮询任务状态
      - download_result()     下载生成的视频
      - get_models()          获取该提供商支持的模型列表
      - estimate_cost()       估算生成费用
    """

    # 提供商唯一标识
    PROVIDER_ID: str = ""
    # 提供商显示名称
    PROVIDER_NAME: str = ""
    # 是否需要 API Key
    REQUIRES_API_KEY: bool = True
    # 是否国内可用
    CHINA_AVAILABLE: bool = False
    # 帮助文档 URL
    DOCS_URL: str = ""

    def __init__(self, config: Dict[str, Any]):
        """
        初始化提供商实例。

        Args:
            config: 提供商配置字典，包含 api_key, region 等参数
        """
        self.config = config
        self.api_key: str = config.get("api_key", "")
        self.region: str = config.get("region", "")
        self._task_store: Dict[str, GenerationTask] = {}

    @abc.abstractmethod
    def validate_config(self) -> bool:
        """验证配置是否完整有效（API Key 是否存在等）"""
        ...

    @abc.abstractmethod
    async def upload_image(self, image_path: str) -> str:
        """
        上传人物图片到云端，返回可访问的 URL。

        Args:
            image_path: 本地图片文件路径

        Returns:
            云端可访问的图片 URL
        """
        ...

    @abc.abstractmethod
    async def upload_audio(self, audio_path: str) -> str:
        """
        上传音频文件到云端，返回可访问的 URL。

        Args:
            audio_path: 本地音频文件路径

        Returns:
            云端可访问的音频 URL
        """
        ...

    @abc.abstractmethod
    async def submit_task(
        self,
        image_url: str,
        audio_url: str,
        model_name: str,
        resolution: str = "480p",
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        提交视频生成任务到云端。

        Args:
            image_url: 人物图片 URL
            audio_url: 音频文件 URL
            model_name: 模型名称
            resolution: 输出分辨率
            extra_params: 额外参数

        Returns:
            云端任务 ID
        """
        ...

    @abc.abstractmethod
    async def poll_task(self, cloud_task_id: str) -> Dict[str, Any]:
        """
        轮询任务状态。

        Returns:
            包含以下字段的字典：
              - status: "pending" | "running" | "succeeded" | "failed"
              - progress: 0-100
              - message: 状态描述
              - video_url: 完成后的视频 URL（仅 succeeded 时有值）
              - error: 错误信息（仅 failed 时有值）
        """
        ...

    @abc.abstractmethod
    async def download_result(self, video_url: str, local_path: str) -> str:
        """
        下载生成的视频到本地。

        Args:
            video_url: 云端视频 URL
            local_path: 本地保存路径

        Returns:
            本地文件路径
        """
        ...

    @abc.abstractmethod
    def get_models(self) -> List[Dict[str, Any]]:
        """
        获取该提供商支持的模型列表。

        Returns:
            模型信息列表，每项包含：
              - id: 模型 ID
              - name: 模型名称
              - description: 描述
              - max_resolution: 最大分辨率
              - price_per_second: 每秒价格（元）
              - features: 特性列表
        """
        ...

    def estimate_cost(self, duration_seconds: float, model_name: str) -> Dict[str, Any]:
        """
        估算生成费用。

        Args:
            duration_seconds: 视频时长（秒）
            model_name: 模型名称

        Returns:
            {"cost": float, "currency": str, "detail": str}
        """
        models = self.get_models()
        model = next((m for m in models if m["id"] == model_name), None)
        if model:
            price = model.get("price_per_second", 0)
            return {
                "cost": round(duration_seconds * price, 2),
                "currency": "CNY" if self.CHINA_AVAILABLE else "USD",
                "detail": f"{duration_seconds}s × {price}/s",
            }
        return {"cost": 0, "currency": "", "detail": "未知模型"}

    def get_info(self) -> Dict[str, Any]:
        """获取提供商信息"""
        return {
            "id": self.PROVIDER_ID,
            "name": self.PROVIDER_NAME,
            "requires_api_key": self.REQUIRES_API_KEY,
            "china_available": self.CHINA_AVAILABLE,
            "docs_url": self.DOCS_URL,
            "configured": self.validate_config(),
            "models": self.get_models(),
        }


class CloudProviderFactory:
    """云端提供商工厂，根据类型创建对应的提供商实例"""

    _registry: Dict[str, type] = {}

    @classmethod
    def register(cls, provider_id: str, provider_class: type) -> None:
        """注册提供商"""
        cls._registry[provider_id] = provider_class

    @classmethod
    def create(cls, provider_id: str, config: Dict[str, Any]) -> Optional[CloudProviderBase]:
        """创建提供商实例"""
        provider_class = cls._registry.get(provider_id)
        if provider_class is None:
            return None
        return provider_class(config)

    @classmethod
    def list_providers(cls) -> List[str]:
        """列出所有已注册的提供商"""
        return list(cls._registry.keys())


# 注册所有提供商（在模块加载时自动注册）
def _register_all():
    """注册所有内置提供商"""
    try:
        from .aliyun_wan import AliyunWanProvider
        CloudProviderFactory.register("aliyun_wan", AliyunWanProvider)
    except ImportError:
        pass
    try:
        from .volcengine import VolcengineProvider
        CloudProviderFactory.register("volcengine", VolcengineProvider)
    except ImportError:
        pass
    try:
        from .did import DIDProvider
        CloudProviderFactory.register("did", DIDProvider)
    except ImportError:
        pass
    try:
        from .heygen import HeyGenProvider
        CloudProviderFactory.register("heygen", HeyGenProvider)
    except ImportError:
        pass
    try:
        from .custom import CustomProvider
        CloudProviderFactory.register("custom", CustomProvider)
    except ImportError:
        pass


_register_all()
