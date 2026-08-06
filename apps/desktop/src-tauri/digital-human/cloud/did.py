# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — D-ID 提供商
===============================

通过 D-ID REST API 生成数字人视频。

D-ID 是国际知名的数字人平台，核心功能就是图片+音频生成说话视频。
API 简单，注册即用，适合国际项目。

文档：https://docs.d-id.com
定价：https://www.d-id.com/pricing/api/
"""

import asyncio
import base64
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from .base import CloudProviderBase

logger = logging.getLogger("aurora.cloud.did")


class DIDProvider(CloudProviderBase):
    """D-ID 数字人提供商"""

    PROVIDER_ID = "did"
    PROVIDER_NAME = "D-ID"
    REQUIRES_API_KEY = True
    CHINA_AVAILABLE = False
    DOCS_URL = "https://docs.d-id.com"

    BASE_URL = "https://api.d-id.com"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get("api_key", "")

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def _get_headers(self) -> Dict[str, str]:
        # D-ID 使用 Basic Auth: base64(api_key:)
        credentials = base64.b64encode(f"{self.api_key}:".encode()).decode()
        return {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json",
        }

    async def upload_image(self, image_path: str) -> str:
        """上传图片到 D-ID，返回图片 URL"""
        if image_path.startswith("http://") or image_path.startswith("https://"):
            return image_path

        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        # D-ID 有上传图片接口
        with open(path, "rb") as f:
            image_data = f.read()

        # 使用 multipart 上传
        form = aiohttp.FormData()
        form.add_field("image", image_data, filename=path.name, content_type="image/jpeg")

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.BASE_URL}/images",
                headers={"Authorization": f"Basic {base64.b64encode(f'{self.api_key}:'.encode()).decode()}"},
                data=form,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                result = await resp.json()
                if resp.status != 201:
                    raise RuntimeError(f"D-ID 图片上传失败: {result}")

                image_url = result.get("url")
                logger.info(f"D-ID 图片已上传: {image_url}")
                return image_url

    async def upload_audio(self, audio_path: str) -> str:
        """
        D-ID 的 talks 接口可以直接接收 base64 音频，
        不需要单独上传。这里返回文件路径，在 submit_task 中处理。
        """
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
        model_name: str = "default",
        resolution: str = "480p",
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        提交 D-ID talks 任务。

        D-ID API:
          POST /talks
          Body: { "source_url": image_url, "script": { "type": "audio", "audio_url": audio_url } }
        """
        payload = {
            "source_url": image_url,
            "script": {
                "type": "audio",
                "audio_url": audio_url,
            },
            "config": {
                "result_format": "mp4",
                **(extra_params or {}),
            },
        }

        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.BASE_URL}/talks",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                if resp.status != 201:
                    error_msg = result.get("kind", result.get("description", f"API 返回错误: {resp.status}"))
                    raise RuntimeError(f"D-ID 任务提交失败: {error_msg}")

                talk_id = result.get("id")
                logger.info(f"D-ID 任务已提交: {talk_id}")
                return talk_id

    async def poll_task(self, cloud_task_id: str) -> Dict[str, Any]:
        """轮询 D-ID talks 任务状态"""
        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.BASE_URL}/talks/{cloud_task_id}",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                result = await resp.json()

                if resp.status != 200:
                    return {"status": "failed", "progress": 0, "message": "查询失败", "error": str(result)}

                status = result.get("status", "created")

                status_map = {
                    "created": ("pending", 10, "任务已创建"),
                    "started": ("running", 50, "视频生成中..."),
                    "done": ("succeeded", 100, "生成完成"),
                    "error": ("failed", 0, "生成失败"),
                }

                mapped_status, progress, message = status_map.get(status, ("pending", 0, "未知状态"))

                video_url = ""
                error = ""

                if mapped_status == "succeeded":
                    result_url = result.get("result_url", "")
                    video_url = result_url
                    message = "视频生成完成"
                elif mapped_status == "failed":
                    error = result.get("error", {}).get("kind", "生成失败")
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

        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.get(video_url, headers=headers, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"下载失败: HTTP {resp.status}")
                with open(local_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(8192):
                        f.write(chunk)

        return local_path

    def get_models(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": "default",
                "name": "D-ID Talks",
                "description": "D-ID 核心功能：图片+音频 → 口型同步说话视频，注册即用",
                "max_resolution": "480p",
                "price_per_second": 0.013,  # ~$0.78/分钟 ≈ $0.013/秒
                "features": ["简单易用", "快速接入", "国际服务"],
                "recommended": True,
            },
        ]
