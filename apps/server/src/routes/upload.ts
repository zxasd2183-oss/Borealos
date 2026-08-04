/**
 * 文件上传路由
 *
 * 端点：
 *   POST /api/upload          — 上传文件（multipart）
 *   GET  /api/upload/list     — 列出已上传文件
 *   DELETE /api/upload/:id    — 删除上传文件
 *
 * 文件存储在 public/uploads/ 目录，通过 /static/uploads/ 访问
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';

// ==================== 配置 ====================

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_TYPES = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
  document: ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx', 'ppt', 'pptx'],
  code: ['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql'],
  archive: ['zip', 'tar', 'gz', 'rar', '7z'],
  other: ['*'],
};

// ==================== 内存存储（元数据） ====================

interface UploadMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  category: string;
  uploadedAt: number;
}

const uploadStore = new Map<string, UploadMeta>();

// ==================== 工具函数 ====================

function getFileCategory(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  for (const [category, exts] of Object.entries(ALLOWED_TYPES)) {
    if (exts.includes(ext) || exts.includes('*')) return category;
  }
  return 'other';
}

function genFileId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function genSafeFilename(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() || '';
  const hash = createHash('md5').update(`${originalName}-${Date.now()}`).digest('hex').slice(0, 8);
  return `${hash}.${ext}`;
}

/** 确保 uploads 目录存在 */
function ensureUploadDir(): string {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    return UPLOAD_DIR;
  } catch {
    // 只读文件系统兜底
    const fallback = '/tmp/borealos-uploads';
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

// ==================== 路由定义 ====================

export default async function uploadRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/upload — 上传文件
   *
   * 接收 multipart/form-data，字段名 "file"
   * 返回文件 URL 和元数据
   */
  fastify.post('/api/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ success: false, error: '未找到文件' });
      }

      // 检查文件大小
      const chunks: Buffer[] = [];
      let totalSize = 0;
      
      for await (const chunk of data.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          return reply.code(413).send({ 
            success: false, 
            error: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）` 
          });
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const safeFilename = genSafeFilename(data.filename);
      const uploadDir = ensureUploadDir();
      const filePath = path.join(uploadDir, safeFilename);
      
      fs.writeFileSync(filePath, buffer);

      const fileId = genFileId();
      const category = getFileCategory(data.filename);
      const meta: UploadMeta = {
        id: fileId,
        filename: safeFilename,
        originalName: data.filename,
        mimeType: data.mimetype,
        size: totalSize,
        url: `/static/uploads/${safeFilename}`,
        category,
        uploadedAt: Date.now(),
      };

      uploadStore.set(fileId, meta);

      fastify.log.info(`文件上传成功: ${data.filename} → ${safeFilename} (${totalSize} bytes)`);

      return reply.send({ success: true, data: meta });
    } catch (err) {
      const message = err instanceof Error ? err.message : '文件上传失败';
      fastify.log.error(`文件上传错误: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  /**
   * POST /api/upload/base64 — Base64 方式上传（用于粘贴图片）
   */
  fastify.post('/api/upload/base64', async (req: FastifyRequest, reply: FastifyReply) => {
    const { data: base64Data, filename, mimeType } = req.body as {
      data: string;
      filename?: string;
      mimeType?: string;
    };

    if (!base64Data) {
      return reply.code(400).send({ success: false, error: '缺少 base64 数据' });
    }

    try {
      // 去掉 data:image/png;base64, 前缀
      const base64 = base64Data.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');

      if (buffer.length > MAX_FILE_SIZE) {
        return reply.code(413).send({ 
          success: false, 
          error: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）` 
        });
      }

      const originalName = filename || `pasted-${Date.now()}.png`;
      const safeFilename = genSafeFilename(originalName);
      const uploadDir = ensureUploadDir();
      const filePath = path.join(uploadDir, safeFilename);

      fs.writeFileSync(filePath, buffer);

      const fileId = genFileId();
      const category = getFileCategory(originalName);
      const meta: UploadMeta = {
        id: fileId,
        filename: safeFilename,
        originalName,
        mimeType: mimeType || 'image/png',
        size: buffer.length,
        url: `/static/uploads/${safeFilename}`,
        category,
        uploadedAt: Date.now(),
      };

      uploadStore.set(fileId, meta);

      return reply.send({ success: true, data: meta });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Base64 上传失败';
      return reply.code(500).send({ success: false, error: message });
    }
  });

  /**
   * GET /api/upload/list — 列出已上传文件
   */
  fastify.get('/api/upload/list', async (req: FastifyRequest, reply: FastifyReply) => {
    const { category } = req.query as { category?: string };
    
    let files = Array.from(uploadStore.values()).sort((a, b) => b.uploadedAt - a.uploadedAt);
    
    if (category) {
      files = files.filter((f) => f.category === category);
    }

    return reply.send({ success: true, data: files });
  });

  /**
   * DELETE /api/upload/:id — 删除上传文件
   */
  fastify.delete('/api/upload/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const meta = uploadStore.get(id);

    if (!meta) {
      return reply.code(404).send({ success: false, error: '文件不存在' });
    }

    // 删除物理文件
    try {
      const uploadDir = ensureUploadDir();
      const filePath = path.join(uploadDir, meta.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // 物理删除失败不影响元数据删除
    }

    uploadStore.delete(id);
    return reply.send({ success: true, data: { id } });
  });
}
