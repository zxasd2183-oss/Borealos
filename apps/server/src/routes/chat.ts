/**
 * AI 聊天路由
 *
 * POST /api/chat     - 发送消息并获取回复（模拟 AI 回复）
 * WS   /api/chat/ws  - WebSocket 流式聊天（模拟流式输出）
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ChatRequestBody, ChatMessage, ApiResponse, ChatWsOutput } from '../types';
import * as store from '../store';

const chatRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/chat - 发送消息并获取模拟回复
  fastify.post<{ Body: ChatRequestBody }>(
    '/api/chat',
    async (request, reply) => {
      const { message, projectId } = request.body;

      // 参数校验
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: '消息内容不能为空',
        } as ApiResponse);
      }

      // 保存用户消息
      store.addChatMessage({
        role: 'user',
        content: message,
        projectId,
      });

      // 生成模拟回复
      const replyContent = generateMockReply(message);

      // 保存助手回复
      const assistantMessage = store.addChatMessage({
        role: 'assistant',
        content: replyContent,
        projectId,
      });

      return reply.send({
        success: true,
        data: assistantMessage,
      } as ApiResponse<ChatMessage>);
    },
  );

  // WebSocket /api/chat/ws - 流式聊天
  fastify.get('/api/chat/ws', { websocket: true }, (socket, request) => {
    fastify.log.info('聊天 WebSocket 已连接');

    socket.on('message', (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage.toString()) as ChatRequestBody;
        const { message, projectId } = data;

        if (!message || message.trim().length === 0) {
          const errorMsg: ChatWsOutput = {
            type: 'error',
            error: '消息内容不能为空',
          };
          socket.send(JSON.stringify(errorMsg));
          return;
        }

        // 保存用户消息
        store.addChatMessage({
          role: 'user',
          content: message,
          projectId,
        });

        // 生成模拟回复
        const replyContent = generateMockReply(message);

        // 模拟流式输出：逐字符发送
        const chars = Array.from(replyContent);
        let index = 0;

        const interval = setInterval(() => {
          // WebSocket 连接已断开则停止
          if (socket.readyState !== 1) {
            // readyState 1 = WebSocket.OPEN
            clearInterval(interval);
            return;
          }

          if (index >= chars.length) {
            // 全部发送完毕，发送结束标志
            const doneMsg: ChatWsOutput = {
              type: 'done',
              content: replyContent,
            };
            socket.send(JSON.stringify(doneMsg));

            // 保存完整的助手回复
            store.addChatMessage({
              role: 'assistant',
              content: replyContent,
              projectId,
            });

            clearInterval(interval);
            return;
          }

          // 逐字符发送
          const chunkMsg: ChatWsOutput = {
            type: 'chunk',
            content: chars[index],
          };
          socket.send(JSON.stringify(chunkMsg));
          index++;
        }, 30); // 每 30ms 发送一个字符，模拟流式输出
      } catch {
        // JSON 解析失败
        const errorMsg: ChatWsOutput = {
          type: 'error',
          error: '消息格式错误，请发送 JSON 格式：{ "message": "内容" }',
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

/**
 * 生成模拟 AI 回复
 *
 * 当前为模拟实现，后续版本将接入真实 AI 模型。
 * @param userMessage 用户消息
 * @returns 模拟回复内容
 */
function generateMockReply(userMessage: string): string {
  const replies: string[] = [
    `我收到了你的消息："${userMessage}"。这是一个模拟回复，实际的 AI 集成将在后续版本中实现。`,
    `关于"${userMessage}"，我理解你的问题。目前我处于模拟模式，暂时无法提供真实的 AI 回复。`,
    `你说了："${userMessage}"。\n\n这是一条来自 BorealOS 后端的模拟回复。在接入真实的 AI 模型后，我将能够提供更有帮助的回答。`,
    `收到消息："${userMessage}"。\n\n当前运行在模拟模式。要启用真实的 AI 对话，请配置 AI 模型的 API 密钥。`,
  ];

  // 根据消息长度选择不同的回复
  const index = userMessage.length % replies.length;
  return replies[index];
}

export default chatRoutes;
