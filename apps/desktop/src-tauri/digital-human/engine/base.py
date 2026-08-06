# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 基础模型接口模块
=====================================

本模块定义了所有数字人模型的抽象基类 BaseLipSyncModel。
所有具体的模型封装类（MuseTalk、SadTalker、Wav2Lip 等）都必须继承此基类，
并实现以下抽象方法：
  - load_model(): 加载模型到显存/内存
  - generate(): 生成数字人视频
  - is_installed(): 检查模型是否已安装
  - get_info(): 获取模型信息
  - download(): 下载模型文件

此设计确保所有模型具有统一的接口，便于服务器层统一调用。
"""

import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Callable, Optional, Union

from config import PATHS, MODEL_META

logger = logging.getLogger(__name__)


class BaseLipSyncModel(ABC):
    """
    数字人模型抽象基类。

    所有具体的口型同步/数字人生成模型都应继承此类，
    并实现所有抽象方法。

    类属性:
        MODEL_TYPE: 模型类型标识符（如 "musetalk", "sadtalker"）
        MODEL_NAME: 模型显示名称
        MODEL_DIR: 模型文件存储目录

    实例属性:
        _loaded: 模型是否已加载到显存/内存
        _device: 推理设备（"cuda" 或 "cpu"）
        _model_path: 模型文件路径
    """

    # 子类需要覆盖的类属性
    MODEL_TYPE: str = "base"
    MODEL_NAME: str = "Base Model"

    def __init__(self) -> None:
        """初始化基础模型"""
        self._loaded: bool = False
        self._device: str = "cpu"
        self._model_path: Path = PATHS.MODELS_DIR / self.MODEL_TYPE

        # 检测可用的推理设备
        self._detect_device()

    def _detect_device(self) -> None:
        """
        检测可用的推理设备。

        优先使用 GPU（CUDA），不可用时降级到 CPU。
        """
        try:
            import torch
            if torch.cuda.is_available():
                self._device = "cuda"
                gpu_name = torch.cuda.get_device_name(0)
                logger.info(f"[{self.MODEL_NAME}] 使用 GPU 推理: {gpu_name}")
            else:
                self._device = "cpu"
                logger.info(f"[{self.MODEL_NAME}] GPU 不可用，使用 CPU 推理")
        except ImportError:
            self._device = "cpu"
            logger.warning(f"[{self.MODEL_NAME}] PyTorch 未安装，使用 CPU 推理")

    @property
    def device(self) -> str:
        """获取当前推理设备"""
        return self._device

    @property
    def is_loaded(self) -> bool:
        """模型是否已加载到显存/内存"""
        return self._loaded

    @abstractmethod
    async def load_model(self) -> None:
        """
        加载模型到显存/内存。

        此方法在首次调用 generate() 时由 registry 触发（延迟加载）。
        子类需要实现具体的模型加载逻辑，包括：
          - 加载模型权重文件
          - 初始化推理管线
          - 将模型移动到指定设备

        Raises:
            RuntimeError: 模型未安装或加载失败
        """
        pass

    @abstractmethod
    async def generate(
        self,
        image_path: str,
        audio_path: str,
        output_path: str,
        progress_callback: Optional[Callable[[int, str], None]] = None,
        **kwargs,
    ) -> str:
        """
        生成数字人视频。

        将输入的人物图片和音频合成为口型同步的数字人视频。

        Args:
            image_path: 人物图片路径
            audio_path: 音频文件路径
            output_path: 输出视频文件路径
            progress_callback: 进度回调函数，签名为 (progress: int, message: str)
                               progress 范围 0-100，message 为当前步骤描述
            **kwargs: 模型特定参数（如分辨率、帧率等）

        Returns:
            输出视频文件路径

        Raises:
            RuntimeError: 模型未加载或生成失败
            FileNotFoundError: 输入文件不存在
        """
        pass

    @abstractmethod
    def is_installed(self) -> bool:
        """
        检查模型是否已安装（模型文件是否完整）。

        Returns:
            bool: True 表示模型文件已全部下载完成
        """
        pass

    @abstractmethod
    def get_info(self) -> dict:
        """
        获取模型信息。

        返回模型的元数据信息，包括名称、版本、描述、安装状态等。

        Returns:
            dict: 模型信息字典
        """
        pass

    @abstractmethod
    async def download(self, progress_callback: Optional[Callable] = None) -> None:
        """
        下载模型文件。

        从 HuggingFace / GitHub Releases 下载模型权重文件。

        Args:
            progress_callback: 下载进度回调函数

        Raises:
            RuntimeError: 下载失败
        """
        pass

    def unload(self) -> None:
        """
        从显存/内存中卸载模型。

        释放模型占用的显存资源。
        子类应覆盖此方法实现具体的卸载逻辑。
        """
        self._loaded = False
        logger.info(f"[{self.MODEL_NAME}] 模型已卸载")

        # 尝试清理 GPU 缓存
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except ImportError:
            pass

    def get_model_dir(self) -> Path:
        """获取模型文件存储目录"""
        return self._model_path

    def get_meta(self) -> dict:
        """获取模型元数据（从配置中读取）"""
        return MODEL_META.get_model_meta(self.MODEL_TYPE) or {}

    def _check_installed(self) -> None:
        """
        检查模型是否已安装，未安装则抛出异常。

        Raises:
            RuntimeError: 模型未安装
        """
        if not self.is_installed():
            raise RuntimeError(
                f"[{self.MODEL_NAME}] 模型未安装。"
                f"请先调用 download() 方法下载模型，"
                f"或通过 API /models/download 下载。"
            )

    def _check_loaded(self) -> None:
        """
        检查模型是否已加载，未加载则抛出异常。

        Raises:
            RuntimeError: 模型未加载
        """
        if not self._loaded:
            raise RuntimeError(
                f"[{self.MODEL_NAME}] 模型未加载。"
                f"请先调用 load_model() 方法加载模型。"
            )

    def _report_progress(
        self,
        progress_callback: Optional[Callable[[int, str], None]],
        progress: int,
        message: str,
    ) -> None:
        """
        报告生成进度。

        Args:
            progress_callback: 进度回调函数
            progress: 进度值（0-100）
            message: 进度描述信息
        """
        if progress_callback:
            try:
                progress_callback(progress, message)
            except Exception as e:
                logger.warning(f"进度回调异常: {e}")
        logger.info(f"[{self.MODEL_NAME}] 进度 {progress}%: {message}")
