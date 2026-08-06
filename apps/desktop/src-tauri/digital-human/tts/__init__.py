# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — TTS 语音合成模块
====================================

本包提供文字转语音 (Text-to-Speech) 功能，使用 edge-tts 库实现本地化 TTS。
不依赖任何第三方云 API，所有语音合成在本地完成。

主要功能：
  - 支持 30+ 种语言/语音（中文、英文、日语、韩语等）
  - 合成后保存为 WAV 或 MP3 文件
  - 返回音频文件路径和时长信息

模块导出：
  - TTSEngine: TTS 引擎类
  - synthesize: 便捷合成函数
  - list_voices: 列出可用语音
"""

from tts.engine import TTSEngine

__all__ = [
    "TTSEngine",
    "synthesize",
    "list_voices",
]

# 全局 TTS 引擎实例（延迟初始化）
_tts_engine: TTSEngine = None


def get_engine() -> TTSEngine:
    """获取全局 TTS 引擎实例（单例模式）"""
    global _tts_engine
    if _tts_engine is None:
        _tts_engine = TTSEngine()
    return _tts_engine


async def synthesize(text: str, voice: str, output_path: str) -> dict:
    """
    文字转语音（便捷函数）。

    Args:
        text: 要合成的文字
        voice: 语音 ID（如 zh-CN-XiaoxiaoNeural）
        output_path: 输出音频文件路径

    Returns:
        dict: {"path": str, "duration": float, "sample_rate": int}
    """
    engine = get_engine()
    return await engine.synthesize(text, voice, output_path)


def list_voices(language: str = None) -> list:
    """
    列出可用语音（便捷函数）。

    Args:
        language: 语言代码（如 'zh', 'en'），None 表示全部

    Returns:
        语音列表
    """
    engine = get_engine()
    return engine.list_voices(language)
