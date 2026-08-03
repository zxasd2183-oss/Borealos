/**
 * 项目管理路由
 *
 * GET    /api/projects      - 获取所有项目
 * GET    /api/projects/:id  - 获取单个项目
 * POST   /api/projects      - 创建项目
 * PUT    /api/projects/:id  - 更新项目
 * DELETE /api/projects/:id  - 删除项目
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type {
  CreateProjectBody,
  UpdateProjectBody,
  ApiResponse,
  Project,
} from '../types';
import { BUILTIN_AGENTS } from '../types';
import type { AIAgent } from '../types';
import * as store from '../store';

const projectRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 获取所有项目
  fastify.get('/api/projects', async () => {
    const projects = store.getAllProjects();
    return { success: true, data: projects } as ApiResponse<Project[]>;
  });

  // 获取所有可用 AI Agent
  fastify.get('/api/agents', async () => {
    return { success: true, data: BUILTIN_AGENTS } as ApiResponse<AIAgent[]>;
  });

  // 获取单个项目
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id',
    async (request, reply) => {
      const { id } = request.params;
      const project = store.getProjectById(id);

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: `项目 ${id} 不存在`,
        } as ApiResponse);
      }

      return { success: true, data: project } as ApiResponse<Project>;
    },
  );

  // 创建项目
  fastify.post<{ Body: CreateProjectBody }>(
    '/api/projects',
    async (request, reply) => {
      const { name, description, agent, settings } = request.body;

      // 参数校验
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: '项目名称不能为空',
        } as ApiResponse);
      }

      const project = store.createProject({
        name: name.trim(),
        description,
        agent,
        settings,
      });

      return reply.status(201).send({
        success: true,
        data: project,
      } as ApiResponse<Project>);
    },
  );

  // 更新项目
  fastify.put<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/api/projects/:id',
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, agent, settings } = request.body;

      const project = store.updateProject(id, { name, description, agent, settings });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: `项目 ${id} 不存在`,
        } as ApiResponse);
      }

      return { success: true, data: project } as ApiResponse<Project>;
    },
  );

  // 删除项目（同时删除关联的文件和聊天消息）
  fastify.delete<{ Params: { id: string } }>(
    '/api/projects/:id',
    async (request, reply) => {
      const { id } = request.params;
      const deleted = store.deleteProject(id);

      if (!deleted) {
        return reply.status(404).send({
          success: false,
          error: `项目 ${id} 不存在`,
        } as ApiResponse);
      }

      return { success: true, data: null } as ApiResponse;
    },
  );
};

export default projectRoutes;
