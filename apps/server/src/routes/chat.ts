/**
 * AI 聊天路由
 *
 * GET  /api/models       - 获取可用模型列表
 * POST /api/chat         - 发送消息获取 AI 回复（非流式）
 * WS   /api/chat/ws      - WebSocket 流式聊天
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ChatRequestBody, ChatMessage, ApiResponse, ChatWsOutput } from '../types';
import * as store from '../store';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  chatCompletion,
  chatCompletionStream,
  type AIModel,
  type ChatAPIMessage,
} from '../ai';
import { MemoryManager, type MemoryEntry, type MemorySearchResult } from '@borealos/memory';

/** 查找模型信息 */
function findModel(modelId: string): AIModel | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId);
}

/**
 * 记忆管理器（模块级单例）
 *
 * 基于 MemGPT 分层记忆架构，统一管理核心/短期/长期三层记忆，
 * 为聊天路由提供上下文构建与对话归档能力。
 */
const memoryManager = new MemoryManager();

/**
 * 将短期记忆格式化为可注入 LLM 的 system 消息文本
 *
 * @param memories 短期记忆条目列表
 * @returns 格式化后的 system 消息内容
 */
function formatShortTermMemory(memories: MemoryEntry[]): string {
  const lines = memories.map((m) => `- ${m.content}`);
  return `# 短期记忆召回（近期对话）\n${lines.join('\n')}`;
}

/**
 * 将长期记忆召回结果格式化为可注入 LLM 的 system 消息文本
 *
 * @param memories 长期记忆召回结果列表
 * @returns 格式化后的 system 消息内容
 */
function formatLongTermMemory(memories: MemorySearchResult[]): string {
  const lines = memories.map(
    (r) => `- [相关度 ${(r.score * 100).toFixed(1)}%] ${r.entry.content}`,
  );
  return `# 长期记忆召回（相关历史）\n${lines.join('\n')}`;
}

const chatRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/models - 获取可用模型列表
  fastify.get('/api/models', async () => {
    return { success: true, data: AVAILABLE_MODELS } as ApiResponse<AIModel[]>;
  });

  // POST /api/chat - 非流式聊天
  fastify.post<{ Body: ChatRequestBody }>(
    '/api/chat',
    async (request, reply) => {
      const { message, projectId, model, history } = request.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: '消息内容不能为空',
        } as ApiResponse);
      }

      // 保存用户消息
      store.addChatMessage({ role: 'user', content: message, projectId });

      // 构建记忆上下文（在保存用户消息后、构建消息列表之前）
      // 注意：先构建上下文再写入记忆，避免当前消息在短期记忆召回中重复出现
      const memContext = await memoryManager.buildContext(projectId || 'default', message);
      // 将用户消息归档到记忆系统（用于后续对话的上下文召回）
      memoryManager.addMessage(projectId || 'default', 'user', message);

      // 构建消息列表（使用记忆系统生成的系统提示词替代硬编码提示）
      const messages: ChatAPIMessage[] = [
        { role: 'system', content: memContext.systemPrompt },
      ];
      // 插入短期记忆召回（如有内容，作为额外的 system 消息）
      if (memContext.shortTermMemories.length > 0) {
        messages.push({ role: 'system', content: formatShortTermMemory(memContext.shortTermMemories) });
      }
      // 插入长期记忆召回（如有内容，作为额外的 system 消息）
      if (memContext.longTermMemories.length > 0) {
        messages.push({ role: 'system', content: formatLongTermMemory(memContext.longTermMemories) });
      }
      // 加入历史消息
      if (history && history.length > 0) {
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            messages.push({ role: h.role, content: h.content });
          }
        }
      }
      // 当前消息
      messages.push({ role: 'user', content: message });

      const useModel = model || DEFAULT_MODEL;
      const modelInfo = findModel(useModel);
      const startTime = Date.now();

      try {
        const result = await chatCompletion(useModel, messages);
        const latency = Date.now() - startTime;

        // 记录用量
        store.addUsageRecord({
          model: useModel,
          brand: modelInfo?.brand ?? '未知',
          modelName: modelInfo?.name ?? useModel,
          promptTokens: result.usage.prompt_tokens,
          completionTokens: result.usage.completion_tokens,
          totalTokens: result.usage.total_tokens,
          latency,
          success: true,
        });

        const assistantMessage = store.addChatMessage({
          role: 'assistant',
          content: result.content,
          projectId,
        });

        // 将 AI 回复归档到记忆系统
        memoryManager.addMessage(projectId || 'default', 'assistant', result.content);

        return reply.send({
          success: true,
          data: assistantMessage,
        } as ApiResponse<ChatMessage>);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'AI 服务调用失败';
        const latency = Date.now() - startTime;
        fastify.log.error(`AI 聊天错误: ${errorMsg}`);

        // 记录失败的用量
        store.addUsageRecord({
          model: useModel,
          brand: modelInfo?.brand ?? '未知',
          modelName: modelInfo?.name ?? useModel,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latency,
          success: false,
        });

        // 回退到模拟回复
        const fallback = `⚠️ AI 服务暂时不可用：${errorMsg}\n\n以下是模拟回复：\n收到你的消息："${message}"`;
        const assistantMessage = store.addChatMessage({
          role: 'assistant',
          content: fallback,
          projectId,
        });

        return reply.send({
          success: true,
          data: assistantMessage,
        } as ApiResponse<ChatMessage>);
      }
    },
  );

  // WebSocket /api/chat/ws - 流式聊天
  fastify.get('/api/chat/ws', { websocket: true }, (socket, request) => {
    fastify.log.info('聊天 WebSocket 已连接');

    socket.on('message', async (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage.toString()) as ChatRequestBody;
        const { message, projectId, model, history } = data;

        if (!message || message.trim().length === 0) {
          const errorMsg: ChatWsOutput = { type: 'error', error: '消息内容不能为空' };
          socket.send(JSON.stringify(errorMsg));
          return;
        }

        // 保存用户消息
        store.addChatMessage({ role: 'user', content: message, projectId });

        // 构建记忆上下文（在保存用户消息后、构建消息列表之前）
        // 注意：先构建上下文再写入记忆，避免当前消息在短期记忆召回中重复出现
        const memContext = await memoryManager.buildContext(projectId || 'default', message);
        // 将用户消息归档到记忆系统（用于后续对话的上下文召回）
        memoryManager.addMessage(projectId || 'default', 'user', message);

        // 构建消息列表（使用记忆系统生成的系统提示词替代硬编码提示）
        const messages: ChatAPIMessage[] = [
          { role: 'system', content: memContext.systemPrompt },
        ];
        // 插入短期记忆召回（如有内容，作为额外的 system 消息）
        if (memContext.shortTermMemories.length > 0) {
          messages.push({ role: 'system', content: formatShortTermMemory(memContext.shortTermMemories) });
        }
        // 插入长期记忆召回（如有内容，作为额外的 system 消息）
        if (memContext.longTermMemories.length > 0) {
          messages.push({ role: 'system', content: formatLongTermMemory(memContext.longTermMemories) });
        }
        if (history && history.length > 0) {
          for (const h of history) {
            if (h.role === 'user' || h.role === 'assistant') {
              messages.push({ role: h.role, content: h.content });
            }
          }
        }
        messages.push({ role: 'user', content: message });

        const useModel = model || DEFAULT_MODEL;
        const modelInfo = findModel(useModel);
        const startTime = Date.now();

        try {
          let fullContent = '';

          // 流式输出
          for await (const chunk of chatCompletionStream(useModel, messages)) {
            if (socket.readyState !== 1) return;

            fullContent += chunk;
            const chunkMsg: ChatWsOutput = { type: 'chunk', content: chunk };
            socket.send(JSON.stringify(chunkMsg));
          }

          const latency = Date.now() - startTime;

          // 流式 API 不返回 usage，用字符数近似估算 Token（中文约 1.5 字/token，英文约 4 字/token）
          const inputText = messages.map((m) => m.content).join('');
          const estPromptTokens = Math.ceil(inputText.length / 2);
          const estCompletionTokens = Math.ceil(fullContent.length / 2);

          // 记录用量
          store.addUsageRecord({
            model: useModel,
            brand: modelInfo?.brand ?? '未知',
            modelName: modelInfo?.name ?? useModel,
            promptTokens: estPromptTokens,
            completionTokens: estCompletionTokens,
            totalTokens: estPromptTokens + estCompletionTokens,
            latency,
            success: true,
          });

          // 发送完成信号
          if (socket.readyState === 1) {
            const doneMsg: ChatWsOutput = { type: 'done', content: fullContent };
            socket.send(JSON.stringify(doneMsg));

            // 保存完整回复
            store.addChatMessage({
              role: 'assistant',
              content: fullContent,
              projectId,
            });

            // 将 AI 回复归档到记忆系统
            memoryManager.addMessage(projectId || 'default', 'assistant', fullContent);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'AI 流式调用失败';
          const latency = Date.now() - startTime;
          fastify.log.error(`AI 流式聊天错误: ${errorMsg}`);

          // 记录失败的用量
          store.addUsageRecord({
            model: useModel,
            brand: modelInfo?.brand ?? '未知',
            modelName: modelInfo?.name ?? useModel,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            latency,
            success: false,
          });

          if (socket.readyState === 1) {
            const errOut: ChatWsOutput = {
              type: 'error',
              error: `AI 服务错误: ${errorMsg}`,
            };
            socket.send(JSON.stringify(errOut));
          }
        }
      } catch {
        const errorMsg: ChatWsOutput = {
          type: 'error',
          error: '消息格式错误，请发送 JSON: { "message": "内容", "model": "模型ID" }',
        };
        socket.send(JSON.stringify(errorMsg));
      }
    });

    socket.on('close', () => {
      fastify.log.info('聊天 WebSocket 已断开');
    });

    socket.on('error', (err: Error) => {
      fastify.log.error(`聊天 WebSocket 错误: ${err.message}`);
    });
  });
};

export default chatRoutes;
