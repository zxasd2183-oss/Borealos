# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 模型注册表模块
===================================

本模块管理所有数字人模型的实例，提供以下功能：
  - 统一的 get_model(model_type) 接口
  - 延迟加载（首次使用时才加载到显存）
  - 显存管理（加载新模型前卸载旧模型，避免显存溢出）
  - 模型实例缓存（已加载的模型保持在显存中复用）
  - 线程安全的模型访问

设计理念：
  1. 延迟加载：模型在首次调用 generate() 时才加载到显存，避免启动时占用大量资源
  2. 显存管理：同一时间只保留一个模型在显存中（可根据配置调整），
     加载新模型前自动卸载旧模型
  3. 统一接口：通过 get_model(model_type) 获取任意模型实例

使用方式：
    from engine.registry import ModelRegistry
    registry = ModelRegistry()
    model = await registry.get_model("musetalk")
    output = await model.generate(image_path, audio_path, output_path, callback)
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Type

from config import MODEL_META, INFERENCE
from engine.base import BaseLipSyncModel
from engine.musetalk import MuseTalkModel
from engine.sadtalker import SadTalkerModel
from engine.wav2lip import Wav2LipModel
from engine.echomimic import EchoMimicModel
from engine.hallo2 import Hallo2Model
from utils.gpu import detect_gpu, get_vram_info, clear_gpu_cache, format_bytes

logger = logging.getLogger(__name__)


class ModelRegistry:
    """
    模型注册表。

    管理所有数字人模型的实例，负责：
      - 模型注册与查找
      - 延迟加载
      - 显存管理
      - 模型卸载

    属性:
        _models: 已创建的模型实例字典 {model_type: model_instance}
        _model_classes: 模型类注册表 {model_type: model_class}
        _current_model_type: 当前加载到显存的模型类型
        _lock: 异步锁，保证线程安全
        _gpu_info: GPU 信息缓存
        _max_loaded_models: 同时保留在显存中的最大模型数
    """

    def __init__(self, max_loaded_models: int = 1) -> None:
        """
        初始化模型注册表。

        Args:
            max_loaded_models: 同时保留在显存中的最大模型数。
                               默认为 1，即同一时间只有一个模型在显存中。
                               设置为更大的值可以减少模型切换开销，但需要更多显存。
        """
        self._models: Dict[str, BaseLipSyncModel] = {}
        self._model_classes: Dict[str, Type[BaseLipSyncModel]] = {}
        self._current_model_type: Optional[str] = None
        self._lock = asyncio.Lock()
        self._gpu_info: dict = {}
        self._max_loaded_models: int = max_loaded_models

        # 注册所有支持的模型
        self._register_models()

        # 检测 GPU 环境
        self._gpu_info = detect_gpu()
        logger.info(
            f"模型注册表已初始化, "
            f"GPU: {self._gpu_info.get('device_name', 'CPU')}, "
            f"最大同时加载数: {self._max_loaded_models}"
        )

    def _register_models(self) -> None:
        """注册所有支持的模型类"""
        self._model_classes = {
            "musetalk": MuseTalkModel,
            "sadtalker": SadTalkerModel,
            "wav2lip": Wav2LipModel,
            "echomimic": EchoMimicModel,
            "hallo2": Hallo2Model,
        }
        logger.info(
            f"已注册 {len(self._model_classes)} 个模型: "
            f"{list(self._model_classes.keys())}"
        )

    def list_supported_models(self) -> List[str]:
        """
        获取所有支持的模型类型列表。

        Returns:
            支持的模型类型列表
        """
        return list(self._model_classes.keys())

    def is_supported(self, model_type: str) -> bool:
        """
        检查模型类型是否受支持。

        Args:
            model_type: 模型类型

        Returns:
            bool: True 表示受支持
        """
        return model_type in self._model_classes

    async def get_model(self, model_type: str) -> BaseLipSyncModel:
        """
        获取指定类型的模型实例。

        如果模型实例不存在，则创建新实例。
        如果模型未加载到显存，则自动加载（延迟加载）。
        如果当前显存中已有其他模型且超过最大加载数，则先卸载旧模型。

        Args:
            model_type: 模型类型（musetalk/sadtalker/wav2lip/echomimic/hallo2）

        Returns:
            BaseLipSyncModel: 已加载的模型实例

        Raises:
            ValueError: 不支持的模型类型
            RuntimeError: 模型未安装或加载失败
        """
        if not self.is_supported(model_type):
            raise ValueError(
                f"不支持的模型类型: {model_type}. "
                f"支持的类型: {self.list_supported_models()}"
            )

        async with self._lock:
            # 获取或创建模型实例
            model = await self._get_or_create_model(model_type)

            # 如果模型已加载，直接返回
            if model.is_loaded:
                self._current_model_type = model_type
                return model

            # 检查显存管理：如果需要，卸载其他模型
            await self._manage_vram(model_type)

            # 加载模型到显存
            logger.info(f"[Registry] 开始加载模型: {model_type}")
            await model.load_model()
            self._current_model_type = model_type

            logger.info(f"[Registry] 模型加载完成: {model_type}")
            return model

    async def _get_or_create_model(self, model_type: str) -> BaseLipSyncModel:
        """
        获取或创建模型实例。

        如果模型实例已存在（在缓存中），直接返回。
        否则创建新实例并缓存。

        Args:
            model_type: 模型类型

        Returns:
            模型实例
        """
        if model_type not in self._models:
            model_class = self._model_classes[model_type]
            self._models[model_type] = model_class()
            logger.info(f"[Registry] 创建模型实例: {model_type}")

        return self._models[model_type]

    async def _manage_vram(self, target_model_type: str) -> None:
        """
        显存管理。

        检查当前已加载的模型数量，如果超过最大值，
        则卸载最早加载的模型以释放显存。

        Args:
            target_model_type: 即将加载的目标模型类型
        """
        # 统计当前已加载的模型
        loaded_models = [
            (mt, m) for mt, m in self._models.items() if m.is_loaded
        ]

        # 如果目标模型已经加载，不需要管理
        if target_model_type in [mt for mt, _ in loaded_models]:
            return

        # 计算加载新模型后已加载的模型数
        # 如果超过最大值，需要卸载模型
        while len(loaded_models) >= self._max_loaded_models:
            # 按加载时间排序，卸载最早加载的
            # 这里简单地卸载第一个非目标模型
            model_to_unload = None
            for mt, m in loaded_models:
                if mt != target_model_type:
                    model_to_unload = (mt, m)
                    break

            if model_to_unload is None:
                break

            mt, m = model_to_unload
            logger.info(f"[Registry] 显存管理: 卸载模型 {mt} 以腾出空间")
            m.unload()
            loaded_models.remove((mt, m))

        # 清理 GPU 缓存
        clear_gpu_cache()

        # 打印当前显存状态
        vram = get_vram_info()
        if vram["total"] > 0:
            logger.info(
                f"[Registry] 当前显存: "
                f"{format_bytes(vram['used'])} / {format_bytes(vram['total'])} "
                f"(可用 {format_bytes(vram['free'])})"
            )

    def get_model_info(self, model_type: str) -> Optional[dict]:
        """
        获取模型信息（不需要加载模型）。

        Args:
            model_type: 模型类型

        Returns:
            模型信息字典，如果模型不存在返回 None
        """
        if model_type not in self._model_classes:
            return None

        # 如果已有实例，直接获取信息
        if model_type in self._models:
            return self._models[model_type].get_info()

        # 否则创建临时实例获取信息
        try:
            model_class = self._model_classes[model_type]
            temp_model = model_class()
            return temp_model.get_info()
        except Exception as e:
            logger.error(f"获取模型信息失败: {model_type} - {e}")
            return None

    def get_all_models_info(self) -> List[dict]:
        """
        获取所有模型的信息列表。

        Returns:
            模型信息列表
        """
        result = []
        for model_type in self._model_classes:
            info = self.get_model_info(model_type)
            if info:
                result.append(info)
        return result

    def get_installed_models(self) -> List[str]:
        """
        获取已安装的模型列表。

        Returns:
            已安装的模型类型列表
        """
        installed = []
        for model_type in self._model_classes:
            info = self.get_model_info(model_type)
            if info and info.get("installed", False):
                installed.append(model_type)
        return installed

    def get_current_model(self) -> Optional[str]:
        """
        获取当前加载到显存的模型类型。

        Returns:
            当前模型类型，如果没有模型加载返回 None
        """
        return self._current_model_type

    async def download_model(
        self,
        model_type: str,
        progress_callback=None,
    ) -> None:
        """
        下载指定模型。

        Args:
            model_type: 模型类型
            progress_callback: 下载进度回调

        Raises:
            ValueError: 不支持的模型类型
            RuntimeError: 下载失败
        """
        if not self.is_supported(model_type):
            raise ValueError(
                f"不支持的模型类型: {model_type}. "
                f"支持的类型: {self.list_supported_models()}"
            )

        model = await self._get_or_create_model(model_type)
        await model.download(progress_callback)

    async def unload_model(self, model_type: str) -> None:
        """
        卸载指定模型，释放显存。

        Args:
            model_type: 模型类型
        """
        if model_type in self._models:
            self._models[model_type].unload()
            if self._current_model_type == model_type:
                self._current_model_type = None
            clear_gpu_cache()
            logger.info(f"[Registry] 模型已卸载: {model_type}")

    async def unload_all(self) -> None:
        """卸载所有模型，释放全部显存"""
        for model_type, model in self._models.items():
            if model.is_loaded:
                model.unload()
                logger.info(f"[Registry] 模型已卸载: {model_type}")

        self._current_model_type = None
        clear_gpu_cache()
        logger.info("[Registry] 所有模型已卸载")

    def get_gpu_info(self) -> dict:
        """
        获取 GPU 信息。

        Returns:
            GPU 信息字典
        """
        return self._gpu_info

    def get_vram_usage(self) -> dict:
        """
        获取当前显存使用情况。

        Returns:
            dict: {"total": int, "free": int, "used": int, "usage_percent": float}
        """
        vram = get_vram_info()
        usage_percent = 0.0
        if vram["total"] > 0:
            usage_percent = (vram["used"] / vram["total"]) * 100

        return {
            "total": vram["total"],
            "free": vram["free"],
            "used": vram["used"],
            "usage_percent": round(usage_percent, 1),
            "total_formatted": format_bytes(vram["total"]),
            "free_formatted": format_bytes(vram["free"]),
            "used_formatted": format_bytes(vram["used"]),
        }

    def get_status(self) -> dict:
        """
        获取注册表的完整状态信息。

        Returns:
            dict: 包含以下字段
                - supported_models: 支持的模型列表
                - installed_models: 已安装的模型列表
                - current_model: 当前加载的模型
                - loaded_models: 已加载到显存的模型列表
                - gpu_info: GPU 信息
                - vram_usage: 显存使用情况
        """
        loaded_models = [
            mt for mt, m in self._models.items() if m.is_loaded
        ]

        return {
            "supported_models": self.list_supported_models(),
            "installed_models": self.get_installed_models(),
            "current_model": self._current_model_type,
            "loaded_models": loaded_models,
            "max_loaded_models": self._max_loaded_models,
            "gpu_info": self._gpu_info,
            "vram_usage": self.get_vram_usage(),
        }

    async def preload_model(self, model_type: str) -> None:
        """
        预加载模型到显存。

        在不生成视频的情况下，提前将模型加载到显存，
        以减少首次生成时的等待时间。

        Args:
            model_type: 模型类型

        Raises:
            ValueError: 不支持的模型类型
            RuntimeError: 模型未安装或加载失败
        """
        logger.info(f"[Registry] 预加载模型: {model_type}")
        await self.get_model(model_type)
        logger.info(f"[Registry] 模型预加载完成: {model_type}")


# ============================================================
# 全局单例
# ============================================================

_registry_instance: Optional[ModelRegistry] = None
_registry_lock = asyncio.Lock()


async def get_registry() -> ModelRegistry:
    """
    获取全局模型注册表单例。

    使用异步锁保证线程安全的单例创建。

    Returns:
        ModelRegistry: 全局注册表实例
    """
    global _registry_instance
    if _registry_instance is None:
        async with _registry_lock:
            if _registry_instance is None:
                _registry_instance = ModelRegistry()
    return _registry_instance


def get_registry_sync() -> ModelRegistry:
    """
    获取全局模型注册表单例（同步版本）。

    注意：此函数不保证线程安全，仅在没有异步上下文时使用。
    推荐使用 get_registry() 异步版本。

    Returns:
        ModelRegistry: 全局注册表实例
    """
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = ModelRegistry()
    return _registry_instance


if __name__ == "__main__":
    # 模块直接运行时，测试注册表功能
    import json

    logging.basicConfig(level=logging.DEBUG)

    registry = ModelRegistry()

    print("=" * 60)
    print("模型注册表状态")
    print("=" * 60)
    print(f"支持的模型: {registry.list_supported_models()}")
    print(f"已安装的模型: {registry.get_installed_models()}")
    print(f"当前模型: {registry.get_current_model()}")

    print("\n所有模型信息:")
    for info in registry.get_all_models_info():
        print(f"  - {info['type']}: {info['name']} "
              f"(已安装: {info['installed']}, 已加载: {info['loaded']})")

    print(f"\nGPU 信息: {registry.get_gpu_info()}")
    print(f"显存使用: {registry.get_vram_usage()}")
    print("=" * 60)
