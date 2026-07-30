# CodeWork 2.0 项目规划

## 项目概述

CodeWork 2.0 是一个智能体辅助开发框架，旨在系统化地管理、执行和迭代软件开发任务。本项目是 CodeWork 的第二代版本，在原有基础上增加了更完善的计划管理、阶段追踪和交付物管理功能。

## 整体架构

```
CodeWork 2.0/
├── PLAN.md              # 项目总体规划（本文件）
├── README.md            # 项目说明文档
├── core/                # 核心框架代码
│   ├── config.js        # 配置管理器 v2（多源合并、热加载、脱敏）
│   ├── config/          # 配置子系统
│   │   ├── schema.js    # Schema 定义与校验
│   │   └── env-loader.js# 环境变量/.env 加载
│   ├── db/              # 数据库迁移系统
│   │   └── migrate.js   # 迁移运行器（node:sqlite）
│   ├── server/          # HTTPS 服务器
│   │   ├── https-server.js
│   │   ├── cert-manager.js
│   │   └── index.js
│   ├── planner.js       # 计划管理器
│   ├── executor.js      # 任务执行器
│   └── tracker.js       # 进度追踪器
├── projects/            # 多项目目录（各项目独立 PLAN.md + stages/）
│   ├── default/         # 默认项目
│   └── <项目名>/        # 其他项目
├── migrations/          # SQL 迁移文件
│   ├── 001-initial-schema.sql
│   └── 002-seed-data.sql
├── templates/           # 任务模板
│   ├── web-app.json
│   ├── script.json
│   └── tool.json
├── tests/               # 测试用例
│   ├── run-tests.js     # 旧版测试运行器
│   └── vitest/          # Vitest 测试套件
├── deliverables/        # 交付物汇总
└── .codework/           # 运行时状态
```

## 阶段规划

（暂无阶段。通过对话派发或新建项目后，阶段会自动写入此处。）

## 技术栈

- **核心语言：** JavaScript (Node.js ≥ 24.0)
- **数据持久化：** SQLite（`node:sqlite` 内置模块，零第三方依赖）
- **配置格式：** JSON / YAML / .env
- **文档格式：** Markdown
- **测试框架：** Vitest + @vitest/coverage-v8
- **代码检查：** ESLint
- **CI/CD：** GitHub Actions
- **版本控制：** Git

## 使用方式

### 初始化项目
```bash
node core/init.js --project-name="我的项目"
```

### 创建新计划
```bash
node core/planner.js create --stage=1 --name="阶段一任务"
```

### 执行任务
```bash
node core/executor.js run --plan=PLAN.md --stage=1
```

### 数据库迁移
```bash
npm run migrate
npm run migrate:status
npm run migrate:rollback
```

### 启动服务器
```bash
# 配置 server.enabled=true 后
node -e "const {createServer} = require('./core/server'); const {ConfigManager} = require('./core'); createServer(new ConfigManager('.'))"
```

### 生成交付物
```bash
node core/deliver.js --output=./deliverables
```

### 运行测试
```bash
npm test              # Vitest 测试套件
npm run test:coverage # 覆盖率报告
npm run test:legacy   # 旧版测试运行器
```


### 阶段6：💬 用户需求（对话派发）

**目标：** 从 1.0 对话入口派发过来的用户需求，逐条有条有理地执行。

**任务清单：**
1. ✅ [workdir:D:\KIMI\codework2-site] 【2.0 工程看板 UI 全面翻新：macOS 27 设计语言】把 ui/ 前端整体翻新为 macOS 27 风格，与 Borealos 主站（D:\KIMI\work-ui\index.html）同代：1)浅色主色+毛玻璃半透明导航(backdrop-filter)+12-16px圆角卡片+1px半透明边框；2)系统字栈四级字阶；3)按钮/卡片hover微交互150-250ms，加载shimmer骨架屏；4)进度条去掉绿条纹老样式，改细轨道+渐变填充+动画；5)登录/空状态有设计感；6)深浅色兼容。硬约束：先快照留底；不删/不改任何带id的DOM元素和JS绑定；不改server业务逻辑与API；改完node --check自查JS，并验证:18792各页面（仪表盘/计划看板/任务执行/执行历史/快照/模板/交付物/配置）200且无控制台报错。
