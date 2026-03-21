# ---- Build stage ----
FROM node:22-slim AS builder

# node-pty, better-sqlite3 네이티브 빌드에 필요한 도구
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

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
RUN --mount=type=bind,from=builder,source=/app/public,target=/builder-public \
    cp -r /builder-public ./public 2>/dev/null || mkdir -p public

# 소스 파일 (server.ts, src/) 복사 — tsx가 런타임에 트랜스파일
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./
COPY next.config.mjs ./

# Claude Code CLI 설치
RUN npm install -g @anthropic-ai/claude-code

# OpenCode CLI 설치
RUN npm install -g opencode-ai

# non-root 사용자 생성 (Claude Code의 root 제한 우회)
RUN useradd -m -s /bin/bash ive \
    && mkdir -p data/logs workspaces /home/ive/.claude \
    && ln -s /home/ive/.claude/.claude.json /home/ive/.claude.json \
    && chown -R ive:ive /app /home/ive \
    && git config --global user.email "ive-agent@spring-ive.local" \
    && git config --global user.name "IVE Agent" \
    && cp /root/.gitconfig /home/ive/.gitconfig \
    && chown ive:ive /home/ive/.gitconfig

EXPOSE 443

ENV NODE_ENV=production

USER ive

CMD ["npm", "start"]
