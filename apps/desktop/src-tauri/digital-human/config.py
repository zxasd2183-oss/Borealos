# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — 全局配置模块
================================

本模块定义了数字人推理服务的所有全局配置项，包括：
  - 服务器监听地址与端口
  - 模型存储路径（用户主目录下 ~/.aurora/models/）
  - 临时输出路径
  - 各模型的下载地址（HuggingFace / GitHub Releases）
  - TTS 语音合成配置
  - 各模型的默认推理参数

所有路径均使用 pathlib.Path 处理，保证跨平台兼容性。
"""

import os
import tempfile
from pathlib import Path
from typing import Dict, List, Optional


# ============================================================
# 1. 服务器配置
# ============================================================

class ServerConfig:
    """FastAPI 服务器配置"""

    # 监听主机地址，仅本机访问（安全考虑）
    HOST: str = "127.0.0.1"

    # 监听端口
    PORT: int = 7861

    # 工作线程数（0 表示自动）
    WORKERS: int = 1

    # 请求超时时间（秒），0 表示不超时
    REQUEST_TIMEOUT: int = 0

    # 最大上传文件大小（MB）
    MAX_UPLOAD_SIZE_MB: int = 100

    # CORS 允许的来源（星号表示全部）
    CORS_ORIGINS: List[str] = ["*"]

    # API 版本前缀
    API_PREFIX: str = "/api/v1"


# ============================================================
# 2. 路径配置
# ============================================================

class PathConfig:
    """文件系统路径配置"""

    # 用户主目录
    HOME_DIR: Path = Path.home()

    # Aurora 根目录（~/.aurora/）
    AURORA_ROOT: Path = HOME_DIR / ".aurora"

    # 模型存储目录（~/.aurora/models/）
    MODELS_DIR: Path = AURORA_ROOT / "models"

    # 输出目录（系统临时目录下的 aurora 子目录）
    OUTPUT_DIR: Path = Path(tempfile.gettempdir()) / "aurora" / "output"

    # 上传文件目录
    UPLOAD_DIR: Path = AURORA_ROOT / "uploads"

    # 头像预设目录（随程序分发的预设头像）
    PRESETS_DIR: Path = AURORA_ROOT / "presets" / "avatars"

    # 日志目录
    LOG_DIR: Path = AURORA_ROOT / "logs"

    # 缓存目录
    CACHE_DIR: Path = AURORA_ROOT / "cache"

    # TTS 音频输出目录
    TTS_OUTPUT_DIR: Path = OUTPUT_DIR / "tts"

    @classmethod
    def ensure_dirs(cls) -> None:
        """确保所有必要的目录存在"""
        for dir_path in [
            cls.AURORA_ROOT,
            cls.MODELS_DIR,
            cls.OUTPUT_DIR,
            cls.UPLOAD_DIR,
            cls.PRESETS_DIR,
            cls.LOG_DIR,
            cls.CACHE_DIR,
            cls.TTS_OUTPUT_DIR,
        ]:
            dir_path.mkdir(parents=True, exist_ok=True)


# ============================================================
# 3. 模型下载地址配置
# ============================================================

class ModelDownloadConfig:
    """
    各模型的下载地址与校验信息。

    每个模型包含：
      - base_url: 模型仓库的基础 URL
      - files: 需要下载的文件列表，每项为 (相对路径, SHA256 校验和)
        其中 SHA256 可为 None 表示不校验
      - repo_type: 仓库类型（huggingface / github）
    """

    # HuggingFace 基础 URL
    HF_BASE: str = "https://huggingface.co"

    # GitHub Releases 基础 URL
    GH_BASE: str = "https://github.com"

    # ---- MuseTalk 模型 ----
    MUSETALK: dict = {
        "repo_type": "huggingface",
        "repo_id": "TMElyralab/MuseTalk",
        "files": [
            ("models/dwpose", None),
            ("models/face-parse-bisent", None),
            ("models/musetalk", None),
            ("models/sd-vae-ft-mse", None),
            ("models/whisper/whisper-tiny.pt", None),
        ],
    }

    # ---- SadTalker 模型 ----
    SADTALKER: dict = {
        "repo_type": "github",
        "repo_url": "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2",
        "files": [
            ("checkpoints/audio2exp_00300.pth", None),
            ("checkpoints/audio2pose_00140-model.pth", None),
            ("checkpoints/epoch_20.pth", None),
            ("checkpoints/face-render.pth", None),
            ("checkpoints/Generator_001.pth", None),
            ("checkpoints/hubert_base.pt", None),
            ("checkpoints/wav2lip.pth", None),
            ("gfpgan/weights/GFPGANv1.4.pth", None),
            ("gfpgan/weights/detection_Resnet50_Final.pth", None),
            ("gfpgan/weights/parsing_parsenet.pth", None),
        ],
    }

    # ---- Wav2Lip 模型 ----
    WAV2LIP: dict = {
        "repo_type": "github",
        "repo_url": "https://github.com/anothermartz/Easy-Wav2Lip/releases/download/v9",
        "files": [
            ("wav2lip_gan.pth", None),
            ("s3fd.pth", None),
        ],
        # 备用地址（HuggingFace 镜像）
        "alt_repo_type": "huggingface",
        "alt_repo_id": "numz/wav2lip-uhq",
        "alt_files": [
            ("wav2lip_gan.pth", None),
            ("s3fd.pth", None),
        ],
    }

    # ---- EchoMimic V2 模型 ----
    ECHOMIMIC: dict = {
        "repo_type": "huggingface",
        "repo_id": "antgroup/echomimic_v2",
        "files": [
            ("denoising_unet.pth", None),
            ("motion_module.pth", None),
            ("pose_net.pth", None),
            ("reference_unet.pth", None),
            ("renderer.pth", None),
            ("stable_audio_decoder.pth", None),
            ("stable_diffusion_vae.pth", None),
            ("audio_processor/whisper_tiny.pt", None),
            ("audio_processor/whisper_tiny.pt.onnx", None),
        ],
    }

    # ---- Hallo2 模型 ----
    HALLO2: dict = {
        "repo_type": "huggingface",
        "repo_id": "fudan-generative-ai/hallo2",
        "files": [
            ("unet/diffusion_pytorch_model.bin", None),
            ("unet/config.json", None),
            ("vae/diffusion_pytorch_model.bin", None),
            ("vae/config.json", None),
            ("audio_projection/model.safetensors", None),
            ("audio_encoder/config.json", None),
            ("audio_encoder/pytorch_model.bin", None),
            ("denoising_unet/diffusion_pytorch_model.bin", None),
            ("reference_net/diffusion_pytorch_model.bin", None),
            ("motion_module.pth", None),
            ("face_locator/model.safetensors", None),
        ],
    }


# ============================================================
# 4. 模型元数据配置
# ============================================================

class ModelMetaConfig:
    """
    各模型的元数据信息，用于 /models/list 接口返回。
    """

    MODELS: List[dict] = [
        {
            "type": "musetalk",
            "name": "MuseTalk",
            "version": "1.0",
            "description": "实时口型同步模型，支持 30fps 实时推理，生成质量高，速度快。",
            "min_vram_gb": 4,
            "recommended_vram_gb": 8,
            "supports_realtime": True,
            "output_type": "face_only",
            "max_resolution": 512,
            "download_size_gb": 3.5,
            "tags": ["realtime", "high_quality", "fast"],
        },
        {
            "type": "sadtalker",
            "name": "SadTalker",
            "version": "0.0.2",
            "description": "3DMM 驱动的头部运动生成模型，支持自然头部运动和面部表情。",
            "min_vram_gb": 4,
            "recommended_vram_gb": 8,
            "supports_realtime": False,
            "output_type": "full_head",
            "max_resolution": 512,
            "download_size_gb": 4.2,
            "tags": ["3dmm", "head_motion", "expressive"],
        },
        {
            "type": "wav2lip",
            "name": "Wav2Lip",
            "version": "1.0",
            "description": "轻量级口型同步模型，适合低配设备，速度最快但质量一般。",
            "min_vram_gb": 2,
            "recommended_vram_gb": 4,
            "supports_realtime": False,
            "output_type": "face_only",
            "max_resolution": 96,
            "download_size_gb": 0.5,
            "tags": ["lightweight", "fast", "low_resource"],
        },
        {
            "type": "echomimic",
            "name": "EchoMimic V2",
            "version": "2.0",
            "description": "半身动画生成模型，支持音频+姿态驱动，生成自然的半身动画。",
            "min_vram_gb": 8,
            "recommended_vram_gb": 12,
            "supports_realtime": False,
            "output_type": "half_body",
            "max_resolution": 768,
            "download_size_gb": 8.0,
            "tags": ["half_body", "pose_driven", "high_quality"],
        },
        {
            "type": "hallo2",
            "name": "Hallo2",
            "version": "2.0",
            "description": "4K 高分辨率长视频生成模型，生成质量最高但需要高配 GPU。",
            "min_vram_gb": 12,
            "recommended_vram_gb": 24,
            "supports_realtime": False,
            "output_type": "full_body",
            "max_resolution": 2048,
            "download_size_gb": 12.0,
            "tags": ["4k", "high_resolution", "long_video", "premium"],
        },
    ]

    @classmethod
    def get_model_meta(cls, model_type: str) -> Optional[dict]:
        """根据模型类型获取元数据"""
        for model in cls.MODELS:
            if model["type"] == model_type:
                return model
        return None

    @classmethod
    def get_model_dir(cls, model_type: str) -> Path:
        """获取模型存储目录"""
        return PathConfig.MODELS_DIR / model_type


# ============================================================
# 5. TTS 配置
# ============================================================

class TTSConfig:
    """语音合成 (TTS) 配置"""

    # 默认语音
    DEFAULT_VOICE: str = "zh-CN-XiaoxiaoNeural"

    # 默认语速（百分比，-100 到 +100）
    DEFAULT_RATE: str = "+0%"

    # 默认音调（百分比，-100 到 +100）
    DEFAULT_VOLUME: str = "+0%"

    # 默认音量
    DEFAULT_PITCH: str = "+0%"

    # 输出音频格式
    OUTPUT_FORMAT: str = "audio-24khz-48kbitrate-mono-mp3"

    # WAV 采样率
    SAMPLE_RATE: int = 24000

    # 音频声道数
    CHANNELS: int = 1

    # 中文语音列表
    CHINESE_VOICES: List[dict] = [
        {"name": "晓晓 (女声, 温暖)", "id": "zh-CN-XiaoxiaoNeural"},
        {"name": "云希 (男声, 沉稳)", "id": "zh-CN-YunxiNeural"},
        {"name": "云扬 (男声, 新闻)", "id": "zh-CN-YunyangNeural"},
        {"name": "晓辰 (女声, 活泼)", "id": "zh-CN-XiaochenNeural"},
        {"name": "晓涵 (女声, 温柔)", "id": "zh-CN-XiaohanNeural"},
        {"name": "晓萌 (女声, 甜美)", "id": "zh-CN-XiaomengNeural"},
        {"name": "晓秋 (女声, 成熟)", "id": "zh-CN-XiaoqiuNeural"},
        {"name": "晓睿 (女声, 干练)", "id": "zh-CN-XiaoruiNeural"},
        {"name": "晓双 (女声, 少女)", "id": "zh-CN-XiaoshuangNeural"},
        {"name": "晓伟 (男声, 磁性)", "id": "zh-CN-XiaoweiNeural"},
        {"name": "晓颜 (女声, 清新)", "id": "zh-CN-XiaoyanNeural"},
        {"name": "晓悠 (女声, 亲切)", "id": "zh-CN-XiaoyouNeural"},
        {"name": "晓雨 (女声, 柔和)", "id": "zh-CN-XiaoyuNeural"},
        {"name": "云健 (男声, 阳光)", "id": "zh-CN-YunjianNeural"},
        {"name": "云杰 (男声, 专业)", "id": "zh-CN-YunzeNeural"},
        # 粤语
        {"name": "晓曼 (粤语女声)", "id": "zh-HK-HiuMaanNeural"},
        {"name": "云龙 (粤语男声)", "id": "zh-HK-WanLungNeural"},
        # 台湾国语
        {"name": "曉臻 (台灣女聲)", "id": "zh-TW-HsiaoChenNeural"},
        {"name": "雲哲 (台灣男聲)", "id": "zh-TW-YunJheNeural"},
    ]

    # 英文语音列表
    ENGLISH_VOICES: List[dict] = [
        {"name": "Jenny (Female, Natural)", "id": "en-US-JennyNeural"},
        {"name": "Guy (Male, Natural)", "id": "en-US-GuyNeural"},
        {"name": "Aria (Female, Expressive)", "id": "en-US-AriaNeural"},
        {"name": "Davis (Male, Calm)", "id": "en-US-DavisNeural"},
        {"name": "Amber (Female, Warm)", "id": "en-US-AmberNeural"},
        {"name": "Ana (Female, Professional)", "id": "en-US-AnaNeural"},
        {"name": "Andrew (Male, Friendly)", "id": "en-US-AndrewNeural"},
        {"name": "Brian (Male, Neutral)", "id": "en-US-BrianNeural"},
        {"name": "Christopher (Male, Deep)", "id": "en-US-ChristopherNeural"},
        {"name": "Emma (Female, Bright)", "id": "en-US-EmmaNeural"},
        # 英式英语
        {"name": "Sonia (UK Female)", "id": "en-GB-SoniaNeural"},
        {"name": "Ryan (UK Male)", "id": "en-GB-RyanNeural"},
        # 澳式英语
        {"name": "Natasha (AU Female)", "id": "en-AU-NatashaNeural"},
        {"name": "William (AU Male)", "id": "en-AU-WilliamNeural"},
    ]

    # 日语语音
    JAPANESE_VOICES: List[dict] = [
        {"name": "nanami (女性, 自然)", "id": "ja-JP-NanamiNeural"},
        {"name": "keita (男性, 落ち着き)", "id": "ja-JP-KeitaNeural"},
    ]

    # 韩语语音
    KOREAN_VOICES: List[dict] = [
        {"name": "sunhi (여성, 자연스러운)", "id": "ko-KR-SunHiNeural"},
        {"name": "insoo (남성, 차분한)", "id": "ko-KR-InJoonNeural"},
    ]

    @classmethod
    def get_all_voices(cls) -> List[dict]:
        """获取所有可用语音列表"""
        return (
            cls.CHINESE_VOICES
            + cls.ENGLISH_VOICES
            + cls.JAPANESE_VOICES
            + cls.KOREAN_VOICES
        )

    @classmethod
    def get_voices_by_language(cls, language: str) -> List[dict]:
        """根据语言代码获取语音列表

        Args:
            language: 语言代码，如 'zh', 'en', 'ja', 'ko'
        """
        mapping = {
            "zh": cls.CHINESE_VOICES,
            "zh-CN": cls.CHINESE_VOICES,
            "zh-HK": [v for v in cls.CHINESE_VOICES if "zh-HK" in v["id"]],
            "zh-TW": [v for v in cls.CHINESE_VOICES if "zh-TW" in v["id"]],
            "en": cls.ENGLISH_VOICES,
            "en-US": [v for v in cls.ENGLISH_VOICES if "en-US" in v["id"]],
            "en-GB": [v for v in cls.ENGLISH_VOICES if "en-GB" in v["id"]],
            "en-AU": [v for v in cls.ENGLISH_VOICES if "en-AU" in v["id"]],
            "ja": cls.JAPANESE_VOICES,
            "ja-JP": cls.JAPANESE_VOICES,
            "ko": cls.KOREAN_VOICES,
            "ko-KR": cls.KOREAN_VOICES,
        }
        return mapping.get(language, cls.get_all_voices())


# ============================================================
# 6. 推理默认参数配置
# ============================================================

class InferenceConfig:
    """推理过程默认参数"""

    # 默认输出分辨率（高度，宽度按比例缩放）
    DEFAULT_RESOLUTION: int = 512

    # 支持的分辨率选项
    SUPPORTED_RESOLUTIONS: List[int] = [256, 384, 512, 768, 1024, 2048]

    # 默认帧率
    DEFAULT_FPS: int = 25

    # 支持的帧率选项
    SUPPORTED_FPS: List[int] = [15, 24, 25, 30, 60]

    # 默认视频编码器
    DEFAULT_VIDEO_CODEC: str = "libx264"

    # 默认音频编码器
    DEFAULT_AUDIO_CODEC: str = "aac"

    # 默认视频码率
    DEFAULT_VIDEO_BITRATE: str = "5M"

    # 默认音频码率
    DEFAULT_AUDIO_BITRATE: str = "128k"

    # 是否使用 GPU 加速 FFmpeg（如果可用）
    USE_GPU_FFMPEG: bool = True

    # GPU 解码器
    GPU_DECODER: str = "h264_cuvid"

    # GPU 编码器
    GPU_ENCODER: str = "h264_nvenc"

    # 生成超时时间（秒），0 表示不超时
    GENERATION_TIMEOUT: int = 0

    # 临时文件保留时间（秒），超时后自动清理
    TEMP_FILE_TTL: int = 3600

    # 最大并发生成任务数
    MAX_CONCURRENT_TASKS: int = 1

    # 模型加载超时时间（秒）
    MODEL_LOAD_TIMEOUT: int = 300

    # 面部检测置信度阈值
    FACE_DETECT_CONFIDENCE: float = 0.5

    # 面部检测最小尺寸（像素）
    FACE_DETECT_MIN_SIZE: int = 64

    # 面部裁剪扩展比例（上下左右各扩展多少比例）
    FACE_CROP_EXPAND_RATIO: float = 0.25


# ============================================================
# 7. 预设头像配置
# ============================================================

class PresetAvatarConfig:
    """预设头像配置"""

    # 预设头像列表（实际使用时从 PRESETS_DIR 读取图片文件）
    PRESETS: List[dict] = [
        {"id": "presenter_female_1", "name": "女性主播 1", "gender": "female", "style": "professional"},
        {"id": "presenter_male_1", "name": "男性主播 1", "gender": "male", "style": "professional"},
        {"id": "presenter_female_2", "name": "女性主播 2", "gender": "female", "style": "casual"},
        {"id": "presenter_male_2", "name": "男性主播 2", "gender": "male", "style": "casual"},
        {"id": "anime_female_1", "name": "动漫女性 1", "gender": "female", "style": "anime"},
        {"id": "anime_male_1", "name": "动漫男性 1", "gender": "male", "style": "anime"},
    ]


# ============================================================
# 8. 日志配置
# ============================================================

class LogConfig:
    """日志配置"""

    # 日志级别
    LEVEL: str = os.environ.get("AURORA_LOG_LEVEL", "INFO")

    # 日志格式
    FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

    # 日期格式
    DATE_FORMAT: str = "%Y-%m-%d %H:%M:%S"

    # 日志文件名
    FILE_NAME: str = "aurora_digital_human.log"

    # 日志文件最大大小（MB）
    MAX_FILE_SIZE_MB: int = 50

    # 日志文件保留数量
    BACKUP_COUNT: int = 5


# ============================================================
# 9. 便捷访问
# ============================================================

# 服务器配置实例
SERVER = ServerConfig()

# 路径配置实例
PATHS = PathConfig()

# 模型下载配置实例
MODEL_DOWNLOADS = ModelDownloadConfig()

# 模型元数据配置实例
MODEL_META = ModelMetaConfig()

# TTS 配置实例
TTS = TTSConfig()

# 推理配置实例
INFERENCE = InferenceConfig()

# 预设头像配置实例
PRESETS = PresetAvatarConfig()

# 日志配置实例
LOGGING = LogConfig()


def init_environment() -> None:
    """
    初始化运行环境：
    1. 创建所有必要的目录
    2. 设置环境变量
    """
    PathConfig.ensure_dirs()
    # 设置 HuggingFace 缓存目录到 Aurora 目录下
    os.environ.setdefault("HF_HOME", str(PATHS.CACHE_DIR / "huggingface"))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(PATHS.CACHE_DIR / "transformers"))
    os.environ.setdefault("TORCH_HOME", str(PATHS.CACHE_DIR / "torch"))


if __name__ == "__main__":
    # 模块直接运行时，打印配置信息用于调试
    init_environment()
    print("=" * 60)
    print("Aurora Digital Human Engine — 配置信息")
    print("=" * 60)
    print(f"服务器地址: http://{SERVER.HOST}:{SERVER.PORT}")
    print(f"模型目录:   {PATHS.MODELS_DIR}")
    print(f"输出目录:   {PATHS.OUTPUT_DIR}")
    print(f"上传目录:   {PATHS.UPLOAD_DIR}")
    print(f"缓存目录:   {PATHS.CACHE_DIR}")
    print(f"日志目录:   {PATHS.LOG_DIR}")
    print(f"支持的模型: {[m['type'] for m in MODEL_META.MODELS]}")
    print(f"TTS 语音数: {len(TTS.get_all_voices())}")
    print("=" * 60)
