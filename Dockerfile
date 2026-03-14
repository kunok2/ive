# ---- Build stage ----
FROM node:22-slim AS builder

# node-pty, better-sqlite3 네이티브 빌드에 필요한 도구
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Next.js 빌드 결과물 복사
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public 2>/dev/null || true

# 소스 파일 (server.ts, src/) 복사 — tsx가 런타임에 트랜스파일
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./
COPY next.config.ts ./

# Claude Code CLI 설치
RUN npm install -g @anthropic-ai/claude-code

# 데이터 디렉토리 생성
RUN mkdir -p data/logs workspaces

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]
