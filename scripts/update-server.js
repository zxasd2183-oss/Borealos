/**
 * Aurora — 轻量级更新服务器
 * ============================================================
 * 为 Tauri 自动更新提供 manifest JSON 和安装包下载
 *
 * 端点:
 *   GET  /api/update/check/:target/:arch/:current_version
 *        → 返回更新清单 JSON (有更新) 或 204 (无更新)
 *   GET  /download/:platform/:filename
 *        → 下载安装包
 *   GET  /health
 *        → 健康检查
 *   GET  /admin
 *        → 简单管理页面 (查看/编辑 manifest)
 *
 * 用法:
 *   node update-server.js                 # 默认端口 3001
 *   PORT=4000 node update-server.js       # 自定义端口
 *
 * 数据目录: ./updates/
 *   - manifest.json   — 更新清单
 *   - releases/       — 安装包文件
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3005;
const DATA_DIR = path.join(__dirname, 'updates');
const RELEASES_DIR = path.join(DATA_DIR, 'releases');
const MANIFEST_FILE = path.join(DATA_DIR, 'manifest.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(RELEASES_DIR)) fs.mkdirSync(RELEASES_DIR, { recursive: true });

// 默认 manifest
const DEFAULT_MANIFEST = {
  version: '0.2.0',
  notes: 'Aurora 初始版本',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: '',
      url: '',
    },
    'darwin-x86_64': {
      signature: '',
      url: '',
    },
    'darwin-aarch64': {
      signature: '',
      url: '',
    },
    'linux-x86_64': {
      signature: '',
      url: '',
    },
  },
};

// 加载 manifest
function loadManifest() {
  try {
    if (fs.existsSync(MANIFEST_FILE)) {
      return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[ERROR] 加载 manifest 失败:', e.message);
  }
  saveManifest(DEFAULT_MANIFEST);
  return DEFAULT_MANIFEST;
}

// 保存 manifest
function saveManifest(data) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(data, null, 2));
}

// 比较版本号
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

// MIME 类型
function getMimeType(ext) {
  const types = {
    '.json': 'application/json',
    '.html': 'text/html; charset=utf-8',
    '.exe': 'application/octet-stream',
    '.msi': 'application/octet-stream',
    '.dmg': 'application/octet-stream',
    '.app': 'application/octet-stream',
    '.deb': 'application/octet-stream',
    '.AppImage': 'application/octet-stream',
    '.sig': 'text/plain',
  };
  return types[ext] || 'application/octet-stream';
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- 健康检查 ----
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'aurora-update-server', port: PORT }));
    return;
  }

  // ---- 更新检查 ----
  // /api/update/check/:target/:arch/:current_version
  const checkMatch = pathname.match(/^\/api\/update\/check\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (checkMatch && req.method === 'GET') {
    const [, target, arch, currentVersion] = checkMatch;
    const manifest = loadManifest();
    const platformKey = `${target}-${arch}`;

    console.log(`[CHECK] target=${target} arch=${arch} current=${currentVersion}`);

    // 比较版本
    if (compareVersions(manifest.version, currentVersion) <= 0) {
      // 无更新
      res.writeHead(204);
      res.end();
      return;
    }

    // 有更新
    const platformData = manifest.platforms[platformKey];
    if (!platformData || !platformData.url) {
      // 该平台没有更新包
      res.writeHead(204);
      res.end();
      return;
    }

    const response = {
      version: manifest.version,
      notes: manifest.notes,
      pub_date: manifest.pub_date,
      url: platformData.url,
      signature: platformData.signature,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    console.log(`[UPDATE] 有新版本 ${manifest.version} (当前 ${currentVersion})`);
    return;
  }

  // ---- 下载安装包 ----
  // /download/:platform/:filename
  const dlMatch = pathname.match(/^\/download\/([^/]+)\/(.+)$/);
  if (dlMatch && req.method === 'GET') {
    const [, platform, filename] = dlMatch;
    const safeFilename = path.basename(filename); // 防止路径穿越
    const filePath = path.join(RELEASES_DIR, platform, safeFilename);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found', path: `${platform}/${safeFilename}` }));
      return;
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(safeFilename);

    res.writeHead(200, {
      'Content-Type': getMimeType(ext),
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    console.log(`[DOWNLOAD] ${platform}/${safeFilename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }

  // ---- 管理页面 ----
  if (pathname === '/admin' && req.method === 'GET') {
    const manifest = loadManifest();
    const html = generateAdminPage(manifest);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ---- 更新 manifest (POST) ----
  if (pathname === '/admin/manifest' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        saveManifest(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'Manifest updated' }));
        console.log('[ADMIN] Manifest 已更新');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ---- 列出 releases 目录 ----
  if (pathname === '/admin/releases' && req.method === 'GET') {
    const releases = {};
    if (fs.existsSync(RELEASES_DIR)) {
      for (const platform of fs.readdirSync(RELEASES_DIR)) {
        const platformDir = path.join(RELEASES_DIR, platform);
        if (fs.statSync(platformDir).isDirectory()) {
          releases[platform] = fs.readdirSync(platformDir).map((f) => {
            const stat = fs.statSync(path.join(platformDir, f));
            return { name: f, size: stat.size, mtime: stat.mtime };
          });
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(releases, null, 2));
    return;
  }

  // ---- 404 ----
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
});

function generateAdminPage(manifest) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aurora Update Server — Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  h1 { color: #00d4ff; margin-bottom: 20px; }
  h2 { color: #00d4ff; margin: 20px 0 10px; font-size: 18px; }
  .card { background: #16213e; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #0f3460; }
  label { display: block; margin: 10px 0 4px; color: #a0a0b0; font-size: 13px; }
  input, textarea { width: 100%; padding: 8px 12px; background: #0d1b2a; border: 1px solid #0f3460; border-radius: 6px; color: #e0e0e0; font-size: 14px; font-family: monospace; }
  textarea { min-height: 80px; resize: vertical; }
  button { background: #00d4ff; color: #0d1b2a; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 16px; }
  button:hover { background: #00b4d4; }
  .platform { background: #0d1b2a; border-radius: 8px; padding: 12px; margin: 8px 0; }
  .platform-name { color: #00d4ff; font-weight: 600; margin-bottom: 6px; }
  .status { padding: 8px 16px; border-radius: 6px; margin-top: 12px; display: none; }
  .status.ok { background: #0f3460; color: #00ff88; display: block; }
  .status.err { background: #5c1a1a; color: #ff6b6b; display: block; }
  pre { background: #0d1b2a; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
</style>
</head>
<body>
  <h1>Aurora Update Server</h1>
  <div class="card">
    <h2>更新清单</h2>
    <label>版本号</label>
    <input type="text" id="version" value="${manifest.version}" />
    <label>更新说明</label>
    <textarea id="notes">${manifest.notes}</textarea>
    <label>发布日期</label>
    <input type="text" id="pub_date" value="${manifest.pub_date}" />
    <div id="platforms"></div>
    <button onclick="saveManifest()">保存</button>
    <div id="status" class="status"></div>
  </div>
  <div class="card">
    <h2>已上传的安装包</h2>
    <pre id="releases">加载中...</pre>
  </div>
  <script>
    const manifest = ${JSON.stringify(manifest)};
    const platformsDiv = document.getElementById('platforms');
    Object.entries(manifest.platforms).forEach(([key, val]) => {
      const div = document.createElement('div');
      div.className = 'platform';
      div.innerHTML = '<div class="platform-name">' + key + '</div>' +
        '<label>下载 URL</label><input type="text" id="url_' + key + '" value="' + (val.url || '') + '" />' +
        '<label>签名</label><input type="text" id="sig_' + key + '" value="' + (val.signature || '') + '" />';
      platformsDiv.appendChild(div);
    });
    async function saveManifest() {
      const data = { version: document.getElementById('version').value, notes: document.getElementById('notes').value, pub_date: document.getElementById('pub_date').value, platforms: {} };
      Object.keys(manifest.platforms).forEach(key => {
        data.platforms[key] = { url: document.getElementById('url_' + key).value, signature: document.getElementById('sig_' + key).value };
      });
      try {
        const res = await fetch('/admin/manifest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await res.json();
        const s = document.getElementById('status');
        s.className = 'status ok'; s.textContent = '✓ ' + result.message;
      } catch (e) {
        const s = document.getElementById('status');
        s.className = 'status err'; s.textContent = '✗ ' + e.message;
      }
    }
    fetch('/admin/releases').then(r => r.json()).then(d => { document.getElementById('releases').textContent = JSON.stringify(d, null, 2); });
  </script>
</body>
</html>`;
}

// 启动
server.listen(PORT, () => {
  console.log('');
  console.log('  ========================================');
  console.log('    Aurora Update Server');
  console.log('  ========================================');
  console.log('');
  console.log(`  端口:     ${PORT}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log(`  清单文件: ${MANIFEST_FILE}`);
  console.log('');
  console.log('  端点:');
  console.log(`    检查更新: http://localhost:${PORT}/api/update/check/:target/:arch/:current_version`);
  console.log(`    下载:     http://localhost:${PORT}/download/:platform/:filename`);
  console.log(`    管理页面: http://localhost:${PORT}/admin`);
  console.log(`    健康检查: http://localhost:${PORT}/health`);
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
