# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 模型下载管理器模块
=======================================

本模块负责从 HuggingFace / GitHub Releases 下载模型文件，提供以下功能：
  - 支持断点续传（HTTP Range 请求）
  - 下载进度回调（用于 SSE 推送）
  - 文件完整性校验（SHA256）
  - 并行下载多个文件
  - 下载任务状态管理

下载流程：
  1. 创建下载任务（DownloadTask）
  2. 通过 ModelDownloader 下载
  3. 进度通过回调函数实时推送
  4. 下载完成后校验文件完整性
"""

import asyncio
import hashlib
import logging
import os
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple, Union
from urllib.parse import urlparse

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    requests = None

from config import PATHS, MODEL_DOWNLOADS

logger = logging.getLogger(__name__)


class DownloadStatus(str, Enum):
    """下载任务状态枚举"""
    PENDING = "pending"        # 等待中
    DOWNLOADING = "downloading"  # 下载中
    PAUSED = "paused"           # 已暂停
    COMPLETED = "completed"     # 已完成
    FAILED = "failed"           # 失败
    CANCELED = "canceled"       # 已取消


@dataclass
class DownloadProgress:
    """
    下载进度信息。

    Attributes:
        filename: 当前下载的文件名
        downloaded_bytes: 已下载字节数
        total_bytes: 文件总字节数（-1 表示未知）
        speed_bytes_per_sec: 下载速度（字节/秒）
        progress: 进度百分比（0-100）
        eta_seconds: 预计剩余时间（秒），-1 表示未知
    """
    filename: str = ""
    downloaded_bytes: int = 0
    total_bytes: int = -1
    speed_bytes_per_sec: float = 0.0
    progress: float = 0.0
    eta_seconds: float = -1.0


@dataclass
class DownloadTask:
    """
    下载任务数据结构。

    管理一个模型的所有文件的下载状态。

    Attributes:
        task_id: 任务唯一标识
        model_type: 模型类型（musetalk / sadtalker / wav2lip 等）
        model_name: 模型显示名称
        status: 当前状态
        progress: 当前下载进度
        total_files: 总文件数
        completed_files: 已完成文件数
        files: 文件下载信息列表
        error_message: 错误信息
        created_at: 创建时间
        updated_at: 更新时间
    """
    task_id: str
    model_type: str
    model_name: str = ""
    status: DownloadStatus = DownloadStatus.PENDING
    progress: DownloadProgress = field(default_factory=DownloadProgress)
    total_files: int = 0
    completed_files: int = 0
    files: List[dict] = field(default_factory=list)
    error_message: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        """转换为字典（用于 JSON 序列化）"""
        return {
            "task_id": self.task_id,
            "model_type": self.model_type,
            "model_name": self.model_name,
            "status": self.status.value,
            "progress": {
                "filename": self.progress.filename,
                "downloaded_bytes": self.progress.downloaded_bytes,
                "total_bytes": self.progress.total_bytes,
                "speed_bytes_per_sec": round(self.progress.speed_bytes_per_sec, 1),
                "progress": round(self.progress.progress, 1),
                "eta_seconds": round(self.progress.eta_seconds, 1),
            },
            "total_files": self.total_files,
            "completed_files": self.completed_files,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class ModelDownloader:
    """
    模型下载管理器。

    负责从 HuggingFace 或 GitHub Releases 下载模型文件，
    支持断点续传、进度回调和文件校验。

    用法示例：
        downloader = ModelDownloader()
        task = downloader.create_task("musetalk")
        await downloader.download_task(task, progress_callback=callback)
    """

    # 下载块大小（字节）
    CHUNK_SIZE: int = 1024 * 1024  # 1MB

    # 最大重试次数
    MAX_RETRIES: int = 3

    # 请求超时时间（秒）
    REQUEST_TIMEOUT: int = 30

    # 下载速度统计间隔（秒）
    SPEED_INTERVAL: float = 1.0

    def __init__(self) -> None:
        """初始化下载管理器"""
        self._tasks: Dict[str, DownloadTask] = {}
        self._session = None

        if requests is not None:
            self._session = requests.Session()
            # 配置重试策略
            retry = Retry(
                total=self.MAX_RETRIES,
                backoff_factor=1,
                status_forcelist=[429, 500, 502, 503, 504],
            )
            adapter = HTTPAdapter(max_retries=retry)
            self._session.mount("http://", adapter)
            self._session.mount("https://", adapter)

        logger.info("模型下载管理器已初始化")

    def create_task(self, model_type: str) -> DownloadTask:
        """
        创建模型下载任务。

        Args:
            model_type: 模型类型

        Returns:
            DownloadTask 对象

        Raises:
            ValueError: 未知的模型类型
        """
        # 获取模型下载配置
        download_config = self._get_download_config(model_type)
        if download_config is None:
            raise ValueError(f"未知的模型类型: {model_type}")

        # 生成任务 ID
        task_id = f"{model_type}_{int(time.time())}"

        # 创建任务
        task = DownloadTask(
            task_id=task_id,
            model_type=model_type,
            model_name=model_type.capitalize(),
            total_files=len(download_config.get("files", [])),
        )

        # 记录每个文件的信息
        for file_path, sha256 in download_config.get("files", []):
            task.files.append({
                "path": file_path,
                "sha256": sha256,
                "status": DownloadStatus.PENDING.value,
                "downloaded_bytes": 0,
                "total_bytes": 0,
            })

        self._tasks[task_id] = task
        logger.info(f"创建下载任务: {task_id} (模型: {model_type}, 文件数: {task.total_files})")

        return task

    def _get_download_config(self, model_type: str) -> Optional[dict]:
        """
        获取模型的下载配置。

        Args:
            model_type: 模型类型

        Returns:
            下载配置字典
        """
        config_map = {
            "musetalk": MODEL_DOWNLOADS.MUSETALK,
            "sadtalker": MODEL_DOWNLOADS.SADTALKER,
            "wav2lip": MODEL_DOWNLOADS.WAV2LIP,
            "echomimic": MODEL_DOWNLOADS.ECHOMIMIC,
            "hallo2": MODEL_DOWNLOADS.HALLO2,
        }
        return config_map.get(model_type)

    def _build_download_url(
        self,
        model_type: str,
        file_path: str,
    ) -> Tuple[str, Optional[str]]:
        """
        构建文件的下载 URL。

        支持 HuggingFace 和 GitHub Releases 两种仓库类型。

        Args:
            model_type: 模型类型
            file_path: 文件在仓库中的相对路径

        Returns:
            tuple: (下载 URL, 备用下载 URL 或 None)
        """
        config = self._get_download_config(model_type)
        if config is None:
            raise ValueError(f"未知的模型类型: {model_type}")

        repo_type = config.get("repo_type", "huggingface")

        if repo_type == "huggingface":
            repo_id = config["repo_id"]
            url = f"{MODEL_DOWNLOADS.HF_BASE}/{repo_id}/resolve/main/{file_path}"
            # HuggingFace 备用 CDN 地址
            alt_url = f"https://hf-mirror.com/{repo_id}/resolve/main/{file_path}"
            return url, alt_url

        elif repo_type == "github":
            repo_url = config["repo_url"]
            url = f"{repo_url}/{file_path}"
            # 备用 HuggingFace 地址（如果有配置）
            alt_url = None
            if "alt_repo_id" in config:
                alt_repo_id = config["alt_repo_id"]
                alt_url = f"{MODEL_DOWNLOADS.HF_BASE}/{alt_repo_id}/resolve/main/{file_path}"
            return url, alt_url

        else:
            raise ValueError(f"未知的仓库类型: {repo_type}")

    def get_task(self, task_id: str) -> Optional[DownloadTask]:
        """
        获取下载任务。

        Args:
            task_id: 任务 ID

        Returns:
            DownloadTask 对象或 None
        """
        return self._tasks.get(task_id)

    def get_all_tasks(self) -> List[DownloadTask]:
        """获取所有下载任务"""
        return list(self._tasks.values())

    def cancel_task(self, task_id: str) -> bool:
        """
        取消下载任务。

        Args:
            task_id: 任务 ID

        Returns:
            bool: True 表示取消成功
        """
        task = self._tasks.get(task_id)
        if task is None:
            return False

        if task.status in (DownloadStatus.COMPLETED, DownloadStatus.FAILED):
            return False

        task.status = DownloadStatus.CANCELED
        task.updated_at = time.time()
        logger.info(f"下载任务已取消: {task_id}")
        return True

    async def download_task(
        self,
        task: DownloadTask,
        progress_callback: Optional[Callable[[DownloadTask], None]] = None,
    ) -> bool:
        """
        执行下载任务。

        下载任务中的所有文件，支持断点续传和文件校验。

        Args:
            task: 下载任务对象
            progress_callback: 进度回调函数，接收 DownloadTask 对象

        Returns:
            bool: True 表示全部下载成功
        """
        if self._session is None:
            task.status = DownloadStatus.FAILED
            task.error_message = "requests 库未安装，无法下载模型。请运行: pip install requests"
            task.updated_at = time.time()
            if progress_callback:
                progress_callback(task)
            return False

        task.status = DownloadStatus.DOWNLOADING
        task.updated_at = time.time()
        if progress_callback:
            progress_callback(task)

        model_dir = PATHS.MODELS_DIR / task.model_type
        model_dir.mkdir(parents=True, exist_ok=True)

        success = True
        for i, file_info in enumerate(task.files):
            # 检查任务是否被取消
            if task.status == DownloadStatus.CANCELED:
                logger.info(f"下载任务已被取消: {task.task_id}")
                return False

            file_path = file_info["path"]
            local_path = model_dir / file_path

            # 如果文件已存在且校验通过，跳过
            if local_path.exists() and self._verify_file(local_path, file_info.get("sha256")):
                logger.info(f"文件已存在且校验通过，跳过: {file_path}")
                file_info["status"] = DownloadStatus.COMPLETED.value
                task.completed_files = i + 1
                task.progress.filename = file_path
                task.progress.progress = 100.0
                task.updated_at = time.time()
                if progress_callback:
                    progress_callback(task)
                continue

            # 下载文件
            try:
                await self._download_single_file(
                    task=task,
                    file_info=file_info,
                    local_path=local_path,
                    progress_callback=progress_callback,
                )
                file_info["status"] = DownloadStatus.COMPLETED.value
                task.completed_files = i + 1
                task.updated_at = time.time()
                if progress_callback:
                    progress_callback(task)

            except Exception as e:
                logger.error(f"下载文件失败: {file_path} - {e}")
                file_info["status"] = DownloadStatus.FAILED.value
                task.error_message = f"下载文件 {file_path} 失败: {str(e)}"
                success = False
                break

        # 更新任务状态
        if success:
            task.status = DownloadStatus.COMPLETED
            task.progress.progress = 100.0
            logger.info(f"下载任务完成: {task.task_id}")
        else:
            task.status = DownloadStatus.FAILED
            logger.error(f"下载任务失败: {task.task_id} - {task.error_message}")

        task.updated_at = time.time()
        if progress_callback:
            progress_callback(task)

        return success

    async def _download_single_file(
        self,
        task: DownloadTask,
        file_info: dict,
        local_path: Path,
        progress_callback: Optional[Callable],
    ) -> None:
        """
        下载单个文件（支持断点续传）。

        Args:
            task: 下载任务
            file_info: 文件信息字典
            local_path: 本地保存路径
            progress_callback: 进度回调
        """
        file_path = file_info["path"]
        url, alt_url = self._build_download_url(task.model_type, file_path)

        # 确保目录存在
        local_path.parent.mkdir(parents=True, exist_ok=True)

        # 检查是否有部分下载的文件（用于断点续传）
        temp_path = local_path.with_suffix(local_path.suffix + ".tmp")
        resume_pos = 0
        if temp_path.exists():
            resume_pos = temp_path.stat().st_size
            logger.info(f"发现未完成的下载，从 {resume_pos} 字节处继续: {file_path}")

        # 尝试从主 URL 下载
        try:
            await self._download_from_url(
                url=url,
                temp_path=temp_path,
                resume_pos=resume_pos,
                task=task,
                file_info=file_info,
                progress_callback=progress_callback,
            )
        except Exception as e:
            logger.warning(f"从主 URL 下载失败: {url} - {e}")

            # 尝试备用 URL
            if alt_url:
                logger.info(f"尝试备用 URL: {alt_url}")
                # 备用 URL 可能不支持断点续传，从头开始
                if temp_path.exists():
                    temp_path.unlink()
                resume_pos = 0
                await self._download_from_url(
                    url=alt_url,
                    temp_path=temp_path,
                    resume_pos=resume_pos,
                    task=task,
                    file_info=file_info,
                    progress_callback=progress_callback,
                )
            else:
                raise

        # 校验文件完整性
        sha256 = file_info.get("sha256")
        if sha256 and not self._verify_file(temp_path, sha256):
            raise ValueError(f"文件校验失败（SHA256 不匹配）: {file_path}")

        # 重命名临时文件为最终文件
        if local_path.exists():
            local_path.unlink()
        temp_path.rename(local_path)

        logger.info(f"文件下载完成: {file_path}")

    async def _download_from_url(
        self,
        url: str,
        temp_path: Path,
        resume_pos: int,
        task: DownloadTask,
        file_info: dict,
        progress_callback: Optional[Callable],
    ) -> None:
        """
        从指定 URL 下载文件到临时路径。

        使用 HTTP Range 请求支持断点续传。

        Args:
            url: 下载 URL
            temp_path: 临时文件路径
            resume_pos: 断点续传位置（字节）
            task: 下载任务
            file_info: 文件信息
            progress_callback: 进度回调
        """
        file_path = file_info["path"]

        # 构建 HTTP 请求头
        headers = {}
        if resume_pos > 0:
            headers["Range"] = f"bytes={resume_pos}-"

        # 发送 HTTP 请求
        # 使用流式下载，避免大文件占用过多内存
        response = self._session.get(
            url,
            headers=headers,
            stream=True,
            timeout=self.REQUEST_TIMEOUT,
        )

        # 处理响应状态码
        if response.status_code == 416:
            # Range Not Satisfiable - 文件已完整下载
            logger.info(f"文件已完整下载: {file_path}")
            return

        response.raise_for_status()

        # 获取文件总大小
        total_size = int(response.headers.get("content-length", 0))
        if resume_pos > 0 and response.status_code == 206:
            # 部分内容响应，total_size 是剩余部分的大小
            content_range = response.headers.get("content-range", "")
            if "total" not in content_range.lower():
                total_size += resume_pos
            else:
                # content-range: bytes start-end/total
                parts = content_range.split("/")
                if len(parts) == 2:
                    total_size = int(parts[1])
        elif total_size > 0 and resume_pos > 0:
            total_size += resume_pos

        file_info["total_bytes"] = total_size
        task.progress.filename = file_path
        task.progress.total_bytes = total_size
        task.progress.downloaded_bytes = resume_pos

        # 以追加模式写入文件（支持断点续传）
        mode = "ab" if resume_pos > 0 else "wb"
        downloaded = resume_pos
        last_time = time.time()
        last_downloaded = resume_pos
        speed = 0.0

        with open(temp_path, mode) as f:
            for chunk in response.iter_content(chunk_size=self.CHUNK_SIZE):
                if task.status == DownloadStatus.CANCELED:
                    logger.info(f"下载已取消: {file_path}")
                    return

                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    task.progress.downloaded_bytes = downloaded

                    # 计算下载速度和进度
                    current_time = time.time()
                    elapsed = current_time - last_time
                    if elapsed >= self.SPEED_INTERVAL:
                        speed = (downloaded - last_downloaded) / elapsed
                        last_downloaded = downloaded
                        last_time = current_time

                    task.progress.speed_bytes_per_sec = speed

                    # 计算进度百分比
                    if total_size > 0:
                        task.progress.progress = (downloaded / total_size) * 100
                        if speed > 0:
                            remaining = total_size - downloaded
                            task.progress.eta_seconds = remaining / speed

                    # 调用进度回调
                    if progress_callback:
                        # 在 asyncio 环境中，需要让出控制权
                        await asyncio.sleep(0)
                        progress_callback(task)

        file_info["downloaded_bytes"] = downloaded

    def _verify_file(self, file_path: Path, expected_sha256: Optional[str]) -> bool:
        """
        校验文件完整性（SHA256）。

        Args:
            file_path: 文件路径
            expected_sha256: 期望的 SHA256 哈希值，None 表示不校验

        Returns:
            bool: True 表示校验通过
        """
        if expected_sha256 is None:
            # 没有提供哈希值，仅检查文件是否存在且非空
            return file_path.exists() and file_path.stat().st_size > 0

        if not file_path.exists():
            return False

        # 计算文件的 SHA256
        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(self.CHUNK_SIZE)
                if not chunk:
                    break
                sha256_hash.update(chunk)

        actual_sha256 = sha256_hash.hexdigest()
        match = actual_sha256.lower() == expected_sha256.lower()

        if not match:
            logger.warning(
                f"文件校验失败: {file_path}\n"
                f"  期望 SHA256: {expected_sha256}\n"
                f"  实际 SHA256: {actual_sha256}"
            )

        return match

    def is_model_downloaded(self, model_type: str) -> bool:
        """
        检查模型是否已完整下载。

        Args:
            model_type: 模型类型

        Returns:
            bool: True 表示模型文件已全部存在
        """
        config = self._get_download_config(model_type)
        if config is None:
            return False

        model_dir = PATHS.MODELS_DIR / model_type
        for file_path, _ in config.get("files", []):
            local_path = model_dir / file_path
            if not local_path.exists():
                return False
            # 对于目录类型的路径（如 MuseTalk 的 models/dwpose），
            # 只要目录存在就算通过
            if local_path.is_dir():
                if not any(local_path.iterdir()):
                    return False
            elif local_path.stat().st_size == 0:
                return False

        return True

    def get_model_size(self, model_type: str) -> int:
        """
        获取已下载模型的总大小（字节）。

        Args:
            model_type: 模型类型

        Returns:
            模型文件总大小（字节）
        """
        model_dir = PATHS.MODELS_DIR / model_type
        if not model_dir.exists():
            return 0

        total_size = 0
        for root, dirs, files in os.walk(model_dir):
            for f in files:
                file_path = Path(root) / f
                total_size += file_path.stat().st_size

        return total_size

    def delete_model(self, model_type: str) -> bool:
        """
        删除已下载的模型文件。

        Args:
            model_type: 模型类型

        Returns:
            bool: True 表示删除成功
        """
        model_dir = PATHS.MODELS_DIR / model_type
        if not model_dir.exists():
            return False

        try:
            shutil.rmtree(model_dir)
            logger.info(f"已删除模型: {model_type}")
            return True
        except Exception as e:
            logger.error(f"删除模型失败: {model_type} - {e}")
            return False


if __name__ == "__main__":
    # 模块直接运行时，测试下载管理器
    logging.basicConfig(level=logging.DEBUG)

    downloader = ModelDownloader()

    # 测试创建任务
    task = downloader.create_task("wav2lip")
    print(f"任务 ID: {task.task_id}")
    print(f"模型类型: {task.model_type}")
    print(f"总文件数: {task.total_files}")
    print(f"文件列表: {[f['path'] for f in task.files]}")
    print(f"已下载: {downloader.is_model_downloaded('wav2lip')}")
