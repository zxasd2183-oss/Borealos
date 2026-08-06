# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 阿里云通义万相提供商
=========================================

通过阿里云百炼平台 (DashScope) 调用通义万相数字人 API。

支持的模型：
  - emo          悦动人像，0.08元/秒（1:1画幅），适合肖像特写
  - wan2.2-s2v   万相视频生成，0.5元/秒（480P），支持全身/半身

工作流程：
  1. 上传图片和音频到阿里云 OSS 或使用公网 URL
  2. 调用图片检测接口 (wan2.2-s2v-detect) 验证图片合规性
  3. 提交视频生成任务 (wan2.2-s2v / emo)
  4. 轮询任务状态
  5. 下载结果视频

文档：https://help.aliyun.com/zh/model-studio/wan-s2v-overview/
"""

import asyncio
import base64
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from .base import CloudProviderBase, GenerationTask

logger = logging.getLogger("aurora.cloud.aliyun_wan")


class AliyunWanProvider(CloudProviderBase):
    """阿里云通义万相数字人提供商"""

    PROVIDER_ID = "aliyun_wan"
    PROVIDER_NAME = "阿里云通义万相"
    REQUIRES_API_KEY = True
    CHINA_AVAILABLE = True
    DOCS_URL = "https://help.aliyun.com/zh/model-studio/wan-s2v-overview/"

    # API 基础地址
    BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
    # 异步任务查询地址
    TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get("api_key", "")
        # OSS 配置（用于上传文件获取公网 URL）
        self.oss_bucket = config.get("oss_bucket", "")
        self.oss_region = config.get("oss_region", "cn-beijing")
        self.oss_access_key = config.get("oss_access_key", "")
        self.oss_access_secret = config.get("oss_access_secret", "")

    def validate_config(self) -> bool:
        """验证配置：至少需要 API Key"""
        return bool(self.api_key)

    async def upload_image(self, image_path: str) -> str:
        """
        上传图片。如果已经是 URL 则直接返回，否则使用 base64 编码上传或 OSS。

        对于阿里云，图片需要是公网可访问的 URL 或 OSS URL。
        如果用户没有配置 OSS，我们尝试使用 base64 data URI（部分接口支持）。
        """
        if image_path.startswith("http://") or image_path.startswith("https://"):
            return image_path

        # 读取图片并转换为 base64
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        with open(path, "rb") as f:
            image_data = f.read()

        # 如果配置了 OSS，上传到 OSS
        if self.oss_bucket and self.oss_access_key:
            return await self._upload_to_oss(image_path, "image")

        # 否则使用临时图床或要求用户提供 URL
        # 这里简化处理：返回 base64 编码的 data URI
        ext = path.suffix.lower().lstrip(".")
        mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp", "bmp": "bmp"}.get(ext, "jpeg")
        b64 = base64.b64encode(image_data).decode("utf-8")
        return f"data:image/{mime};base64,{b64}"

    async def upload_audio(self, audio_path: str) -> str:
        """上传音频文件，逻辑同上传图片"""
        if audio_path.startswith("http://") or audio_path.startswith("https://"):
            return audio_path

        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        with open(path, "rb") as f:
            audio_data = f.read()

        if self.oss_bucket and self.oss_access_key:
            return await self._upload_to_oss(audio_path, "audio")

        ext = path.suffix.lower().lstrip(".")
        mime = {"wav": "wav", "mp3": "mpeg", "flac": "flac", "ogg": "ogg", "m4a": "mp4"}.get(ext, "mpeg")
        b64 = base64.b64encode(audio_data).decode("utf-8")
        return f"data:audio/{mime};base64,{b64}"

    async def _upload_to_oss(self, file_path: str, file_type: str) -> str:
        """上传文件到阿里云 OSS，返回公网 URL"""
        # 简化实现：实际需要安装 oss2 库
        # pip install oss2
        try:
            import oss2
        except ImportError:
            logger.warning("oss2 库未安装，回退到 base64 模式")
            # 回退到 base64
            with open(file_path, "rb") as f:
                data = f.read()
            b64 = base64.b64encode(data).decode()
            ext = Path(file_path).suffix.lower().lstrip(".")
            if file_type == "image":
                return f"data:image/{ext};base64,{b64}"
            else:
                return f"data:audio/{ext};base64,{b64}"

        auth = oss2.Auth(self.oss_access_key, self.oss_access_secret)
        bucket = oss2.Bucket(auth, f"https://{self.oss_bucket}.{self.oss_region}.aliyuncs.com", self.oss_bucket)

        ext = Path(file_path).suffix
        object_key = f"aurora/digital-human/{file_type}/{uuid.uuid4().hex}{ext}"

        bucket.put_object_from_file(object_key, file_path)

        return f"https://{self.oss_bucket}.{self.oss_region}.aliyuncs.com/{object_key}"

    async def submit_task(
        self,
        image_url: str,
        audio_url: str,
        model_name: str = "emo",
        resolution: str = "480p",
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        提交视频生成任务到阿里云通义万相。

        API 文档：https://help.aliyun.com/zh/model-studio/wan-s2v-api
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

        # 根据模型选择不同的 API
        if model_name == "emo":
            # EMO 模型 — 悦动人像
            payload = {
                "model": "emo",
                "input": {
                    "image_url": image_url,
                    "audio_url": audio_url,
                },
                "parameters": {
                    "resolution": resolution,
                    **(extra_params or {}),
                },
            }
        elif model_name == "wan2.2-s2v":
            # wan2.2-s2v — 通义万相视频生成
            payload = {
                "model": "wan2.2-s2v",
                "input": {
                    "image_url": image_url,
                    "audio_url": audio_url,
                },
                "parameters": {
                    "resolution": resolution,
                    **(extra_params or {}),
                },
            }
        else:
            raise ValueError(f"不支持的模型: {model_name}")

        logger.info(f"提交阿里云通义万相任务: model={model_name}, resolution={resolution}")

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.BASE_URL}/services/aigc/video-generation/generation",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()

                if resp.status != 200:
                    error_msg = result.get("message", f"API 返回错误: {resp.status}")
                    logger.error(f"阿里云 API 错误: {error_msg}")
                    raise RuntimeError(error_msg)

                # 异步模式返回 task_id
                task_id = result.get("output", {}).get("task_id")
                if not task_id:
                    raise RuntimeError(f"未获取到任务 ID: {result}")

                logger.info(f"任务已提交: {task_id}")
                return task_id

    async def poll_task(self, cloud_task_id: str) -> Dict[str, Any]:
        """
        轮询任务状态。

        返回格式：
            {
                "status": "pending" | "running" | "succeeded" | "failed",
                "progress": 0-100,
                "message": str,
                "video_url": str (仅 succeeded),
                "error": str (仅 failed),
            }
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
        }

        url = self.TASK_URL.format(task_id=cloud_task_id)

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                result = await resp.json()

                if resp.status != 200:
                    return {
                        "status": "failed",
                        "progress": 0,
                        "message": f"查询失败: {resp.status}",
                        "error": result.get("message", "未知错误"),
                    }

                output = result.get("output", {})
                task_status = output.get("task_status", "PENDING")

                # 阿里云状态映射
                status_map = {
                    "PENDING": ("pending", 10, "任务排队中..."),
                    "RUNNING": ("running", 50, "视频生成中..."),
                    "SUCCEEDED": ("succeeded", 100, "生成完成"),
                    "FAILED": ("failed", 0, "生成失败"),
                    "UNKNOWN": ("pending", 0, "状态未知"),
                }

                status, progress, message = status_map.get(task_status, ("pending", 0, "未知状态"))

                video_url = ""
                error = ""

                if status == "succeeded":
                    # 获取视频 URL
                    results = output.get("results", {})
                    video_url = results.get("video_url", "")
                    if not video_url:
                        # 尝试从 video 字段获取
                        video_url = results.get("video", {}).get("url", "")
                    message = "视频生成完成"

                elif status == "failed":
                    error = output.get("message", "生成失败，请检查图片和音频是否合规")
                    message = error

                return {
                    "status": status,
                    "progress": progress,
                    "message": message,
                    "video_url": video_url,
                    "error": error,
                }

    async def download_result(self, video_url: str, local_path: str) -> str:
        """下载生成的视频到本地"""
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)

        async with aiohttp.ClientSession() as session:
            async with session.get(video_url, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"下载失败: HTTP {resp.status}")

                with open(local_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(8192):
                        f.write(chunk)

        logger.info(f"视频已下载: {local_path}")
        return local_path

    def get_models(self) -> List[Dict[str, Any]]:
        """返回阿里云通义万相支持的模型列表"""
        return [
            {
                "id": "emo",
                "name": "悦动人像 EMO",
                "description": "阿里云 EMO 模型，适合人物特写/肖像，口型表情自然，价格极低",
                "max_resolution": "720p",
                "price_per_second": 0.08,
                "features": ["肖像特写", "口型自然", "超低价", "国内直连"],
                "recommended": True,
            },
            {
                "id": "wan2.2-s2v",
                "name": "万相视频生成 wan2.2-s2v",
                "description": "支持肖像/全身/半身/卡通，不限画幅，视频质量更高",
                "max_resolution": "720p",
                "price_per_second": 0.5,
                "features": ["全身/半身", "不限画幅", "支持卡通", "高质量"],
            },
        ]
