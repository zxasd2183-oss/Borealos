# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 火山引擎/即梦提供商
========================================

通过火山引擎方舟 (Ark) 平台调用即梦/Seedance API。

支持的模型：
  - seedance     Seedance 视频生成，支持多模态输入
  - jimeng_dh    即梦数字人快速模式，1元/秒

工作流程：
  1. 上传图片和音频（获取火山引擎可访问的 URL）
  2. 通过方舟 API 提交视频生成任务
  3. 轮询任务状态
  4. 下载结果

文档：https://ark.volcengine.com/docs
计费：https://www.volcengine.com/docs/85621/1544715
"""

import asyncio
import base64
import hashlib
import hmac
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import aiohttp

from .base import CloudProviderBase

logger = logging.getLogger("aurora.cloud.volcengine")


class VolcengineProvider(CloudProviderBase):
    """火山引擎/即梦数字人提供商"""

    PROVIDER_ID = "volcengine"
    PROVIDER_NAME = "火山引擎/即梦"
    REQUIRES_API_KEY = True
    CHINA_AVAILABLE = True
    DOCS_URL = "https://www.volcengine.com/docs/85621/1544715"

    # 火山引擎 API 基础地址
    BASE_URL = "https://visual.volcengineapi.com"
    ARK_URL = "https://ark.cn-beijing.volces.com/api/v3"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.access_key = config.get("access_key", "")
        self.secret_key = config.get("secret_key", "")
        self.app_id = config.get("app_id", "")
        self.region = config.get("region", "cn-north-1")
        self.service = "cv"

    def validate_config(self) -> bool:
        """验证配置：需要 AccessKey + SecretKey + AppID"""
        return bool(self.access_key and self.secret_key and self.app_id)

    async def upload_image(self, image_path: str) -> str:
        """上传图片，返回 URL 或 base64"""
        if image_path.startswith("http://") or image_path.startswith("https://"):
            return image_path

        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        with open(path, "rb") as f:
            image_data = f.read()

        ext = path.suffix.lower().lstrip(".")
        mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}.get(ext, "jpeg")
        b64 = base64.b64encode(image_data).decode("utf-8")
        return f"data:image/{mime};base64,{b64}"

    async def upload_audio(self, audio_path: str) -> str:
        """上传音频，返回 URL 或 base64"""
        if audio_path.startswith("http://") or audio_path.startswith("https://"):
            return audio_path

        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"音频文件不存在: {audio_path}")

        with open(path, "rb") as f:
            audio_data = f.read()

        ext = path.suffix.lower().lstrip(".")
        mime = {"wav": "wav", "mp3": "mpeg", "flac": "flac"}.get(ext, "mpeg")
        b64 = base64.b64encode(audio_data).decode("utf-8")
        return f"data:audio/{mime};base64,{b64}"

    def _sign_request(self, method: str, path: str, query: str, body: str) -> Dict[str, str]:
        """
        生成火山引擎 V4 签名。

        火山引擎使用 AWS Signature V4 兼容的签名算法。
        """
        now = datetime.utcnow()
        date_stamp = now.strftime("%Y%m%d")
        datetime_stamp = now.strftime("%Y%m%dT%H%M%SZ")

        canonical_uri = quote(path, safe="/")
        canonical_query = quote(query, safe="=&")

        # 生成签名
        payload_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()

        canonical_headers = (
            f"content-type:application/json\n"
            f"host:visual.volcengineapi.com\n"
            f"x-content-sha256:{payload_hash}\n"
            f"x-date:{datetime_stamp}\n"
        )
        signed_headers = "content-type;host;x-content-sha256;x-date"

        canonical_request = f"{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"

        credential_scope = f"{date_stamp}/{self.region}/{self.service}/request"
        string_to_sign = (
            f"HMAC-SHA256\n{datetime_stamp}\n{credential_scope}\n"
            + hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
        )

        # 派生签名密钥
        def get_signature_key(key: str, date: str, region: str, service: str) -> bytes:
            k_date = hmac.new(key.encode("utf-8"), date.encode("utf-8"), hashlib.sha256).digest()
            k_region = hmac.new(k_date, region.encode("utf-8"), hashlib.sha256).digest()
            k_service = hmac.new(k_region, service.encode("utf-8"), hashlib.sha256).digest()
            return hmac.new(k_service, b"request", hashlib.sha256).digest()

        signing_key = get_signature_key(self.secret_key, date_stamp, self.region, self.service)
        signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        authorization = (
            f"HMAC-SHA256 Credential={self.access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )

        return {
            "Authorization": authorization,
            "Content-Type": "application/json",
            "Host": "visual.volcengineapi.com",
            "X-Content-Sha256": payload_hash,
            "X-Date": datetime_stamp,
        }

    async def submit_task(
        self,
        image_url: str,
        audio_url: str,
        model_name: str = "jimeng_dh",
        resolution: str = "480p",
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """提交即梦/火山引擎视频生成任务"""
        api_path = "/"
        query = "Action=CVProcess&Version=2022-08-31"

        payload_body = {
            "req_key": "digital_human_quick" if model_name == "jimeng_dh" else "lipsync_standard",
            "image": image_url,
            "audio": audio_url,
            "resolution": resolution,
            "appid": self.app_id,
            **(extra_params or {}),
        }

        body_str = __import__("json").dumps(payload_body)
        headers = self._sign_request("POST", api_path, query, body_str)

        url = f"{self.BASE_URL}{api_path}?{query}"

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, data=body_str, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                result = await resp.json()
                if resp.status != 200 or result.get("code", 0) != 10000:
                    error_msg = result.get("message", f"API 返回错误: {resp.status}")
                    raise RuntimeError(error_msg)

                task_id = result.get("data", {}).get("task_id")
                if not task_id:
                    raise RuntimeError(f"未获取到任务 ID: {result}")

                logger.info(f"即梦任务已提交: {task_id}")
                return task_id

    async def poll_task(self, cloud_task_id: str) -> Dict[str, Any]:
        """轮询即梦任务状态"""
        api_path = "/"
        query = "Action=CVGetResult&Version=2022-08-31"

        payload_body = {
            "req_key": "digital_human_quick",
            "task_id": cloud_task_id,
            "appid": self.app_id,
        }

        body_str = __import__("json").dumps(payload_body)
        headers = self._sign_request("POST", api_path, query, body_str)

        url = f"{self.BASE_URL}{api_path}?{query}"

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, data=body_str, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                result = await resp.json()

                if resp.status != 200:
                    return {"status": "failed", "progress": 0, "message": "查询失败", "error": str(result)}

                resp_data = result.get("data", {})
                code = result.get("code", 0)

                if code == 10000 and resp_data.get("video_url"):
                    return {
                        "status": "succeeded",
                        "progress": 100,
                        "message": "视频生成完成",
                        "video_url": resp_data["video_url"],
                        "error": "",
                    }
                elif code == 10000:
                    return {"status": "running", "progress": 50, "message": "视频生成中...", "video_url": "", "error": ""}
                elif code == 50412:
                    return {"status": "pending", "progress": 10, "message": "任务排队中...", "video_url": "", "error": ""}
                else:
                    error_msg = result.get("message", "生成失败")
                    return {"status": "failed", "progress": 0, "message": error_msg, "video_url": "", "error": error_msg}

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
                "id": "jimeng_dh",
                "name": "即梦数字人快速模式",
                "description": "火山引擎数字人快速模式，图片+音频生成口型同步说话视频",
                "max_resolution": "1080p",
                "price_per_second": 1.0,
                "features": ["口型同步", "国内直连", "字节生态"],
                "recommended": True,
            },
            {
                "id": "seedance",
                "name": "Seedance 视频生成",
                "description": "即梦3.0视频生成，支持多模态输入，可通过@引用图片和音频",
                "max_resolution": "1080p",
                "price_per_second": 0.63,
                "features": ["多模态", "高分辨率", "灵活提示词"],
            },
        ]
