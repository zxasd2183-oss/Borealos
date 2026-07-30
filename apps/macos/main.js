const { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, net, Notification } = require('electron');
const path = require('path');

const APP_NAME = 'Borealos';
const APP_URL = 'https://borealos.dev';
const LOCAL_URL = 'https://192.168.31.73:18790';   // 局域网直连网关（同WiFi下秒级），失败自动回退公网
const CURRENT_VER = '5.1.2';          // 客户端版本（在线更新以此为基线）
app.setName(APP_NAME);

// 小窗登录（游戏启动器式）→ 登录成功自动展开为大窗
const LOGIN_W = 480, LOGIN_H = 680, MAIN_W = 1440, MAIN_H = 900;
const POP_W = 340, POP_H = 560;
let win = null, expanded = false, watcher = null;
let tray = null, pop = null;

// ---- 后台状态引擎（不依赖主窗口：窗口关了胶囊照样活）----
let authCookie = null;          // 从主窗口会话捕获的登录 cookie
let lastOnline = null;          // 上一次在线状态（变化时发通知）
let lastData = { ok: false };   // 最近一次状态快照
let taskStates = {};            // 任务 id -> status（检测完成/失败跳变）
let firstPoll = true;
let quotaCache = null, quotaFetchedAt = 0;   // 订阅限额（慢接口，5 分钟缓存）

function createWindow() {
  expanded = false;
  win = new BrowserWindow({
    width: LOGIN_W, height: LOGIN_H,
    resizable: false, maximizable: false, fullscreenable: false,
    title: APP_NAME, autoHideMenuBar: true,
    backgroundColor: '#f5f5f7', show: false
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(APP_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // 捕获登录 cookie（登录/退出都会触发 changed）
  const ses = win.webContents.session;
  const grab = async () => {
    try {
      const cs = await ses.cookies.get({ url: APP_URL, name: 'nexa_auth' });
      authCookie = cs.length ? 'nexa_auth=' + cs[0].value : null;
    } catch (e) {}
  };
  ses.cookies.on('changed', grab);
  grab();
  win.on('closed', () => { win = null; });
  // 轮询登录遮罩：消失（登录成功）即展开大窗
  // 注意：元素不存在 ≠ 已登录（首屏未加载完），必须确认应用已加载（有灵动岛）才算
  watcher = setInterval(async () => {
    if (expanded || !win || win.isDestroyed()) return;
    try {
      const st = await win.webContents.executeJavaScript(
        "var l=document.getElementById('login-overlay');" +
        "if(l) getComputedStyle(l).display;" +
        "else (document.getElementById('island-pill') ? 'none' : 'loading')");
      if (st === 'none') expandToMain();
    } catch (e) {}
  }, 700);
}

function expandToMain() {
  if (expanded || !win || win.isDestroyed()) return;
  expanded = true;
  clearInterval(watcher);
  win.setResizable(true);
  win.setMinimumSize(900, 600);
  win.setSize(MAIN_W, MAIN_H, true);   // macOS 动画放大
  win.center();
}

function showMain() {
  if (!win || win.isDestroyed()) createWindow();
  else { win.show(); win.focus(); }
}

function taskTitle(t) {
  let s = String(t.text || t.title || t.id || '').replace(/\s+/g, ' ').trim();
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch (e) {}
}

// ---- 在线更新引擎（Mac 版：源码热替换 .app 内 Resources/app，bash 脚本完成）----
let pendingVer = null, updateReady = false, updating = false;

function fetchJson(url, allowInsecure, timeoutMs) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.get(url, { rejectUnauthorized: !allowInsecure, timeout: timeoutMs || 8000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchJson(require('url').resolve(url, res.headers.location), allowInsecure, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// 局域网优先、公网兜底
async function fetchLatest() {
  try { return await fetchJson(LOCAL_URL + '/api/client-latest', true, 4000); }
  catch (e) { return await fetchJson(APP_URL + '/api/client-latest', false, 10000); }
}

function downloadFile(url, allowInsecure) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.get(url, { rejectUnauthorized: !allowInsecure, timeout: 60000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(require('url').resolve(url, res.headers.location), allowInsecure).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function updateZipPath() { return path.join(app.getPath('userData'), 'borealos-mac-update.zip'); }

async function checkUpdate(manual) {
  if (updating) return;
  updating = true;
  try {
    const j = await fetchLatest();
    const mac = j.platforms && j.platforms.mac;
    if (!mac || !mac.version || mac.version === CURRENT_VER) {
      if (manual) notify(APP_NAME, '已是最新版本 v' + CURRENT_VER);
      return;
    }
    pendingVer = mac.version;
    const local = mac.url.startsWith('http') ? mac.url : null;
    // 下载与 fetchLatest 同链路：先局域网再公网
    let buf = null;
    try { buf = await downloadFile(local || (LOCAL_URL + mac.url), true); }
    catch (e) { buf = await downloadFile(local || (APP_URL + mac.url), false); }
    if (mac.sha256) {
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      if (sha !== mac.sha256) throw new Error('更新包校验不一致，已取消更新');
    }
    require('fs').writeFileSync(updateZipPath(), buf);
    updateReady = true;
    notify(APP_NAME, 'v' + pendingVer + ' 已下载完成，右键菜单栏图标选「安装更新并重启」立即生效');
    if (manual) applyUpdate();
  } catch (e) {
    if (manual) notify(APP_NAME, '检查更新失败：' + e.message);
  } finally {
    updating = false;
  }
}

function applyUpdate() {
  if (!updateReady || !require('fs').existsSync(updateZipPath())) return;
  try {
    const fs = require('fs');
    // exe 路径 → .app 包根：Borealos.app/Contents/MacOS/Electron
    const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
    const resApp = path.join(bundle, 'Contents', 'Resources', 'app');
    const sh = path.join(app.getPath('userData'), 'borealos-mac-update.sh');
    const pid = process.pid;
    const files = ['main.js', 'popup-preload.js', 'popup.html', 'tray-icon.png', 'tray-icon-off.png', 'tray-icon-busy.png'];
    const script = [
      '#!/bin/bash',
      'while kill -0 ' + pid + ' 2>/dev/null; do sleep 1; done',
      'sleep 1',
      'TMP=$(mktemp -d)',
      '/usr/bin/ditto -x -k "' + updateZipPath() + '" "$TMP"',
      'SRC="$TMP/borealos-mac"',
      files.map(f => '[ -f "$SRC/' + f + '" ] && cp "$SRC/' + f + '" "' + resApp + '/' + f + '"').join('\n'),
      'touch "' + bundle + '"',
      'rm -rf "$TMP" "' + updateZipPath() + '"',
      'open "' + bundle + '"',
      'rm -f "' + sh + '"',
      ''
    ].join('\n');
    fs.writeFileSync(sh, script, { mode: 0o755 });
    require('child_process').spawn('/bin/bash', [sh], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  } catch (e) {
    notify(APP_NAME, '自动更新失败：' + e.message + '，可到官网手动下载');
  }
}

// 主进程直连网关取数（带登录 cookie，窗口关了也能取）
async function pollStatus() {
  let data = { ok: false };
  try {
    const headers = authCookie ? { Cookie: authCookie } : {};
    const hr = await net.fetch(APP_URL + '/api/gateway/health', { headers });
    const health = hr.ok ? await hr.json() : null;
    let usage = null, tasks = [];
    if (authCookie) {
      const [ur, tr] = await Promise.all([
        net.fetch(APP_URL + '/api/usage', { headers }).catch(() => null),
        net.fetch(APP_URL + '/api/eng/tasks', { headers }).catch(() => null),
      ]);
      if (ur && ur.ok) usage = await ur.json().catch(() => null);
      if (tr && tr.ok) {
        const tj = await tr.json().catch(() => null);
        if (tj && Array.isArray(tj.tasks)) tasks = tj.tasks;
      }
      // 订阅限额：慢接口，5 分钟才刷一次，其余时间用缓存
      if (Date.now() - quotaFetchedAt > 300000) {
        quotaFetchedAt = Date.now();
        net.fetch(APP_URL + '/api/quota', { headers })
          .then(r => r.ok ? r.json() : null)
          .then(q => { if (q) quotaCache = q; })
          .catch(() => {});
      }
    }
    // 任务完成/失败跳变检测（首轮静默建基线）
    const list = tasks.map(t => ({ id: t.id, title: taskTitle(t), status: t.status || 'pending' }));
    for (const t of list) {
      const prev = taskStates[t.id];
      if (!firstPoll && prev && prev !== t.status) {
        if (t.status === 'done') notify(APP_NAME, '任务完成：' + t.title);
        else if (t.status === 'failed') notify(APP_NAME, '任务失败：' + t.title);
      }
      taskStates[t.id] = t.status;
    }
    firstPoll = false;
    const busy = list.filter(t => t.status === 'running' || t.status === 'pending').length;
    data = { ok: true, online: !!(health && health.ok !== false), authed: !!authCookie, health, usage, quota: quotaCache, tasks: list, busy, at: Date.now() };
  } catch (e) {
    data = { ok: false, authed: !!authCookie, tasks: [], busy: 0, at: Date.now() };
  }
  lastData = data;
  const online = data.ok && data.online;
  if (lastOnline !== null && online !== lastOnline) {
    notify(APP_NAME, online ? '网关已恢复连接' : '网关连接断开，胶囊保持待命');
  }
  lastOnline = online;
  updateTray(online, data.busy || 0);
  if (pop && !pop.isDestroyed() && pop.isVisible()) pop.webContents.send('bar-status', data);
}

function updateTray(online, busy) {
  if (!tray) return;
  let f = 'tray-icon.png';
  if (!online) f = 'tray-icon-off.png';
  else if (busy > 0) f = 'tray-icon-busy.png';
  const img = nativeImage.createFromPath(path.join(__dirname, f));
  img.setTemplateImage(true);
  tray.setImage(img);
  tray.setToolTip(APP_NAME + (online ? (busy > 0 ? ' · ' + busy + ' 个任务进行中' : ' · 在线') : ' · 离线'));
}

// ---- 菜单栏胶囊 ----
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  img.setTemplateImage(true);  // 跟随系统深浅菜单栏自动反色
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  tray.on('click', togglePop);
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: showMain },
      { label: '打开官网', click: () => shell.openExternal(APP_URL) },
      { type: 'separator' },
      { label: '版本 v' + CURRENT_VER + (pendingVer && !updateReady ? '（下载中…）' : ''), enabled: false },
      { label: updateReady ? '安装更新 v' + pendingVer + ' 并重启' : '检查更新', click: () => updateReady ? applyUpdate() : checkUpdate(true) },
      { type: 'separator' },
      { label: '退出 ' + APP_NAME, click: () => app.quit() },
    ]));
  });
}

function togglePop() {
  if (pop && !pop.isDestroyed() && pop.isVisible()) { pop.hide(); return; }
  showPop();
}

function showPop() {
  const firstCreate = !pop || pop.isDestroyed();
  if (firstCreate) createPop();
  const b = tray.getBounds();
  pop.setPosition(Math.round(b.x + b.width / 2 - POP_W / 2), Math.round(b.y + b.height + 8), false);
  pop.show();
  if (!firstCreate) pop.webContents.send('bar-status', lastData);   // 已加载过才直接发，新建走 did-finish-load
  pollStatus();                                    // 再立刻刷新
}

function createPop() {
  pop = new BrowserWindow({
    width: POP_W, height: POP_H,
    frame: false, transparent: true, resizable: false, movable: false,
    show: false, alwaysOnTop: true, skipTaskbar: true,
    vibrancy: 'popover', visualEffectState: 'active',   // 原生毛玻璃
    webPreferences: {
      preload: path.join(__dirname, 'popup-preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  pop.loadFile(path.join(__dirname, 'popup.html'));
  pop.webContents.once('did-finish-load', () => {
    if (pop && !pop.isDestroyed()) pop.webContents.send('bar-status', lastData); // 加载完先给快照
  });
  pop.on('blur', () => { if (pop && !pop.isDestroyed()) pop.hide(); });
}

ipcMain.on('bar-action', (e, a) => {
  if (a === 'show-main') showMain();
  else if (a === 'open-site') shell.openExternal(APP_URL);
  else if (a === 'quit') app.quit();
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  pollStatus();
  setInterval(pollStatus, 15000);   // 常驻后台轮询，与窗口无关
  checkUpdate(false);                        // 启动即检查更新
  setInterval(() => checkUpdate(false), 6 * 3600 * 1000);   // 每 6 小时复查
});
// macOS 原生习惯：关窗不退应用，留在菜单栏胶囊里
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
