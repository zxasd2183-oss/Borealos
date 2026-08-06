# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 自定义远程服务提供商
=========================================

用户可以部署自己的 Python 推理服务到带 GPU 的远程服务器上，
通过此提供商连接远程服务。

这意味着用户完全自主可控：
  - 模型代码是开源的（MuseTalk/SadTalker 等）
  - 推理服务是我们自己写的
  - 部署在用户自己的服务器上
  - Aurora 只是作为客户端连接

这是最"自研"的方式——连推理引擎都跑在自己的服务器上。
"""

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from .base import CloudProviderBase

logger = logging.getLogger("aurora.cloud.custom")


class CustomProvider(CloudProviderBase):
    """自定义远程推理服务提供商"""

    PROVIDER_ID = "custom"
    PROVIDER_NAME = "自定义远程服务"
    REQUIRES_API_KEY = False
    CHINA_AVAILABLE = True
    DOCS_URL = ""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.server_url = config.get("server_url", "http://localhost:7861")
        self.api_token = config.get("api_token", "")  # 可选的认证 token

    def validate_config(self) -> bool:
        """只需要服务器 URL"""
        return bool(self.server_url)

    def _get_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    async def upload_image(self, image_path: str) -> str:
        """
        对于自定义远程服务，直接传文件路径。
        如果服务器和客户端在同一台机器，直接用本地路径。
        否则需要通过 HTTP 上传文件。
        """
        if image_path.startswith("http://") or image_path.startswith("https://"):
            return image_path

        # 尝试通过 HTTP 上传到远程服务器
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        # 上传文件到远程服务器
        form = aiohttp.FormData()
        with open(path, "rb") as f:
            form.add_field("file", f, filename=path.name, content_type="image/jpeg")

        headers = {}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.server_url}/avatar/upload",
                data=form,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return result.get("path", image_path)
                # 上传失败，回退到本地路径（假设服务器可访问同一文件系统）
                logger.warning(f"远程上传失败，使用本地路径: {image_path}")
                return image_path

    async def upload_audio(self, audio_path: str) -> str:
        """同 upload_image 逻辑"""
        if audio_path.startswith("http://") or audio_path.startswith("https://"):
            return audio_path

        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        # 如果服务器在本地，直接用路径
        if "localhost" in self.server_url or "127.0.0.1" in self.server_url:
            return audio_path

        # 远程服务器需要上传
        form = aiohttp.FormData()
        with open(path, "rb") as f:
            form.add_field("file", f, filename=path.name, content_type="audio/mpeg")

        headers = {}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.server_url}/upload/audio",
                data=form,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    return result.get("path", audio_path)
                logger.warning(f"远程音频上传失败，使用本地路径: {audio_path}")
                return audio_path

    async def submit_task(
        self,
        image_url: str,
        audio_url: str,
        model_name: str = "musetalk",
        resolution: str = "480p",
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """提交生成任务到自定义远程服务"""
        payload = {
            "avatar_path": image_url,
            "audio_path": audio_url,
            "model_type": model_name,
            "output_resolution": resolution,
            "fps": 25,
            **(extra_params or {}),
        }

        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.server_url}/generate",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                result = await resp.json()
                if resp.status != 200:
                    raise RuntimeError(f"远程服务错误: {result.get('detail', resp.status)}")

                task_id = result.get("task_id", str(uuid.uuid4()))
                logger.info(f"远程任务已提交: {task_id}")
                return task_id

    async def poll_task(self, cloud_task_id: str) -> Dict[str, Any]:
        """轮询远程服务任务状态"""
        headers = self._get_headers()

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.server_url}/generate/status",
                params={"task_id": cloud_task_id},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                result = await resp.json()

                if resp.status != 200:
                    return {"status": "failed", "progress": 0, "message": "查询失败", "error": str(result)}

                status = result.get("status", "pending")
                progress = result.get("progress", 0)
                message = result.get("message", "")
                video_url = result.get("video_url", "")
                error = result.get("error", "")

                # 标准化状态
                status_map = {
                    "pending": "pending",
                    "preparing": "running",
                    "generating": "running",
                    "completed": "succeeded",
                    "succeeded": "succeeded",
                    "failed": "failed",
                    "error": "failed",
                }

                return {
                    "status": status_map.get(status, status),
                    "progress": progress,
                    "message": message,
                    "video_url": video_url,
                    "error": error,
                }

    async def download_result(self, video_url: str, local_path: str) -> str:
        """下载视频"""
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)

        # 如果是本地服务器的路径
        if video_url.startswith("/"):
            # 直接复制
            import shutil
            shutil.copy2(video_url, local_path)
            return local_path

        async with aiohttp.ClientSession() as session:
            async with session.get(video_url, timeout=aiohttp.ClientTimeout(total=300)) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"下载失败: HTTP {resp.status}")
                with open(local_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(8192):
                        f.write(chunk)

        return local_path

    def get_models(self) -> List[Dict[str, Any]]:
        """自定义服务支持的模型（取决于远程服务安装了哪些）"""
        return [
            {
                "id": "musetalk",
                "name": "MuseTalk (远程)",
                "description": "MuseTalk 实时口型同步，部署在远程 GPU 服务器",
                "max_resolution": "1080p",
                "price_per_second": 0,  # 自部署无 API 费用
                "features": ["实时推理", "自部署", "零 API 费用"],
                "recommended": True,
            },
            {
                "id": "sadtalker",
                "name": "SadTalker (远程)",
                "description": "SadTalker 3DMM 驱动，部署在远程 GPU 服务器",
                "max_resolution": "512p",
                "price_per_second": 0,
                "features": ["3DMM", "自部署", "零 API 费用"],
            },
            {
                "id": "wav2lip",
                "name": "Wav2Lip (远程)",
                "description": "Wav2Lip 轻量级口型同步，部署在远程 GPU 服务器",
                "max_resolution": "480p",
                "price_per_second": 0,
                "features": ["轻量级", "自部署", "零 API 费用"],
            },
        ]
