# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 工具模块
============================

本包包含数字人推理服务所需的各种工具函数：
  - gpu: GPU/CUDA 检测与信息获取
  - ffmpeg: FFmpeg 命令行封装（视频合成、音频提取等）
  - face: 面部检测、对齐、裁剪与特征点提取
  - download: 模型文件下载管理器（支持断点续传与校验）
"""

from utils.gpu import detect_gpu, get_gpu_info, is_cuda_available, get_device
from utils.ffmpeg import (
    FFmpegManager,
    check_ffmpeg,
    get_ffmpeg_version,
    combine_frames_and_audio,
    extract_audio_from_video,
    get_video_info,
)
from utils.face import (
    FaceDetector,
    FaceProcessor,
    detect_faces,
    extract_face_landmarks,
    crop_face,
    align_face,
)
from utils.download import (
    ModelDownloader,
    DownloadTask,
    DownloadStatus,
)

__all__ = [
    # GPU
    "detect_gpu",
    "get_gpu_info",
    "is_cuda_available",
    "get_device",
    # FFmpeg
    "FFmpegManager",
    "check_ffmpeg",
    "get_ffmpeg_version",
    "combine_frames_and_audio",
    "extract_audio_from_video",
    "get_video_info",
    # Face
    "FaceDetector",
    "FaceProcessor",
    "detect_faces",
    "extract_face_landmarks",
    "crop_face",
    "align_face",
    # Download
    "ModelDownloader",
    "DownloadTask",
    "DownloadStatus",
]
