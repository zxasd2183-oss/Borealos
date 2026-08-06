# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — TTS 引擎模块
================================

本模块使用 edge-tts 库实现本地化的文字转语音功能。

edge-tts 是微软 Edge 浏览器 TTS 服务的 Python 封装，
无需 API Key，支持 30+ 种语言、100+ 种语音。

主要功能：
  - 将文字合成为语音（WAV / MP3）
  - 支持 30+ 种语言/语音
  - 支持自定义语速、音调、音量
  - 返回音频文件路径、时长、采样率等信息

注意：edge-tts 需要网络连接（连接微软 TTS 服务），
但不需要任何 API Key 或订阅，属于免费服务。
"""

import asyncio
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Union

from config import TTS, PATHS
from utils.ffmpeg import FFmpegManager

logger = logging.getLogger(__name__)


class TTSEngine:
    """
    TTS 语音合成引擎。

    使用 edge-tts 库将文字转换为语音，支持：
      - 30+ 种语言、100+ 种语音
      - 自定义语速（rate）、音调（pitch）、音量（volume）
      - 输出 WAV 或 MP3 格式
      - 自动获取音频时长

    用法示例：
        engine = TTSEngine()
        result = await engine.synthesize("你好世界", "zh-CN-XiaoxiaoNeural", "/tmp/output.wav")
        print(result)  # {"path": "/tmp/output.wav", "duration": 1.5, "sample_rate": 24000}
    """

    def __init__(self) -> None:
        """初始化 TTS 引擎"""
        self._edge_tts = None
        self._ffmpeg = FFmpegManager()
        self._available = False

        try:
            import edge_tts
            self._edge_tts = edge_tts
            self._available = True
            logger.info("TTS 引擎已初始化（edge-tts）")
        except ImportError:
            logger.error(
                "edge-tts 未安装，TTS 功能不可用。\n"
                "请安装: pip install edge-tts"
            )

    @property
    def available(self) -> bool:
        """TTS 引擎是否可用"""
        return self._available

    async def synthesize(
        self,
        text: str,
        voice: str,
        output_path: str,
        rate: str = None,
        volume: str = None,
        pitch: str = None,
    ) -> dict:
        """
        合成语音。

        将文字转换为语音文件，支持自定义语速、音调和音量。

        Args:
            text: 要合成的文字内容
            voice: 语音 ID（如 "zh-CN-XiaoxiaoNeural"）
            output_path: 输出音频文件路径（.wav 或 .mp3）
            rate: 语速（如 "+50%" 表示加速 50%，"-20%" 表示减速 20%）
            volume: 音量（如 "+50%" 表示增大，"-20%" 表示减小）
            pitch: 音调（如 "+10Hz" 表示升高，"-10Hz" 表示降低）

        Returns:
            dict: 合成结果，包含以下字段
                - path: 音频文件路径
                - duration: 音频时长（秒）
                - sample_rate: 采样率
                - voice: 使用的语音 ID
                - text: 合成的文字内容

        Raises:
            RuntimeError: TTS 引擎不可用
            ValueError: 文字为空或语音 ID 无效
        """
        if not self._available:
            raise RuntimeError(
                "TTS 引擎不可用，请安装 edge-tts: pip install edge-tts"
            )

        # 参数验证
        if not text or not text.strip():
            raise ValueError("合成文字不能为空")

        if not voice:
            voice = TTS.DEFAULT_VOICE
            logger.info(f"未指定语音，使用默认语音: {voice}")

        # 使用默认参数
        if rate is None:
            rate = TTS.DEFAULT_RATE
        if volume is None:
            volume = TTS.DEFAULT_VOLUME
        if pitch is None:
            pitch = TTS.DEFAULT_PITCH

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # 判断输出格式
        is_wav = output_path.suffix.lower() == ".wav"

        # edge-tts 默认输出 MP3 格式
        # 如果需要 WAV，先输出 MP3 再通过 FFmpeg 转换
        if is_wav:
            mp3_path = output_path.with_suffix(".mp3")
        else:
            mp3_path = output_path

        logger.info(f"开始 TTS 合成: voice={voice}, text='{text[:50]}...'")

        try:
            # 创建 edge-tts Communicate 对象
            communicate = self._edge_tts.Communicate(
                text=text,
                voice=voice,
                rate=rate,
                volume=volume,
                pitch=pitch,
            )

            # 合成语音并保存到文件
            await communicate.save(str(mp3_path))

            logger.info(f"TTS 合成完成: {mp3_path}")

            # 如果需要 WAV 格式，使用 FFmpeg 转换
            if is_wav:
                self._ffmpeg.convert_audio(
                    input_path=mp3_path,
                    output_path=output_path,
                    sample_rate=TTS.SAMPLE_RATE,
                    channels=TTS.CHANNELS,
                )
                # 删除临时 MP3 文件
                mp3_path.unlink(missing_ok=True)
                logger.info(f"已转换为 WAV 格式: {output_path}")

            # 获取音频时长
            duration = self._ffmpeg.get_audio_duration(output_path)

            result = {
                "path": str(output_path),
                "duration": duration,
                "sample_rate": TTS.SAMPLE_RATE,
                "voice": voice,
                "text": text,
                "rate": rate,
                "volume": volume,
                "pitch": pitch,
            }

            logger.info(f"TTS 结果: 时长={duration:.1f}s, 路径={output_path}")
            return result

        except Exception as e:
            logger.error(f"TTS 合成失败: {e}")
            raise RuntimeError(f"语音合成失败: {str(e)}")

    def list_voices(self, language: str = None) -> List[dict]:
        """
        列出可用语音。

        从内置的语音列表中返回可用语音信息。
        如果需要获取 edge-tts 的完整语音列表，可以使用 fetch_voices() 方法。

        Args:
            language: 语言代码（如 "zh", "en", "ja", "ko"）。
                      None 表示返回所有语音。

        Returns:
            语音列表，每个元素为字典:
            {
                "id": "zh-CN-XiaoxiaoNeural",
                "name": "晓晓 (女声, 温暖)",
                "language": "zh-CN",
                "gender": "female",
            }
        """
        if language:
            voices = TTS.get_voices_by_language(language)
        else:
            voices = TTS.get_all_voices()

        # 构建返回结果
        result = []
        for voice in voices:
            voice_id = voice["id"]
            # 从 ID 中提取语言代码和性别
            parts = voice_id.split("-")
            lang_code = "-".join(parts[:2]) if len(parts) >= 2 else voice_id
            gender = "female" if "Female" in voice["name"] or "女" in voice["name"] or "여성" in voice["name"] or "女性" in voice["name"] else "male"

            result.append({
                "id": voice_id,
                "name": voice["name"],
                "language": lang_code,
                "gender": gender,
            })

        return result

    async def fetch_voices(self) -> List[dict]:
        """
        从 edge-tts 服务获取完整的语音列表（需要网络连接）。

        此方法会连接微软 TTS 服务获取所有可用语音，
        比 list_voices() 返回的列表更完整。

        Returns:
            完整的语音列表

        Raises:
            RuntimeError: edge-tts 不可用或网络错误
        """
        if not self._available:
            raise RuntimeError("edge-tts 不可用")

        try:
            voices = await self._edge_tts.list_voices()
            result = []
            for voice in voices:
                result.append({
                    "id": voice["ShortName"],
                    "name": voice.get("FriendlyName", voice["ShortName"]),
                    "language": voice.get("Locale", ""),
                    "gender": voice.get("Gender", "").lower(),
                    "voice_type": voice.get("VoiceType", ""),
                    "status": voice.get("Status", ""),
                })
            return result
        except Exception as e:
            logger.error(f"获取语音列表失败: {e}")
            raise RuntimeError(f"获取语音列表失败: {str(e)}")

    async def synthesize_to_temp(
        self,
        text: str,
        voice: str = None,
        rate: str = None,
        volume: str = None,
        pitch: str = None,
    ) -> dict:
        """
        合成语音到临时文件。

        自动生成文件名，保存到 TTS 输出目录。

        Args:
            text: 要合成的文字
            voice: 语音 ID，None 使用默认语音
            rate: 语速
            volume: 音量
            pitch: 音调

        Returns:
            dict: 合成结果（同 synthesize 方法）
        """
        if voice is None:
            voice = TTS.DEFAULT_VOICE

        # 生成唯一文件名
        filename = f"tts_{uuid.uuid4().hex[:8]}_{int(time.time())}.wav"
        output_path = PATHS.TTS_OUTPUT_DIR / filename

        return await self.synthesize(
            text=text,
            voice=voice,
            output_path=str(output_path),
            rate=rate,
            volume=volume,
            pitch=pitch,
        )

    def get_default_voice(self) -> str:
        """获取默认语音 ID"""
        return TTS.DEFAULT_VOICE

    def validate_voice(self, voice: str) -> bool:
        """
        验证语音 ID 是否有效。

        Args:
            voice: 语音 ID

        Returns:
            bool: True 表示有效
        """
        all_voices = TTS.get_all_voices()
        return any(v["id"] == voice for v in all_voices)


if __name__ == "__main__":
    # 模块直接运行时，测试 TTS 功能
    import json

    logging.basicConfig(level=logging.DEBUG)

    engine = TTSEngine()
    print(f"TTS 可用: {engine.available}")
    print(f"默认语音: {engine.get_default_voice()}")

    # 列出中文语音
    zh_voices = engine.list_voices("zh")
    print(f"\n中文语音 ({len(zh_voices)} 个):")
    for v in zh_voices[:5]:
        print(f"  - {v['id']}: {v['name']}")

    # 列出英文语音
    en_voices = engine.list_voices("en")
    print(f"\n英文语音 ({len(en_voices)} 个):")
    for v in en_voices[:5]:
        print(f"  - {v['id']}: {v['name']}")

    # 如果 TTS 可用，测试合成
    if engine.available:
        print("\n测试语音合成...")
        result = asyncio.run(engine.synthesize_to_temp(
            "你好，这是一个数字人语音合成测试。",
            "zh-CN-XiaoxiaoNeural",
        ))
        print(f"合成结果: {json.dumps(result, indent=2, ensure_ascii=False)}")
