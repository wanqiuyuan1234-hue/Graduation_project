# ---------- 1. 安装依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 使用国内镜像源 + 失败重试，避免访问 npmjs 时 ECONNRESET
RUN npm config set registry https://registry.npmmirror.com \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && npm ci

# ---------- 2. 构建 ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 3. 运行 ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 关键：必须绑 0.0.0.0，否则容器外访问不到
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# standalone 产物（项目 build 脚本已把 static 和 public 复制进去）
COPY --from=builder /app/.next/standalone ./
# 再显式复制一次，防止 build 脚本变化导致缺失
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]