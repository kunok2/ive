# ---- Build stage ----
FROM node:24-slim AS builder

# node-pty, better-sqlite3 네이티브 빌드에 필요한 도구
# apt 캐시 마운트: 받은 .deb 를 빌드 간 보관 → 느린 회선이어도 재다운로드 회피.
#   (캐시 마운트 내용은 이미지 레이어에 포함되지 않으므로 별도 rm 불필요)
# 미러는 deb.debian.org(공식 CDN) 유지 — 빌드가 arm64 라 국내 미러(kakao 등)는
# arm64 패키지를 제공하지 않아 404. CDN 은 전 아키텍처 제공.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    python3 make g++

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Playwright 브라우저 스테이지 ----
# 공식 playwright 이미지에서 브라우저 바이너리만 가져오기 위한 스테이지.
# chromium 만 쓰므로 firefox/webkit 은 제거해 이미지 비대화 방지.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS pwbrowsers
RUN find /ms-playwright -maxdepth 1 -type d \( -name 'firefox*' -o -name 'webkit*' \) -exec rm -rf {} + || true

# ---- Runtime stage ----
FROM node:24-slim

# apt 캐시 마운트 (위 builder stage 와 동일 이유). 미러는 deb.debian.org CDN 유지(arm64 제공).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    python3 make g++ git \
    curl wget jq unzip zip \
    ripgrep fd-find tree \
    procps psmisc \
    netcat-openbsd dnsutils

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# ──────────────────────────────────────────────────────────────────
# 소스와 무관한 무거운 설치들은 소스 COPY "위"에 둔다.
# 아래로 내려가면 소스 한 줄만 바뀌어도 이 레이어들이 캐시 무효화돼
# Playwright OS 의존성 ~78MB(apt) + 전역 CLI를 매 빌드 재다운로드한다.
# ──────────────────────────────────────────────────────────────────

# Claude Code CLI 설치
RUN npm install -g @anthropic-ai/claude-code

# OpenCode CLI 설치
RUN npm install -g opencode-ai

# Playwright (에이전트가 웹 스크래핑/브라우저 자동화 시 사용)
# 브라우저 바이너리는 매번 ~150MB CDN 다운로드(느린 상류 회선에 취약) 대신
# 공식 playwright 이미지(v1.55.0)에서 COPY → 빌드 중 Playwright CDN 다운로드 제거.
# - npm 글로벌은 npx playwright 용이며, 복사한 브라우저와 동일 버전(1.55.0)으로 핀.
# - OS 의존성만 install-deps(apt, 빠른 미러)로 설치. 브라우저는 받지 않음.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
COPY --from=pwbrowsers /ms-playwright /opt/playwright-browsers
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    npm install -g playwright@1.55.0 \
    && npx playwright install-deps chromium \
    && chmod -R o+rx /opt/playwright-browsers

# ──────────────────────────────────────────────────────────────────
# 자주 바뀌는 빌드 결과물/소스는 맨 아래 (캐시 무효화 영향 최소화)
# ──────────────────────────────────────────────────────────────────

# Next.js 빌드 결과물 복사
COPY --from=builder /app/.next ./.next
RUN --mount=type=bind,from=builder,source=/app/public,target=/builder-public \
    cp -r /builder-public ./public 2>/dev/null || mkdir -p public

# 소스 파일 (server.ts, src/) 복사 — tsx가 런타임에 트랜스파일
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./
COPY next.config.mjs ./

# non-root 사용자 생성 (Claude Code의 root 제한 우회)
RUN useradd -m -s /bin/bash ive \
    && mkdir -p data/logs workspaces /home/ive/.claude \
    && ln -s /home/ive/.claude/.claude.json /home/ive/.claude.json \
    && chown -R ive:ive /app /home/ive \
    && git config --global user.email "ive-agent@springware-ive.local" \
    && git config --global user.name "IVE Agent" \
    && cp /root/.gitconfig /home/ive/.gitconfig \
    && chown ive:ive /home/ive/.gitconfig

EXPOSE 443

ENV NODE_ENV=production

USER ive

CMD ["npm", "start"]
