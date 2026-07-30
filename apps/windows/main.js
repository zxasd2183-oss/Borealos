const { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain, net, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { createTrustedOriginCheck } = require('./trusted-origin');

const APP_NAME = 'Borealos';
const APP_URL = 'https://borealos.dev';
const isTrustedBorealosUrl = createTrustedOriginCheck(
  process.env.BOREALOS_TRUSTED_ORIGINS || 'https://borealos.dev,http://127.0.0.1:18790,http://localhost:18790'
);
const CURRENT_VER = '5.1.8';          // 客户端版本（在线更新以此为基线）
app.setName(APP_NAME);
// Windows 通知归属（通知中心按此 ID 归组）
app.setAppUserModelId('dev.borealos.app');
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isTrustedBorealosUrl(url)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

// 单实例锁：第二个实例直接退出，聚焦已有主窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
}

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
    backgroundColor: '#f5f5f7', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'feedback-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(APP_URL);
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedBorealosUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedBorealosUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedBorealosUrl(url)) shell.openExternal(url);
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

ipcMain.handle("feedback:capture-current-window", async (event) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !isTrustedBorealosUrl(event.senderFrame.url) || !win.isVisible() || win.isMinimized()) {
    throw new Error("Current window is not available for capture.");
  }
  const bytes = (await win.webContents.capturePage()).toPNG();
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("Capture size is invalid.");
  return { mime: "image/png", size: bytes.length, data: bytes.toString("base64") };
});

function expandToMain() {
  if (expanded || !win || win.isDestroyed()) return;
  expanded = true;
  clearInterval(watcher);
  win.setResizable(true);
  win.setMinimumSize(900, 600);
  win.setSize(MAIN_W, MAIN_H);
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
  tray.setImage(img);
  tray.setToolTip(APP_NAME + ' v' + CURRENT_VER + (online ? (busy > 0 ? ' · ' + busy + ' 个任务进行中' : ' · 在线') : ' · 离线'));
}

// ---- 在线更新（免手动下载：检查 → 后台下载 → 校验 → 替换重启）----
let updateReady = false, pendingVer = null, updating = false;

function verNewer(a, b) {   // a 比 b 新？
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// 本机优先：网关本机直连本地服务（自签证书放行），走不通再回退公网隧道
function fetchJson(url, allowSelfSigned) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, allowSelfSigned ? { rejectUnauthorized: false } : {}, (res) => {
      if (res.statusCode >= 400) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.setTimeout(6000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function downloadFile(url, allowSelfSigned) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, allowSelfSigned ? { rejectUnauthorized: false } : {}, (res) => {
      if (res.statusCode >= 400) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(300000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const LOCAL_URL = 'https://127.0.0.1:18790';

async function checkUpdate(manual) {
  if (updating) return;
  updating = true;
  try {
    // 本机直连优先（网关本机更新秒级），失败回退公网
    let info = null, base = LOCAL_URL, selfSigned = true;
    try { info = await fetchJson(LOCAL_URL + '/api/client-latest', true); }
    catch (e) { base = APP_URL; selfSigned = false; info = await fetchJson(APP_URL + '/api/client-latest', false); }
    const winInfo = info && info.platforms && info.platforms.win;
    if (!winInfo || !winInfo.url) throw new Error('无 Windows 更新信息');
    if (!verNewer(winInfo.version, CURRENT_VER)) {
      if (manual) notify(APP_NAME, '已是最新版本 v' + CURRENT_VER);
      return;
    }
    pendingVer = winInfo.version;
    notify(APP_NAME, '发现新版本 v' + pendingVer + '，正在后台下载…');
    // 后台下载完整安装包（本机直连秒级，公网隧道较慢）
    const buf = await downloadFile(base + winInfo.url.split('?')[0] + '?v=' + winInfo.version, selfSigned);
    // 完整性校验
    if (winInfo.sha256) {
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      if (sha !== winInfo.sha256) throw new Error('安装包校验不一致，已取消更新');
    }
    fs.writeFileSync(updateTmpPath(), buf);
    updateReady = true;
    refreshTrayMenu();
    notify(APP_NAME, 'v' + pendingVer + ' 已下载完成，点托盘菜单「安装更新并重启」立即生效');
    if (manual) applyUpdate();   // 手动点的检查更新，下完直接装
  } catch (e) {
    if (manual) notify(APP_NAME, '检查更新失败：' + e.message);
  } finally {
    updating = false;
  }
}

function updateTmpPath() {
  return path.join(app.getPath('userData'), 'borealos-update.exe');
}

function applyUpdate() {
  if (!updateReady || !fs.existsSync(updateTmpPath())) return;
  try {
    const cur = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;  // 便携版要覆盖启动器本体，否则更新只落到临时解包目录
    const bat = path.join(app.getPath('userData'), 'borealos-update.bat');
    const pid = process.pid;
    const script = [
      '@echo off',
      ':wait',
      'tasklist /FI "PID eq ' + pid + '" | find "' + pid + '" >nul',
      'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)',
      'timeout /t 2 /nobreak >nul',
      ':retry',
      'move /y "' + updateTmpPath() + '" "' + cur + '" >nul 2>&1',
      'if errorlevel 1 (timeout /t 1 /nobreak >nul & goto retry)',
      'start "" "' + cur + '"',
      'del "%~f0"',
    ].join('\r\n');
    fs.writeFileSync(bat, script);
    require('child_process').spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    app.quit();
  } catch (e) {
    notify(APP_NAME, '自动更新失败：' + e.message + '，可到官网手动下载');
  }
}

// ---- Windows 托盘 + 屏幕顶部居中悬浮胶囊 ----
function buildTrayMenu() {
  // Electron 的 Tray 没有 getContextMenu API，标签要变只能整体重建
  const visible = pop && !pop.isDestroyed() && pop.isVisible();
  return Menu.buildFromTemplate([
    { label: '打开主窗口', click: showMain },
    { label: visible ? '隐藏悬浮胶囊' : '显示悬浮胶囊', click: togglePop },
    { label: '打开官网', click: () => shell.openExternal(APP_URL) },
    { type: 'separator' },
    { label: '版本 v' + CURRENT_VER + (pendingVer && !updateReady ? '（下载中…）' : ''), enabled: false },
    { label: updateReady ? '安装更新 v' + pendingVer + ' 并重启' : '检查更新', click: () => updateReady ? applyUpdate() : checkUpdate(true) },
    { type: 'separator' },
    { label: '退出 ' + APP_NAME, click: () => app.quit() },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  tray = new Tray(img);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', togglePop);          // 左键：切换胶囊显隐
  tray.on('double-click', showMain);    // 双击：主窗口
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

function togglePop() {
  if (pop && !pop.isDestroyed() && pop.isVisible()) { pop.hide(); refreshTrayMenu(); return; }
  showPop();
}

function positionPop() {
  // 主屏幕工作区顶部居中
  const wa = screen.getPrimaryDisplay().workArea;
  pop.setPosition(Math.round(wa.x + wa.width / 2 - POP_W / 2), Math.round(wa.y + 12), false);
}

function showPop() {
  const firstCreate = !pop || pop.isDestroyed();
  if (firstCreate) createPop();
  positionPop();
  pop.show();
  refreshTrayMenu();
  if (!firstCreate) pop.webContents.send('bar-status', lastData);   // 已加载过才直接发，新建走 did-finish-load
  pollStatus();                                    // 再立刻刷新
}

function createPop() {
  pop = new BrowserWindow({
    width: POP_W, height: POP_H,
    frame: false, transparent: true, resizable: false,
    show: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'popup-preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  pop.setMenu(null);
  pop.loadFile(path.join(__dirname, 'popup.html'));
  pop.webContents.once('did-finish-load', () => {
    if (pop && !pop.isDestroyed()) pop.webContents.send('bar-status', lastData); // 加载完先给快照
  });
  pop.on('closed', () => { pop = null; refreshTrayMenu(); });
  pop.on('hide', refreshTrayMenu);
  pop.on('show', refreshTrayMenu);
}

ipcMain.on('bar-action', (e, a) => {
  if (a === 'show-main') showMain();
  else if (a === 'open-site') shell.openExternal(APP_URL);
  else if (a === 'quit') app.quit();
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  showPop();          // 启动即显示悬浮胶囊
  pollStatus();
  setInterval(pollStatus, 15000);   // 常驻后台轮询，与窗口无关
  checkUpdate(false);               // 启动静默检查更新
  setInterval(() => checkUpdate(false), 6 * 3600 * 1000);   // 每 6 小时复查
});
// Windows：关窗不退应用，留在托盘+悬浮胶囊里；只能从托盘/胶囊菜单退出
app.on('window-all-closed', () => { /* 保持驻留 */ });
app.on('before-quit', () => { if (pop && !pop.isDestroyed()) pop.destroy(); });
