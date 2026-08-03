# ============================================================
# BorealOS 后端 + 前端 多阶段构建
# ============================================================

# ---- Stage 1: 构建 Web 前端 ----
FROM node:20-slim AS web-builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

# 复制 workspace 配置
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc turbo.json tsconfig.json ./

# 复制所有包和应用
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY apps/server/ ./apps/server/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 构建前端
RUN pnpm --filter @borealos/web build

# ---- Stage 2: 构建后端 ----
FROM node:20-slim AS server-builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @borealos/server build

# ---- Stage 3: 生产镜像 ----
FROM node:20-slim AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

# 复制构建产物
COPY --from=server-builder /app/apps/server/dist ./apps/server/dist
COPY --from=server-builder /app/apps/server/package.json ./apps/server/
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist
COPY --from=server-builder /app/packages/ ./packages/
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc turbo.json tsconfig.json ./

# 只装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_TYPE=memory

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
