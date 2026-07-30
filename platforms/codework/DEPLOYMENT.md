# CodeWork 2.0 — 部署指南

> 本文档涵盖 CodeWork 2.0 的环境要求、安装配置、运行验证和日常维护。

---

## 目录

1. [环境要求](#环境要求)
2. [安装步骤](#安装步骤)
3. [项目配置](#项目配置)
4. [HTTPS 与 TLS 证书](#https-与-tls-证书)
5. [运行与验证](#运行与验证)
6. [日志管理](#日志管理)
7. [交付物管理](#交付物管理)
8. [常见问题](#常见问题)
9. [目录结构说明](#目录结构说明)

---

## 环境要求

### 必须

| 软件 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Node.js | 18.0.0 | 20.x LTS | 运行时环境 |
| npm | 8.0.0 | 10.x | 依赖管理（仅开发依赖） |

### 可选（开发/CI 环境）

| 软件 | 版本 | 用途 |
|------|------|------|
| Git | 任意 | 版本控制 |
| VS Code | 1.80+ | 编辑器（含 .editorconfig 支持） |

### 操作系统

- Windows 10/11 ✅
- macOS 12+ ✅
- Ubuntu 20.04+ / Debian 11+ ✅

### 磁盘空间

| 目录 | 估计占用 | 说明 |
|------|---------|------|
| 项目核心文件 | ~100 KB | `core/` + 文档 |
| `node_modules/` | ~15 MB | 开发依赖（ESLint） |
| `.codework/logs/` | 随项目增长 | 运行日志，可定期清理 |
| `deliverables/` | 随项目增长 | 打包交付物 |

---

## 安装步骤

### 步骤 1：获取项目

```bash
# 方式 A：从 Git 克隆
git clone <repo-url> "CodeWork 2.0"
cd "CodeWork 2.0"

# 方式 B：解压压缩包
unzip codework-2.0.zip
cd "CodeWork 2.0"
```

### 步骤 2：检查 Node.js 版本

```bash
node --version   # 应输出 v18.x.x 或更高
npm --version    # 应输出 8.x.x 或更高
```

若版本过低，推荐使用 [nvm](https://github.com/nvm-sh/nvm)（Linux/macOS）或 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理 Node.js 版本：

```bash
nvm install 20
nvm use 20
```

### 步骤 3：安装依赖

```bash
# 仅安装开发依赖（运行时零依赖）
npm install
```

> ⚠️ **注意：** `node_modules/` 仅包含 ESLint 等开发工具。生产运行时无需任何第三方包。

### 步骤 4：初始化项目结构

```bash
npm run init
# 或
node core/init.js
```

输出示例：
```
🚀 初始化 CodeWork 2.0 项目...

  📁 目录已存在: core
  📁 目录已存在: stages
  📁 创建目录: templates
  📁 创建目录: deliverables
  📁 创建目录: tests
  📄 文件已存在: core/config.js
  📄 文件已存在: core/planner.js

✅ 项目初始化完成！
```

### 步骤 5：验证安装

```bash
# 查看系统状态
npm start

# 运行测试（期望 68+/73 通过）
npm test

# 代码检查（期望 0 warnings）
npm run lint
```

---

## 项目配置

### 配置文件位置

```
{projectRoot}/codework.config.json
```

### 完整配置项说明

```jsonc
{
  // 框架版本（不要手动修改）
  "version": "2.0.0",

  // 项目显示名称
  "name": "CodeWork Project",

  // 项目描述（可选）
  "description": "",

  // 阶段目录配置
  "stages": {
    "directory": "./stages",              // 相对 projectRoot 的路径
    "namingPattern": "stage-{number}"     // 阶段目录命名模式，{number} 为两位数补零
  },

  // 交付物配置
  "deliverables": {
    "directory": "./deliverables",        // 交付物输出根目录
    "autoCopy": true,                     // 保留字段（未来功能）
    "namingPattern": "{stageName}-{timestamp}"  // 包命名模式，{timestamp} 为 YYYYMMDD
  },

  // 模板配置
  "templates": {
    "directory": "./templates",
    "defaultTemplate": "web-app"
  },

  // 追踪与日志配置
  "tracking": {
    "enabled": true,
    "logLevel": "info",     // "debug" | "info" | "warn" | "error" | "silent"
    "saveHistory": true
  },

  // 工具白名单（供 Agent 使用）
  "tools": {
    "allowedTools": ["read", "write", "edit", "exec", "web_search"],
    "timeout": 30000         // 工具超时（毫秒）
  }
}
```

### 常用配置场景

#### 开发环境（详细日志）

```json
{
  "tracking": {
    "logLevel": "debug"
  }
}
```

#### 生产/CI 环境（减少输出）

```json
{
  "tracking": {
    "logLevel": "warn"
  }
}
```

#### 自定义交付物路径

```json
{
  "deliverables": {
    "directory": "D:/releases/my-project"
  }
}
```

#### 生产环境 HTTPS（Let's Encrypt）

```json
{
  "server": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 443,
    "https": true,
    "letsEncrypt": true,
    "letsEncryptEmail": "admin@your-domain.com",
    "letsEncryptDomains": ["your-domain.com", "www.your-domain.com"],
    "letsEncryptStaging": false,
    "autoCert": false,
    "redirectHttp": true
  }
}
```

### 使用 CLI 修改配置

```bash
# 设置日志级别
node core/config.js set tracking.logLevel debug

# 查看当前配置项
node core/config.js get stages.directory

# 验证配置完整性
node core/config.js validate

# 重新生成默认配置
node core/config.js init
```

---

#### 使用 Let's Encrypt 自动证书（推荐生产环境）

```json
{
  "server": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 18792,
    "https": true,
    "letsEncrypt": true,
    "letsEncryptEmail": "admin@your-domain.com",
    "letsEncryptDomains": ["codework2.your-domain.com"],
    "letsEncryptStaging": false,
    "autoCert": false,
    "redirectHttp": true
  }
}
```

**要求：**
- 域名必须已解析到服务器公网 IP
- 服务器 80 端口必须可从外部访问（ACME HTTP-01 挑战验证）
- 首次申请前需同意服务条款（`letsEncrypt` 设为 `true` 即表示同意）

**申请证书：**

```bash
# 使用 CLI 工具申请（推荐）
node core/server/letsencrypt-cli.js obtain \
  --email admin@your-domain.com \
  --domains codework2.your-domain.com \
  --agree

# 或使用环境变量
set CODEWORK_LE_EMAIL=admin@your-domain.com
set CODEWORK_LE_DOMAINS=codework2.your-domain.com
set CODEWORK_LE_AGREE=true
node core/server/letsencrypt-cli.js obtain
```

**检查证书状态：**

```bash
node core/server/letsencrypt-cli.js status --domains codework2.your-domain.com
```

**续期证书：**

```bash
# 仅在需要时续期（证书到期前 30 天内）
node core/server/letsencrypt-cli.js renew \
  --email admin@your-domain.com \
  --domains codework2.your-domain.com \
  --agree
```

**启动 ACME 挑战服务器（如需单独运行）：**

```bash
# 在申请证书前启动，确保 80 端口可响应挑战
node core/server/letsencrypt-cli.js serve-challenge --port 80
```

#### 使用现有证书文件

```json
{
  "server": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 18792,
    "https": true,
    "certPath": "/etc/letsencrypt/live/your-domain.com/fullchain.pem",
    "keyPath": "/etc/letsencrypt/live/your-domain.com/privkey.pem",
    "autoCert": false,
    "redirectHttp": true
  }
}
```

#### 开发环境自签名证书（仅本地测试）

```json
{
  "server": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 3000,
    "https": true,
    "autoCert": true,
    "redirectHttp": true
  }
}
```

> ⚠️ 自签名证书会触发浏览器安全警告，仅用于开发环境。

---

## 运行与验证

### 日常工作流

```bash
# 1. 查看当前计划进度
npm run plan

# 2. 执行待完成任务（需提供自定义 handler）
npm run run

# 3. 执行演习（不实际运行 handler）
node core/executor.js run --dry-run

# 4. 查看执行历史
node core/tracker.js history 5

# 5. 打包交付物
npm run deliver

# 6. 验证交付包
node core/deliver.js verify ./deliverables/stage-01-release-20260722
```

### 单阶段执行

```bash
# 仅执行第2阶段的任务
node core/executor.js run --stage=2

# 演习模式执行第1阶段
node core/executor.js run --stage=1 --dry-run
```

### 程序化使用（集成到 Agent）

```javascript
'use strict';

const { PlanManager, Executor, Tracker, Deliverables } = require('./core');

async function runStage(projectRoot, stageIndex) {
    const planner  = new PlanManager(projectRoot);
    const executor = new Executor(projectRoot, { maxRetries: 2 });
    const tracker  = new Tracker(projectRoot);
    const deliver  = new Deliverables(projectRoot);

    // 自动追踪
    tracker.attachTo(executor);

    // 加载任务
    const plan = planner.readPlan();
    const count = executor.loadFromPlan(plan, { stageIndex });
    console.log(`加载 ${count} 个任务`);

    // 执行
    const stats = await executor.run(async (task) => {
        // 在此实现实际工作逻辑
        console.log(`执行: ${task.text}`);
    });

    console.log(`完成: 成功 ${stats.succeeded} / 失败 ${stats.failed}`);

    // 打包交付物
    const result = deliver.package(
        ['README.md', 'core/index.js'],
        `stage-0${stageIndex + 1}`
    );
    console.log(`交付物: ${result.outputDir}`);

    return stats;
}

runStage(process.cwd(), 0).catch(console.error);
```

---

## 健康巡检

CodeWork 2.0 内置健康巡检系统，定时检查各服务端口、TLS 证书、WebSocket 链路、配置一致性及磁盘空间，异常自动修复或告警。

### 快速使用

```bash
# 执行一次巡检
npm run health

# 执行巡检并尝试自动修复
npm run health:repair

# 查看最近一次巡检报告
npm run health:report

# 启动定时巡检调度器（前台运行，每 5 分钟）
npm run health:schedule

# 立即执行一次定时巡检
npm run health:once

# 查看巡检调度器状态
npm run health:status
```

### 巡检内容

| 检查项 | 说明 | 自动修复 |
|--------|------|----------|
| 端口连通性 | TCP 探测各服务端口 | ❌ |
| TLS 证书 | 有效期检查，过期预警 | ✅ 自签名证书自动重生成 |
| WebSocket 链路 | 升级握手探测 | ❌ |
| 配置一致性 | gateway.url 协议匹配、假 token、来源白名单、frp 收敛 | ✅ gateway.url ws→wss |
| 磁盘空间 | 剩余空间检查 | ❌ |

### 配置项（codework.config.json）

```json
{
  "healthInspector": {
    "enabled": true,
    "intervalMinutes": 5,
    "portCheckTimeoutMs": 3000,
    "wsCheckTimeoutMs": 5000,
    "certWarningDays": 30,
    "autoRepair": false,
    "services": [],
    "alertWebhook": "",
    "reportDir": "./.codework/health-reports",
    "maxReportHistory": 50
  }
}
```

### 告警渠道

- **日志**：`.codework/logs/health-inspector.log`
- **Webhook**：配置 `healthInspector.alertWebhook`
- **Notifier 推送**：复用 `notifications` 配置（console / webhook / file）
- **OpenClaw Cron**：已注册定时任务 `codework-health-check`，每 5 分钟自动执行

---

## 日志管理

### 日志位置

```
.codework/logs/
├── executor.log    # Executor 模块日志（JSON Lines）
├── tracker.log     # Tracker 模块日志（JSON Lines）
└── deliver.log     # Deliverables 模块日志（JSON Lines）
```

### 日志格式

每行一个完整 JSON 对象（JSON Lines 格式）：

```json
{"timestamp":"2026-07-22T10:30:00.000Z","level":"INFO","module":"Executor:App","message":"任务完成","data":{"id":"s1-t1","durationMs":42,"retries":0}}
```

### 查看日志（Windows PowerShell）

```powershell
# 实时监控（类似 tail -f）
Get-Content ".codework\logs\executor.log" -Wait

# 查看最近 20 行
Get-Content ".codework\logs\executor.log" | Select-Object -Last 20

# 过滤错误
Get-Content ".codework\logs\executor.log" | Where-Object { $_ -match '"ERROR"' }
```

### 查看日志（Linux/macOS）

```bash
# 实时监控
tail -f .codework/logs/executor.log

# 格式化查看（需要 jq）
tail -f .codework/logs/executor.log | jq '.'

# 过滤 ERROR 级别
grep '"ERROR"' .codework/logs/executor.log | jq '.'
```

### 调整日志级别

在 `codework.config.json` 中修改：
```json
{
  "tracking": {
    "logLevel": "debug"
  }
}
```

或临时通过环境变量：
```bash
# Linux/macOS
DEBUG=* node core/executor.js run

# 控制台关闭颜色（CI 环境）
NO_COLOR=1 node core/executor.js run
```

### 日志清理

日志文件追加写入，需定期清理：

```bash
# 清空日志文件（保留文件）
echo "" > .codework/logs/executor.log
echo "" > .codework/logs/tracker.log

# 或删除后重建（下次运行自动重建）
rm .codework/logs/*.log
```

---

## 交付物管理

### 打包操作

```bash
# 打包默认文件集（见 deliver.js CLI 中的 defaultFiles）
npm run deliver

# 打包指定版本
node core/deliver.js package --stage=v1.0.0

# 列出所有历史包
node core/deliver.js list
```

### 验证完整性

```bash
# 验证指定交付包
node core/deliver.js verify ./deliverables/v1.0.0-20260722

# 输出示例：
# ✅ 验证通过
# 或
# ❌ 验证失败
#   空文件: config.js
#   校验和不匹配: executor.js
```

### MANIFEST.md 说明

每次打包在目标目录生成 `MANIFEST.md`：

```markdown
# 交付清单 - v1.0.0

生成时间: 2026/7/22 10:30:00

## 文件列表

| 文件名 | 大小 | SHA-256 | 状态 |
|--------|------|---------|------|
| README.md | 5432 B | a1b2c3d4... | ✅ 正常 |
| core/index.js | 1234 B | e5f6g7h8... | ✅ 正常 |

**统计:** 共 2 个文件，成功 2 个，失败 0 个
```

> SHA-256 用于验证交付包在传输或存储过程中未被篡改。

### 执行历史清理

```bash
# 查看历史
node core/tracker.js history

# 清空历史
node core/tracker.js clear
```

---

## 常见问题

### Q1：运行 `npm start` 报错 "PLAN.md 不存在"

**原因：** 项目根目录缺少 `PLAN.md`。

**解决：** 创建 `PLAN.md` 并按格式定义阶段和任务，或复制现有模板。

---

### Q2：ESLint 报 `'use strict'` 相关错误

**解决：**

```bash
# 检查当前 ESLint 配置
cat .eslintrc.json

# 强制修复
npx eslint core/ --ext .js --fix
```

---

### Q3：日志文件写入权限错误

**原因：** `.codework/logs/` 目录无写权限。

**解决（Linux/macOS）：**

```bash
chmod -R 755 .codework/
```

**解决（Windows）：** 以管理员身份运行终端，或检查文件夹属性中的权限设置。

---

### Q4：`node_modules/` 不存在导致 lint 报错

**解决：**

```bash
npm install
```

---

### Q5：测试中 Domain 的 2 个测试失败（拒绝无效实体）

这是已知的边界条件测试，属于阶段二计划中的增强项，**不影响正常使用**。

详见：`deliverables/domain-model-implementation-notes.md`

---

### Q6：`.codework/history.json` 文件损坏（JSON 解析失败）

**解决：** 删除损坏文件，Tracker 会自动重建：

```bash
# Windows
Remove-Item ".codework\history.json"

# Linux/macOS
rm .codework/history.json
```

---

### Q7：Windows 路径中的空格导致命令行问题

**解决：** 始终用引号包裹路径：

```powershell
Set-Location "D:\KIMI\work-users\admin\projects\CodeWork 2.0"
node core/index.js status
```

---

## 目录结构说明

### 核心目录

| 目录/文件 | 说明 | 是否需要版本控制 |
|-----------|------|----------------|
| `core/` | 框架核心模块 | ✅ 是 |
| `tests/` | 测试套件 | ✅ 是 |
| `stages/` | 阶段任务目录 | ✅ 是 |
| `templates/` | 项目模板 | ✅ 是 |
| `PLAN.md` | 项目计划 | ✅ 是 |
| `codework.config.json` | 配置文件 | ✅ 是（不含敏感信息） |
| `package.json` | npm 配置 | ✅ 是 |
| `.eslintrc.json` | ESLint 规则 | ✅ 是 |
| `.editorconfig` | 编辑器格式 | ✅ 是 |

### 运行时目录（通常排除版本控制）

| 目录/文件 | 说明 | .gitignore 建议 |
|-----------|------|----------------|
| `node_modules/` | npm 依赖 | ✅ 排除 |
| `.codework/logs/` | 运行日志 | ✅ 排除 |
| `.codework/history.json` | 执行历史 | 按需（可保留供审计） |
| `.codework/status.json` | 当前状态快照 | ✅ 排除 |
| `.codework/domain-state.json` | 领域状态 | 按需 |
| `deliverables/` | 打包交付物 | 按需（大文件排除） |

### 推荐 `.gitignore` 内容

```gitignore
# 运行时依赖
node_modules/

# 运行时状态
.codework/logs/
.codework/status.json

# 系统文件
.DS_Store
Thumbs.db

# 编辑器
.idea/
.vscode/
*.swp
*.swo
```

---

## 生产环境检查清单

在将 CodeWork 2.0 集成到生产工作流前，请确认：

- [ ] Node.js 版本 ≥ 18.0.0
- [ ] `npm test` 通过（≥ 68/73 个测试）
- [ ] `npm run lint` 无错误/警告
- [ ] `PLAN.md` 已正确填写阶段和任务
- [ ] `codework.config.json` 中的 `logLevel` 已设置为适当级别（生产建议 `warn`）
- [ ] `.codework/` 目录有写权限
- [ ] `deliverables/` 目录有足够磁盘空间
- [ ] 日志轮转策略已配置（避免日志文件无限增长）
- [ ] **frp 映射已收敛到 443 单一入口**（参见 `docs/frp-https-setup.md`）
- [ ] 本地反向代理（Nginx/Caddy）已配置域名路由规则
- [ ] **HTTPS 证书已配置**（Let's Encrypt 或自有证书）
- [ ] 域名已解析到服务器公网 IP

---

## 对外服务与 frp 映射

### 架构原则：单一入口

CodeWork 2.0 平台对外**只暴露 443 端口**，所有服务通过反向代理按域名/路径分发。

```
外部用户
    │
    ▼
┌─────────────┐
│   443 端口   │  ← 唯一对外暴露的入口（frp 映射）
│  (HTTPS)    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 本地 443    │  ← Nginx/Caddy 反向代理（统一网关）
│ (统一网关)  │
└──────┬──────┘
       │
   ┌───┼───┬─────────┬─────────┐
   ▼   ▼   ▼         ▼         ▼
18789 18790 18792   18795     ...
openclaw work-ui codework2 vector-site
```

### 本地服务端口分配

| 服务 | 本地端口 | 协议 | 说明 |
|------|---------|------|------|
| openclaw 网关 | 18789 | WebSocket | AI 网关通信 |
| work-ui | 18790 | HTTP | 旧版 UI（待迁移） |
| work-ui 跳转 | 18791 | HTTP | HTTP → HTTPS 跳转 |
| **CodeWork 2.0** | **18792** | **HTTPS** | **主服务（TLS）** |
| vector-site | 18795 | HTTPS | 矢量工坊 |

### frp 客户端配置

配置文件：`D:\KIMI\frp\frpc.toml`

```toml
[[proxies]]
name = "https-unified"
type = "tcp"
localIP = "127.0.0.1"
localPort = 443
remotePort = 443
```

**注意：**
- 仅映射 443 → 443，其他端口不再直接暴露
- 本地需在 443 端口运行反向代理（Nginx/Caddy）
- 反向代理按域名路由到各服务的本地端口

### Nginx 反向代理示例

```nginx
# CodeWork 2.0
server {
    listen 443 ssl http2;
    server_name codework2.your-domain.com;
    ssl_certificate /path/to/cert.crt;
    ssl_certificate_key /path/to/cert.key;
    location / {
        proxy_pass https://127.0.0.1:18792;
        proxy_set_header Host $host;
    }
}

# openclaw 网关（WebSocket 支持）
server {
    listen 443 ssl http2;
    server_name openclaw.your-domain.com;
    ssl_certificate /path/to/cert.crt;
    ssl_certificate_key /path/to/cert.key;
    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# 矢量工坊
server {
    listen 443 ssl http2;
    server_name vector.your-domain.com;
    ssl_certificate /path/to/cert.crt;
    ssl_certificate_key /path/to/cert.key;
    location / {
        proxy_pass https://127.0.0.1:18795;
        proxy_set_header Host $host;
    }
}
```

---

### Q8：Let's Encrypt 证书申请失败

**常见原因：**
- 域名未解析到服务器 IP
- 服务器 80 端口被防火墙阻挡
- 已申请次数过多（生产环境每周限 50 次）

**解决：**

```bash
# 1. 确认域名解析
nslookup your-domain.com

# 2. 测试 80 端口可访问性
curl -I http://your-domain.com/.well-known/acme-challenge/test

# 3. 使用测试环境先验证
node core/server/letsencrypt-cli.js obtain \
  --email admin@your-domain.com \
  --domains your-domain.com \
  --staging \
  --agree

# 4. 查看详细错误
node core/server/letsencrypt-cli.js status --domains your-domain.com
```

---

### Q9：浏览器仍显示"不安全"

**原因：** 可能仍在使用自签名证书，或证书链不完整。

**解决：**

```bash
# 检查当前证书信息
node -e "
const { CertManager } = require('./core/server/cert-manager');
const cm = new CertManager({ certPath: './.codework/certs/letsencrypt/fullchain.pem' });
const result = cm.load();
console.log(result.info);
"

# 确保证书路径配置正确
# 使用 fullchain.pem（包含中间证书），而非仅 cert.pem
```

---

*CodeWork 2.0 部署指南 | v2.0.2 — Let's Encrypt 版 | 2026-07-24*
