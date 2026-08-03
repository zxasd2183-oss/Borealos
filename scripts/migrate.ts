/**
 * BorealOS 数据库迁移脚本
 *
 * 读取环境变量连接 PostgreSQL，按顺序执行 MIGRATIONS 中的建表 SQL。
 *
 * 用法：
 *   npx tsx scripts/migrate.ts
 *
 * 环境变量（从 .env 读取）：
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

import { Pool } from 'pg';
import { MIGRATIONS } from '../packages/database/src/migrations';

async function main() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'borealos',
    user: process.env.DB_USER || 'borealos',
    password: process.env.DB_PASSWORD || '',
  };

  console.log(`[migrate] 连接 PostgreSQL ${config.host}:${config.port}/${config.database} ...`);

  const pool = new Pool(config);
  const client = await pool.connect();

  try {
    // 创建迁移记录表
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(10) PRIMARY KEY,
        description TEXT,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 查询已执行的迁移
    const { rows: executed } = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    const executedVersions = new Set(executed.map((r) => r.version));

    let applied = 0;
    for (const migration of MIGRATIONS) {
      if (executedVersions.has(migration.version)) {
        console.log(`[migrate] 跳过 ${migration.version}: ${migration.description}（已执行）`);
        continue;
      }

      console.log(`[migrate] 执行 ${migration.version}: ${migration.description} ...`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, description) VALUES ($1, $2)',
          [migration.version, migration.description],
        );
        await client.query('COMMIT');
        console.log(`[migrate] ✓ ${migration.version} 完成`);
        applied++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log(`[migrate] 迁移完成，本次执行 ${applied} 个，共 ${MIGRATIONS.length} 个`);

    // 验证表列表
    const { rows: tables } = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);
    console.log('[migrate] 当前表：', tables.map((t) => t.tablename).join(', '));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] 迁移失败：', err);
  process.exit(1);
});
