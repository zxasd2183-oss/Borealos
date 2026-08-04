// ============================================================
// Aurora 桌面端 — 自动更新检查 API
// ------------------------------------------------------------
// Tauri Updater 插件会请求：
//   GET /api/update/check/:target/:arch/:current_version
//
// 如果有更新，返回 200 + JSON manifest：
//   { version, pub_date, url, signature, notes }
//
// 如果没有更新，返回 204 No Content
// ============================================================

import type { FastifyInstance } from 'fastify';

/** 当前发布版本信息（模拟 — 实际应从数据库或配置文件读取） */
const LATEST_VERSION = '0.2.0';

/** 版本比较：返回 1 表示 a > b，-1 表示 a < b，0 表示相等 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** 根据目标平台生成下载 URL */
function getDownloadUrl(target: string, arch: string, version: string): string {
  const base = process.env.AURORA_UPDATE_BASE_URL || 'http://localhost:3001/static/releases';
  switch (target) {
    case 'linux':
      return `${base}/aurora-${version}-${arch}.AppImage`;
    case 'windows':
      return `${base}/aurora-${version}-${arch}-setup.exe`;
    case 'darwin':
      return `${base}/aurora-${version}-${arch}.dmg`;
    default:
      return `${base}/aurora-${version}-${target}-${arch}`;
  }
}

export default async function updateRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/update/check/:target/:arch/:current_version
   *
   * Tauri Updater 会自动请求此端点检查是否有新版本。
   * 路径参数：
   *   - target: 目标平台（linux / windows / darwin）
   *   - arch: 架构（x86_64 / aarch64 / i686）
   *   - current_version: 当前应用版本号
   */
  fastify.get<{
    Params: {
      target: string;
      arch: string;
      current_version: string;
    };
  }>(
    '/api/update/check/:target/:arch/:current_version',
    async (request, reply) => {
      const { target, arch, current_version } = request.params;

      fastify.log.info(
        `[Update] 检查更新: target=${target}, arch=${arch}, current=${current_version}, latest=${LATEST_VERSION}`,
      );

      // 比较版本号
      if (compareVersions(LATEST_VERSION, current_version) <= 0) {
        // 当前版本已是最新或更高 → 无需更新
        reply.code(204).send();
        return;
      }

      // 有新版本可用 → 返回更新 manifest
      const manifest = {
        version: LATEST_VERSION,
        pub_date: new Date().toISOString(),
        url: getDownloadUrl(target, arch, LATEST_VERSION),
        signature: '', // 实际应使用 Tauri Signer 生成签名
        notes: `Aurora ${LATEST_VERSION} 已发布，包含性能优化和问题修复。`,
      };

      reply.code(200).send(manifest);
    },
  );

  /**
   * GET /api/update/info
   *
   * 前端手动检查更新时调用，返回更友好的 JSON。
   */
  fastify.get('/api/update/info', async (_request, reply) => {
    reply.send({
      success: true,
      data: {
        latest_version: LATEST_VERSION,
        current_version: null, // 由前端通过 Tauri 命令获取
        download_available: true,
        release_notes: `Aurora ${LATEST_VERSION} 已发布。`,
      },
    });
  });
}
