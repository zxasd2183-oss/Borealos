# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — FFmpeg 工具模块
===================================

本模块封装了 FFmpeg 命令行操作，提供以下功能：
  - 检测 FFmpeg 是否安装及版本
  - 将帧序列 + 音频合成为视频（MP4）
  - 从视频中提取音频
  - 获取视频信息（分辨率、时长、帧率等）
  - 视频转码与格式转换
  - 音频格式转换

所有操作通过 subprocess 调用 ffmpeg / ffprobe 命令行实现，
不依赖任何 Python FFmpeg 绑定库，保证最大兼容性。
"""

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

from config import INFERENCE

logger = logging.getLogger(__name__)


class FFmpegManager:
    """
    FFmpeg 管理器，负责检测和调用 FFmpeg。

    属性:
        ffmpeg_path: ffmpeg 可执行文件路径
        ffprobe_path: ffprobe 可执行文件路径
        available: FFmpeg 是否可用
        version: FFmpeg 版本号
    """

    def __init__(self) -> None:
        """初始化 FFmpeg 管理器，自动检测 FFmpeg 是否安装"""
        self.ffmpeg_path: Optional[str] = self._find_executable("ffmpeg")
        self.ffprobe_path: Optional[str] = self._find_executable("ffprobe")
        self.available: bool = self.ffmpeg_path is not None
        self.version: Optional[str] = None

        if self.available:
            self.version = self._get_version()
            logger.info(f"FFmpeg 已就绪: {self.ffmpeg_path} (版本 {self.version})")
        else:
            logger.warning(
                "FFmpeg 未安装或不在 PATH 中。"
                "请安装 FFmpeg 后重试: https://ffmpeg.org/download.html"
            )

    def _find_executable(self, name: str) -> Optional[str]:
        """
        在系统 PATH 中查找可执行文件。

        Args:
            name: 可执行文件名称（ffmpeg / ffprobe）

        Returns:
            完整路径字符串，未找到返回 None
        """
        # 在 Windows 上需要加上 .exe 后缀
        path = shutil.which(name)
        if path:
            return path

        # 尝试在常见安装路径中查找
        common_paths = self._get_common_paths(name)
        for p in common_paths:
            if os.path.isfile(p) and os.access(p, os.X_OK):
                return p

        return None

    def _get_common_paths(self, name: str) -> List[str]:
        """
        获取 FFmpeg/ffprobe 的常见安装路径。
        主要用于在 PATH 查找失败时的备用查找。

        Args:
            name: 可执行文件名称

        Returns:
            可能的路径列表
        """
        paths = []

        if os.name == "nt":  # Windows
            # 常见的 Windows 安装路径
            program_files = os.environ.get("ProgramFiles", "C:\\Program Files")
            program_files_x86 = os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")
            paths = [
                os.path.join(program_files, "ffmpeg", "bin", f"{name}.exe"),
                os.path.join(program_files_x86, "ffmpeg", "bin", f"{name}.exe"),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "ffmpeg", "bin", f"{name}.exe"),
                f"C:\\ffmpeg\\bin\\{name}.exe",
            ]
        else:  # Linux / macOS
            paths = [
                f"/usr/bin/{name}",
                f"/usr/local/bin/{name}",
                f"/opt/homebrew/bin/{name}",
                f"/snap/bin/{name}",
            ]

        return paths

    def _get_version(self) -> Optional[str]:
        """
        获取 FFmpeg 版本号。

        Returns:
            版本字符串，如 "6.0"，获取失败返回 None
        """
        if not self.ffmpeg_path:
            return None

        try:
            result = subprocess.run(
                [self.ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                # 输出第一行类似: ffmpeg version 6.0 Copyright (c) ...
                match = re.search(r"ffmpeg version\s+([\d.]+)", result.stdout)
                if match:
                    return match.group(1)
                # 返回整行的前 50 个字符作为版本信息
                first_line = result.stdout.split("\n")[0][:50]
                return first_line
        except Exception as e:
            logger.warning(f"获取 FFmpeg 版本失败: {e}")

        return None

    def _run_command(self, args: List[str], timeout: int = 600) -> subprocess.CompletedProcess:
        """
        执行 FFmpeg 命令。

        Args:
            args: 命令参数列表（不含 ffmpeg 可执行文件路径）
            timeout: 超时时间（秒）

        Returns:
            subprocess.CompletedProcess 对象

        Raises:
            RuntimeError: FFmpeg 不可用
            subprocess.TimeoutExpired: 命令执行超时
        """
        if not self.available:
            raise RuntimeError("FFmpeg 不可用，请先安装 FFmpeg")

        cmd = [self.ffmpeg_path] + args
        logger.debug(f"执行 FFmpeg 命令: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        if result.returncode != 0:
            logger.error(f"FFmpeg 命令失败 (返回码 {result.returncode})")
            logger.error(f"FFmpeg stderr: {result.stderr[:500]}")
            raise RuntimeError(f"FFmpeg 命令执行失败: {result.stderr[:200]}")

        return result

    def _run_ffprobe(self, args: List[str], timeout: int = 30) -> subprocess.CompletedProcess:
        """
        执行 ffprobe 命令。

        Args:
            args: 命令参数列表
            timeout: 超时时间（秒）

        Returns:
            subprocess.CompletedProcess 对象

        Raises:
            RuntimeError: ffprobe 不可用
        """
        if not self.ffprobe_path:
            raise RuntimeError("ffprobe 不可用，请确保 FFmpeg 完整安装")

        cmd = [self.ffprobe_path] + args
        logger.debug(f"执行 ffprobe 命令: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        if result.returncode != 0:
            raise RuntimeError(f"ffprobe 命令执行失败: {result.stderr[:200]}")

        return result

    def combine_video(
        self,
        frames_dir: Union[str, Path],
        audio_path: Union[str, Path],
        output_path: Union[str, Path],
        fps: int = 25,
        resolution: Optional[Tuple[int, int]] = None,
        use_gpu: bool = False,
    ) -> str:
        """
        将帧序列目录中的图片与音频合成为视频。

        Args:
            frames_dir: 帧图片目录路径（图片需按序号命名，如 00001.png, 00002.png）
            audio_path: 音频文件路径
            output_path: 输出视频文件路径
            fps: 帧率
            resolution: 输出分辨率 (width, height)，None 表示保持原始分辨率
            use_gpu: 是否使用 GPU 硬件加速编码

        Returns:
            输出视频文件路径
        """
        frames_dir = Path(frames_dir)
        output_path = Path(output_path)
        audio_path = Path(audio_path)

        # 确保输出目录存在
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # 构建输入帧的文件模式（如 %05d.png）
        # 自动检测帧文件的格式
        frame_pattern = self._detect_frame_pattern(frames_dir)
        input_frames = str(frames_dir / frame_pattern)

        # 构建命令参数
        args = [
            "-y",  # 覆盖输出文件
            "-framerate", str(fps),
            "-i", input_frames,
            "-i", str(audio_path),
        ]

        # 视频编码器选择
        if use_gpu and INFERENCE.USE_GPU_FFMPEG:
            video_codec = INFERENCE.GPU_ENCODER  # h264_nvenc
        else:
            video_codec = INFERENCE.DEFAULT_VIDEO_CODEC  # libx264

        args.extend([
            "-c:v", video_codec,
            "-b:v", INFERENCE.DEFAULT_VIDEO_BITRATE,
            "-pix_fmt", "yuv420p",
        ])

        # 设置分辨率（如果指定）
        if resolution:
            width, height = resolution
            args.extend(["-s", f"{width}x{height}"])

        # 音频编码
        args.extend([
            "-c:a", INFERENCE.DEFAULT_AUDIO_CODEC,
            "-b:a", INFERENCE.DEFAULT_AUDIO_BITRATE,
        ])

        # 短流对齐（音视频时长以短的为准）
        args.append("-shortest")

        # 输出文件
        args.append(str(output_path))

        logger.info(f"开始合成视频: {output_path}")
        self._run_command(args, timeout=3600)
        logger.info(f"视频合成完成: {output_path}")

        return str(output_path)

    def combine_frames_and_audio(
        self,
        frames_dir: Union[str, Path],
        audio_path: Union[str, Path],
        output_path: Union[str, Path],
        fps: int = 25,
        resolution: Optional[Tuple[int, int]] = None,
    ) -> str:
        """
        合并帧序列和音频为视频文件（combine_video 的别名，使用 CPU 编码）。

        Args:
            frames_dir: 帧图片目录路径
            audio_path: 音频文件路径
            output_path: 输出视频文件路径
            fps: 帧率
            resolution: 输出分辨率 (width, height)

        Returns:
            输出视频文件路径
        """
        return self.combine_video(
            frames_dir=frames_dir,
            audio_path=audio_path,
            output_path=output_path,
            fps=fps,
            resolution=resolution,
            use_gpu=False,
        )

    def _detect_frame_pattern(self, frames_dir: Path) -> str:
        """
        自动检测帧目录中的图片命名模式。

        支持的命名模式：
          - 00001.png, 00002.png → %05d.png
          - frame_001.jpg → frame_%03d.jpg
          - 1.png, 2.png → %d.png

        Args:
            frames_dir: 帧图片目录路径

        Returns:
            文件名模式字符串

        Raises:
            FileNotFoundError: 目录中无图片文件
        """
        # 获取目录中的所有图片文件
        image_extensions = {".png", ".jpg", ".jpeg", ".bmp", ".tiff"}
        images = sorted([
            f for f in frames_dir.iterdir()
            if f.suffix.lower() in image_extensions
        ])

        if not images:
            raise FileNotFoundError(f"帧目录中未找到图片文件: {frames_dir}")

        # 分析第一个文件名来确定模式
        first_file = images[0]
        name = first_file.name
        ext = first_file.suffix

        # 尝试匹配数字序列
        # 匹配如 "00001", "frame_001", "1" 等模式
        match = re.match(r"^(\D*)(\d+)(\D*)$", name.replace(ext, ""))
        if match:
            prefix = match.group(1)
            digits = match.group(2)
            suffix = match.group(3)
            width = len(digits)
            return f"{prefix}%0{width}d{suffix}{ext}"
        else:
            # 默认使用 %06d 模式
            return f"%06d{ext}"

    def extract_audio(
        self,
        video_path: Union[str, Path],
        output_path: Union[str, Path],
        audio_format: str = "wav",
        sample_rate: int = 16000,
    ) -> str:
        """
        从视频文件中提取音频。

        Args:
            video_path: 视频文件路径
            output_path: 输出音频文件路径
            audio_format: 输出音频格式（wav / mp3 / aac）
            sample_rate: 采样率

        Returns:
            输出音频文件路径
        """
        video_path = Path(video_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        args = [
            "-y",
            "-i", str(video_path),
            "-vn",  # 不要视频
            "-acodec", "pcm_s16le" if audio_format == "wav" else "libmp3lame" if audio_format == "mp3" else "aac",
            "-ar", str(sample_rate),
            "-ac", "1",  # 单声道
            str(output_path),
        ]

        logger.info(f"从视频提取音频: {video_path} → {output_path}")
        self._run_command(args)
        logger.info(f"音频提取完成: {output_path}")

        return str(output_path)

    def get_video_info(self, video_path: Union[str, Path]) -> dict:
        """
        获取视频文件的详细信息。

        Args:
            video_path: 视频文件路径

        Returns:
            dict: 包含以下字段
                - duration: 时长（秒）
                - width: 宽度（像素）
                - height: 高度（像素）
                - fps: 帧率
                - codec: 视频编码器
                - audio_codec: 音频编码器
                - has_audio: 是否包含音频流
                - bit_rate: 比特率
                - file_size: 文件大小（字节）
        """
        video_path = Path(video_path)

        if not video_path.exists():
            raise FileNotFoundError(f"视频文件不存在: {video_path}")

        # 使用 ffprobe 获取视频信息（JSON 格式输出）
        result = self._run_ffprobe([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path),
        ])

        data = json.loads(result.stdout)

        # 解析格式信息
        format_info = data.get("format", {})
        duration = float(format_info.get("duration", 0))
        bit_rate = int(format_info.get("bit_rate", 0)) if format_info.get("bit_rate") else 0
        file_size = int(format_info.get("size", 0)) if format_info.get("size") else 0

        # 解析流信息
        video_stream = None
        audio_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video" and video_stream is None:
                video_stream = stream
            elif stream.get("codec_type") == "audio" and audio_stream is None:
                audio_stream = stream

        # 提取视频流信息
        width = 0
        height = 0
        fps = 0.0
        video_codec = ""
        if video_stream:
            width = int(video_stream.get("width", 0))
            height = int(video_stream.get("height", 0))
            video_codec = video_stream.get("codec_name", "")
            # 解析帧率（如 "25/1" → 25.0）
            fps_str = video_stream.get("r_frame_rate", "0/1")
            try:
                num, den = fps_str.split("/")
                fps = float(num) / float(den) if float(den) != 0 else 0.0
            except (ValueError, ZeroDivisionError):
                fps = 0.0

        # 提取音频流信息
        audio_codec = ""
        has_audio = False
        if audio_stream:
            audio_codec = audio_stream.get("codec_name", "")
            has_audio = True

        return {
            "duration": duration,
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "codec": video_codec,
            "audio_codec": audio_codec,
            "has_audio": has_audio,
            "bit_rate": bit_rate,
            "file_size": file_size,
            "file_path": str(video_path),
        }

    def convert_audio(
        self,
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        sample_rate: int = 16000,
        channels: int = 1,
    ) -> str:
        """
        转换音频格式和参数。

        Args:
            input_path: 输入音频文件路径
            output_path: 输出音频文件路径
            sample_rate: 目标采样率
            channels: 目标声道数

        Returns:
            输出音频文件路径
        """
        input_path = Path(input_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # 根据输出扩展名选择编码器
        ext = output_path.suffix.lower()
        if ext == ".wav":
            codec = "pcm_s16le"
        elif ext == ".mp3":
            codec = "libmp3lame"
        elif ext == ".aac":
            codec = "aac"
        else:
            codec = "pcm_s16le"  # 默认 WAV

        args = [
            "-y",
            "-i", str(input_path),
            "-acodec", codec,
            "-ar", str(sample_rate),
            "-ac", str(channels),
            str(output_path),
        ]

        logger.info(f"转换音频: {input_path} → {output_path}")
        self._run_command(args)
        logger.info(f"音频转换完成: {output_path}")

        return str(output_path)

    def get_audio_duration(self, audio_path: Union[str, Path]) -> float:
        """
        获取音频文件的时长（秒）。

        Args:
            audio_path: 音频文件路径

        Returns:
            音频时长（秒），获取失败返回 0.0
        """
        try:
            result = self._run_ffprobe([
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                str(audio_path),
            ])
            data = json.loads(result.stdout)
            return float(data.get("format", {}).get("duration", 0))
        except Exception as e:
            logger.warning(f"获取音频时长失败: {e}")
            return 0.0

    def create_video_from_image(
        self,
        image_path: Union[str, Path],
        audio_path: Union[str, Path],
        output_path: Union[str, Path],
        duration: Optional[float] = None,
        fps: int = 25,
    ) -> str:
        """
        从单张图片 + 音频创建视频（图片作为静态背景）。

        Args:
            image_path: 图片文件路径
            audio_path: 音频文件路径
            output_path: 输出视频文件路径
            duration: 视频时长（秒），None 表示使用音频时长
            fps: 帧率

        Returns:
            输出视频文件路径
        """
        image_path = Path(image_path)
        audio_path = Path(audio_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        args = [
            "-y",
            "-loop", "1",  # 循环输入图片
            "-framerate", str(fps),
            "-i", str(image_path),
            "-i", str(audio_path),
            "-c:v", INFERENCE.DEFAULT_VIDEO_CODEC,
            "-tune", "stillimage",  # 静态图片优化
            "-b:v", INFERENCE.DEFAULT_VIDEO_BITRATE,
            "-pix_fmt", "yuv420p",
            "-c:a", INFERENCE.DEFAULT_AUDIO_CODEC,
            "-b:a", INFERENCE.DEFAULT_AUDIO_BITRATE,
            "-shortest",
        ]

        if duration:
            args.extend(["-t", str(duration)])

        args.append(str(output_path))

        logger.info(f"从图片+音频创建视频: {output_path}")
        self._run_command(args)
        logger.info(f"视频创建完成: {output_path}")

        return str(output_path)

    def resize_video(
        self,
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        width: int,
        height: int,
    ) -> str:
        """
        调整视频分辨率。

        Args:
            input_path: 输入视频路径
            output_path: 输出视频路径
            width: 目标宽度
            height: 目标高度

        Returns:
            输出视频文件路径
        """
        input_path = Path(input_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        args = [
            "-y",
            "-i", str(input_path),
            "-vf", f"scale={width}:{height}",
            "-c:v", INFERENCE.DEFAULT_VIDEO_CODEC,
            "-b:v", INFERENCE.DEFAULT_VIDEO_BITRATE,
            "-c:a", "copy",
            str(output_path),
        ]

        logger.info(f"调整视频分辨率: {input_path} → {width}x{height}")
        self._run_command(args)
        logger.info(f"视频分辨率调整完成: {output_path}")

        return str(output_path)


# ============================================================
# 模块级便捷函数
# ============================================================

# 全局 FFmpeg 管理器实例（延迟初始化）
_ffmpeg_manager: Optional[FFmpegManager] = None


def _get_manager() -> FFmpegManager:
    """获取全局 FFmpeg 管理器实例（单例模式）"""
    global _ffmpeg_manager
    if _ffmpeg_manager is None:
        _ffmpeg_manager = FFmpegManager()
    return _ffmpeg_manager


def check_ffmpeg() -> bool:
    """
    检查 FFmpeg 是否已安装且可用。

    Returns:
        bool: True 表示可用
    """
    return _get_manager().available


def get_ffmpeg_version() -> Optional[str]:
    """
    获取 FFmpeg 版本号。

    Returns:
        版本字符串，未安装返回 None
    """
    return _get_manager().version


def combine_frames_and_audio(
    frames_dir: Union[str, Path],
    audio_path: Union[str, Path],
    output_path: Union[str, Path],
    fps: int = 25,
    resolution: Optional[Tuple[int, int]] = None,
) -> str:
    """
    将帧序列 + 音频合成为视频（模块级便捷函数）。

    Args:
        frames_dir: 帧图片目录路径
        audio_path: 音频文件路径
        output_path: 输出视频文件路径
        fps: 帧率
        resolution: 输出分辨率 (width, height)

    Returns:
        输出视频文件路径
    """
    return _get_manager().combine_frames_and_audio(
        frames_dir=frames_dir,
        audio_path=audio_path,
        output_path=output_path,
        fps=fps,
        resolution=resolution,
    )


def extract_audio_from_video(
    video_path: Union[str, Path],
    output_path: Union[str, Path],
    audio_format: str = "wav",
    sample_rate: int = 16000,
) -> str:
    """
    从视频文件中提取音频（模块级便捷函数）。

    Args:
        video_path: 视频文件路径
        output_path: 输出音频文件路径
        audio_format: 输出音频格式
        sample_rate: 采样率

    Returns:
        输出音频文件路径
    """
    return _get_manager().extract_audio(
        video_path=video_path,
        output_path=output_path,
        audio_format=audio_format,
        sample_rate=sample_rate,
    )


def get_video_info(video_path: Union[str, Path]) -> dict:
    """
    获取视频文件信息（模块级便捷函数）。

    Args:
        video_path: 视频文件路径

    Returns:
        dict: 视频信息字典
    """
    return _get_manager().get_video_info(video_path)


if __name__ == "__main__":
    # 模块直接运行时，测试 FFmpeg 检测
    logging.basicConfig(level=logging.DEBUG)
    manager = FFmpegManager()
    print(f"FFmpeg 可用: {manager.available}")
    print(f"FFmpeg 路径: {manager.ffmpeg_path}")
    print(f"FFmpeg 版本: {manager.version}")
    print(f"ffprobe 路径: {manager.ffprobe_path}")
