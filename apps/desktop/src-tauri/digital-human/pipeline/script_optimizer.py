# -*- coding: utf-8 -*-
"""
Aurora 数字人引擎 — LLM 文案优化器
===================================

调用云端大语言模型（LLM）对用户输入的脚本文案进行优化。

支持的 LLM 后端：
  - 阿里云通义千问 (Qwen)  — 国内直连，免费额度
  - OpenAI GPT             — 国际服务
  - 本地 Ollama             — 离线运行

优化能力：
  - 修正语法错误和错别字
  - 优化口语化表达，适合语音播报
  - 调整文案节奏和停顿
  - 控制文案长度
  - 添加情感语气标记

核心设计：这是一个"自研"的优化器，我们定义了优化策略和提示词工程，
LLM 只是执行具体文字处理的"零件"。
"""

import asyncio
import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("aurora.pipeline.script_optimizer")


class ScriptOptimizer:
    """
    LLM 文案优化器。

    调用云端大模型对脚本文案进行优化，使其更适合数字人播报。

    用法：
        optimizer = ScriptOptimizer(
            backend="qwen",
            api_key="sk-xxx",
        )
        optimized = await optimizer.optimize("大家好今天给大家介绍...")
    """

    # 优化风格预设
    STYLE_PRESETS = {
        "natural": {
            "name": "自然流畅",
            "prompt": "请优化以下文案，使其更适合语音播报。要求：口语化、自然流畅、易于听懂。保持原意不变，可适当调整语序和措辞。",
        },
        "professional": {
            "name": "专业正式",
            "prompt": "请优化以下文案，使其适合正式场合的语音播报。要求：用词专业、逻辑清晰、节奏稳健。保持原意不变。",
        },
        "enthusiastic": {
            "name": "热情活泼",
            "prompt": "请优化以下文案，使其适合短视频/直播场景。要求：热情活泼、有感染力、节奏明快。可适当增加互动性表达。保持原意不变。",
        },
        "calm": {
            "name": "温和叙事",
            "prompt": "请优化以下文案，使其适合故事讲述/知识科普。要求：温和舒缓、娓娓道来、逻辑清晰。保持原意不变。",
        },
        "news": {
            "name": "新闻播报",
            "prompt": "请优化以下文案，使其适合新闻播报风格。要求：简洁明了、客观中立、信息密度高。保持原意不变。",
        },
    }

    def __init__(
        self,
        backend: str = "qwen",
        api_key: str = "",
        model: str = "",
        base_url: str = "",
        timeout: float = 30.0,
    ):
        """
        Args:
            backend: LLM 后端 ("qwen" | "openai" | "ollama")
            api_key: API Key
            model: 模型名称（留空使用默认）
            base_url: 自定义 API 地址（用于 Ollama 等）
            timeout: 请求超时时间
        """
        self.backend = backend
        self.api_key = api_key
        self.timeout = timeout

        # 根据后端设置默认模型和地址
        if backend == "qwen":
            self.model = model or "qwen-plus"
            self.base_url = base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        elif backend == "openai":
            self.model = model or "gpt-4o-mini"
            self.base_url = base_url or "https://api.openai.com/v1"
        elif backend == "ollama":
            self.model = model or "qwen2.5:7b"
            self.base_url = base_url or "http://localhost:11434/v1"
        else:
            self.model = model or "qwen-plus"
            self.base_url = base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"

        logger.info(f"文案优化器已初始化: backend={backend}, model={self.model}")

    def is_available(self) -> bool:
        """检查优化器是否可用"""
        if self.backend == "ollama":
            # Ollama 不需要 API Key
            return True
        return bool(self.api_key)

    async def optimize(
        self,
        text: str,
        style: str = "natural",
        max_length: int = 2000,
    ) -> str:
        """
        优化脚本文案。

        Args:
            text: 原始文案
            style: 优化风格 ("natural" | "professional" | "enthusiastic" | "calm" | "news")
            max_length: 最大字数限制

        Returns:
            优化后的文案
        """
        if not text or not text.strip():
            return text

        # 如果文案很短，不需要优化
        if len(text) < 20:
            logger.info("文案太短，跳过优化")
            return text

        # 如果优化器不可用，返回原文
        if not self.is_available():
            logger.warning("文案优化器不可用，使用原始文案")
            return text

        # 获取风格提示词
        style_preset = self.STYLE_PRESETS.get(style, self.STYLE_PRESETS["natural"])
        style_prompt = style_preset["prompt"]

        # 构建系统提示词
        system_prompt = (
            "你是一个专业的文案优化助手，专门为数字人视频播报优化文案。\n"
            f"{style_prompt}\n"
            f"优化后的文案不超过 {max_length} 字。\n"
            "只返回优化后的文案正文，不要包含任何解释、标注或额外说明。\n"
            "不要使用 Markdown 格式。"
        )

        # 调用 LLM
        try:
            optimized = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=text,
            )

            # 清理结果（去掉可能的引号、标记等）
            optimized = optimized.strip().strip('"').strip("'").strip("`")

            # 如果优化结果为空或太短，回退到原文
            if not optimized or len(optimized) < len(text) * 0.3:
                logger.warning("优化结果异常，使用原始文案")
                return text

            logger.info(
                f"文案优化完成: {len(text)}字 → {len(optimized)}字 "
                f"(style={style})"
            )
            return optimized

        except Exception as e:
            logger.error(f"文案优化失败: {e}")
            # 优化失败时回退到原文
            return text

    async def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        """
        调用 LLM API。

        使用 OpenAI 兼容接口（阿里云通义千问、OpenAI、Ollama 都兼容此格式）。
        """
        try:
            import aiohttp
        except ImportError:
            logger.error("aiohttp 未安装")
            return user_prompt

        headers = {
            "Content-Type": "application/json",
        }

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 2000,
        }

        url = f"{self.base_url}/chat/completions"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error(f"LLM API 错误 ({resp.status}): {error_text[:200]}")
                    raise RuntimeError(f"LLM API 返回 {resp.status}")

                result = await resp.json()

                # OpenAI 兼容格式
                content = (
                    result.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )

                if not content:
                    logger.warning(f"LLM 返回空内容: {json.dumps(result, ensure_ascii=False)[:200]}")
                    return user_prompt

                return content

    def get_styles(self) -> list:
        """获取所有可用的优化风格"""
        return [
            {"id": k, "name": v["name"]}
            for k, v in self.STYLE_PRESETS.items()
        ]
