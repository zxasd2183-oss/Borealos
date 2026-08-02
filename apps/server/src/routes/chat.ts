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

      // 构建消息列表
      const messages: ChatAPIMessage[] = [
        { role: 'system', content: '你是 BorealOS IDE 的 AI 助手，帮助用户编写和调试代码。请用中文回复。' },
      ];
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

      try {
        const result = await chatCompletion(useModel, messages);

        const assistantMessage = store.addChatMessage({
          role: 'assistant',
          content: result.content,
          projectId,
        });

        return reply.send({
          success: true,
          data: assistantMessage,
        } as ApiResponse<ChatMessage>);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'AI 服务调用失败';
        fastify.log.error(`AI 聊天错误: ${errorMsg}`);

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

        // 构建消息列表
        const messages: ChatAPIMessage[] = [
          { role: 'system', content: '你是 BorealOS IDE 的 AI 助手，帮助用户编写和调试代码。请用中文回复。' },
        ];
        if (history && history.length > 0) {
          for (const h of history) {
            if (h.role === 'user' || h.role === 'assistant') {
              messages.push({ role: h.role, content: h.content });
            }
          }
        }
        messages.push({ role: 'user', content: message });

        const useModel = model || DEFAULT_MODEL;

        try {
          let fullContent = '';

          // 流式输出
          for await (const chunk of chatCompletionStream(useModel, messages)) {
            if (socket.readyState !== 1) return;

            fullContent += chunk;
            const chunkMsg: ChatWsOutput = { type: 'chunk', content: chunk };
            socket.send(JSON.stringify(chunkMsg));
          }

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
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'AI 流式调用失败';
          fastify.log.error(`AI 流式聊天错误: ${errorMsg}`);

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
