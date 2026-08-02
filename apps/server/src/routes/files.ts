/**
 * 文件管理路由
 *
 * GET    /api/files         - 获取所有文件（支持 ?projectId=xxx 按项目过滤）
 * GET    /api/files/:id     - 获取单个文件
 * POST   /api/files         - 创建文件
 * PUT    /api/files/:id     - 更新文件内容
 * DELETE /api/files/:id     - 删除文件
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type {
  CreateFileBody,
  UpdateFileBody,
  ApiResponse,
  FileNode,
} from '../types';
import * as store from '../store';

const fileRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 获取所有文件（支持 ?projectId=xxx 按项目过滤）
  fastify.get<{ Querystring: { projectId?: string } }>(
    '/api/files',
    async (request) => {
      const { projectId } = request.query;
      const files = store.getAllFiles(projectId);
      return { success: true, data: files } as ApiResponse<FileNode[]>;
    },
  );

  // 获取单个文件
  fastify.get<{ Params: { id: string } }>(
    '/api/files/:id',
    async (request, reply) => {
      const { id } = request.params;
      const file = store.getFileById(id);

      if (!file) {
        return reply.status(404).send({
          success: false,
          error: `文件 ${id} 不存在`,
        } as ApiResponse);
      }

      return { success: true, data: file } as ApiResponse<FileNode>;
    },
  );

  // 创建文件
  fastify.post<{ Body: CreateFileBody }>(
    '/api/files',
    async (request, reply) => {
      const { projectId, name, path, content, language, isDirectory } =
        request.body;

      // 参数校验
      if (!projectId || !name || !path) {
        return reply.status(400).send({
          success: false,
          error: 'projectId、name、path 为必填字段',
        } as ApiResponse);
      }

      // 验证项目是否存在
      const project = store.getProjectById(projectId);
      if (!project) {
        return reply.status(404).send({
          success: false,
          error: `项目 ${projectId} 不存在`,
        } as ApiResponse);
      }

      const file = store.createFile({
        projectId,
        name,
        path,
        content,
        language,
        isDirectory,
      });

      return reply.status(201).send({
        success: true,
        data: file,
      } as ApiResponse<FileNode>);
    },
  );

  // 更新文件内容
  fastify.put<{ Params: { id: string }; Body: UpdateFileBody }>(
    '/api/files/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { name, content, language } = request.body;

      const file = store.updateFile(id, { name, content, language });

      if (!file) {
        return reply.status(404).send({
          success: false,
          error: `文件 ${id} 不存在`,
        } as ApiResponse);
      }

      return { success: true, data: file } as ApiResponse<FileNode>;
    },
  );

  // 删除文件
  fastify.delete<{ Params: { id: string } }>(
    '/api/files/:id',
    async (request, reply) => {
      const { id } = request.params;
      const deleted = store.deleteFile(id);

      if (!deleted) {
        return reply.status(404).send({
          success: false,
          error: `文件 ${id} 不存在`,
        } as ApiResponse);
      }

      return { success: true, data: null } as ApiResponse;
    },
  );
};

export default fileRoutes;
