# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — HeyGen 提供商
=================================

通过 HeyGen REST API 生成数字人视频。

HeyGen 提供高质量 Avatar，支持 Photo Avatar 和 Video Avatar。
Avatar IV 引擎口型更精准，但价格更高。

文档：https://docs.heygen.com/docs/quick-start
定价：https://intercom.help/heygen/en/articles/10060327
"""

import asyncio
import base64
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from .base import CloudProviderBase

logger = logging.getLogger("aurora.cloud.heygen")


class HeyGenProvider(CloudProviderBase):
    """HeyGen 数字人提供商"""

    PROVIDER_ID = "heygen"
    PROVIDER_NAME = "HeyGen"
    REQUIRES_API_KEY = True
    CHINA_AVAILABLE = False
    DOCS_URL = "https://docs.heygen.com/docs/quick-start"

    BASE_URL = "https://api.heygen.com/v1"
    BASE_URL_V2 = "https://api.heygen.com/v2"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get("api_key", "")

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def _get_headers(self) -> Dict[str, str]:
        return {
            "X-Api-Key": self.api_key,
            "Content-Type": "application/json",
        }

    async def upload_image(self, image_path: str) -> str:
        """HeyGen 支持通过 URL 或 base64 上传图片创建 Photo Avatar"""
        if image_path.startswith("http://") or image_path.startswith("https://"):
            return image_path

        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        with open(path, "rb") as f:
            image_data = f.read()

        b64 = base64.b64encode(image_data).decode()
        return f"data:image/jpeg;base64,{b64}"

    async def upload_audio(self, audio_path: str) -> str:
        """上传音频，HeyGen 支持 base64 音频"""
        if audio_path.startswith("http://") or audio_path.startswith("https://"):
            return audio_path

        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        with open(path, "rb") as f:
            audio_data = f.read()

        b64 = base64.b64encode(audio_data).decode()
        return f"data:audio/mpeg;base64,{b64}"

    async def submit_task(
        self,
        image_url: str,
        audio_url: str,
        model_name: str = "photo_avatar",
        resolution: str = "480p",
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        提交 HeyGen 视频生成任务。

        使用 V2 video/generate 接口，指定 Photo Avatar。
        """
        payload = {
            "video_inputs": [
                {
                    "character": {
                        "type": "photo",
                        "photo_url": image_url,
                    },
                    "voice": {
                        "type": "audio",
                        "audio_url": audio_url,
                    },
                }
            ],
            "dimension": {
                "width": 480 if resolution == "480p" else 720,
                "height": 480 if resolution == "480p" else 720,
            },
            **(extra_params or {}),
        }

        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.BASE_URL_V2}/video/generate",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                if resp.status != 200:
                    error_msg = result.get("message", f"API 返回错误: {resp.status}")
                    raise RuntimeError(f"HeyGen 任务提交失败: {error_msg}")

                video_id = result.get("data", {}).get("video_id")
                if not video_id:
                    raise RuntimeError(f"未获取到视频 ID: {result}")

                logger.info(f"HeyGen 任务已提交: {video_id}")
                return video_id

    async def poll_task(self, cloud_task_id: str) -> Dict[str, Any]:
        """轮询 HeyGen 视频生成状态"""
        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.BASE_URL}/video_status.get",
                params={"video_id": cloud_task_id},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                result = await resp.json()

                if resp.status != 200:
                    return {"status": "failed", "progress": 0, "message": "查询失败", "error": str(result)}

                data = result.get("data", {})
                status = data.get("status", "processing")

                status_map = {
                    "waiting": ("pending", 10, "任务排队中..."),
                    "processing": ("running", 50, "视频生成中..."),
                    "completed": ("succeeded", 100, "生成完成"),
                    "failed": ("failed", 0, "生成失败"),
                    "cancelled": ("failed", 0, "任务已取消"),
                }

                mapped_status, progress, message = status_map.get(status, ("pending", 0, "未知状态"))

                video_url = ""
                error = ""

                if mapped_status == "succeeded":
                    video_url = data.get("video_url", "")
                    message = "视频生成完成"
                elif mapped_status == "failed":
                    error = data.get("error", "生成失败")
                    message = error

                return {
                    "status": mapped_status,
                    "progress": progress,
                    "message": message,
                    "video_url": video_url,
                    "error": error,
                }

    async def download_result(self, video_url: str, local_path: str) -> str:
        """下载视频"""
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)

        async with aiohttp.ClientSession() as session:
            async with session.get(video_url, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"下载失败: HTTP {resp.status}")
                with open(local_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(8192):
                        f.write(chunk)

        return local_path

    def get_models(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "photo_avatar",
                "name": "HeyGen Photo Avatar",
                "description": "使用照片创建数字人，支持图片+音频生成说话视频",
                "max_resolution": "1080p",
                "price_per_second": 0.017,  # ~$0.99/分钟 ≈ $0.017/秒 (Pro Unlimited)
                "features": ["照片数字人", "国际服务", "高质量"],
                "recommended": True,
            },
            {
                "id": "avatar_iv",
                "name": "HeyGen Avatar IV",
                "description": "Avatar IV 引擎，口型更精准，画质更高（价格较高）",
                "max_resolution": "1080p",
                "price_per_second": 0.099,  # ~$5.94/分钟 ≈ $0.099/秒
                "features": ["口型精准", "4K支持", "最高质量"],
            },
        ]
