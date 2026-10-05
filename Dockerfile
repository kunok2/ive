# ---- Build stage ----
FROM node:24-slim AS builder

# node-pty, better-sqlite3 네이티브 빌드에 필요한 도구
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Playwright 브라우저 스테이지 ----
# 공식 playwright 이미지에서 1.55.0(스크래퍼 판) 브라우저 바이너리만 가져오기 위한 스테이지.
# 이 판은 chromium 만 쓰므로 firefox/webkit 은 제거. 화면 검증용 3종은 아래 런타임 단계에서 판별로 받는다.
FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS pwbrowsers
RUN find /ms-playwright -maxdepth 1 -type d \( -name 'firefox*' -o -name 'webkit*' \) -exec rm -rf {} + || true

# ---- Runtime stage ----
FROM node:24-slim

RUN apt-get update && apt-get install -y \
    python3 make g++ git \
    curl wget jq unzip zip \
    ripgrep fd-find tree \
    procps psmisc \
    netcat-openbsd dnsutils \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── 네트워크 무거운 전역 설치(AI CLI + Playwright)를 앱 소스 COPY 보다 "먼저" 둔다 ──
# 이 레이어들은 .next/src(커밋마다 바뀜)에 의존하지 않는다. 따라서 소스만 바뀐 평범한 커밋에선
# 캐시가 적중해 매번 ~40MB(apt 인덱스+패키지, npm 전역) 재다운로드를 통째로 건너뛴다.
# (예전엔 COPY .next 뒤에 있어 매 커밋 재실행 → deb.debian.org 간헐적 저속(~15kB/s)에 직격당해
#  배포가 8분~27분으로 들쭉날쭉했다. 이 재배치로 그 다운로드를 커밋마다 반복하지 않는다.)

# AI CLI 전역 설치 (버전 변동이 적어 캐시 안정)
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g opencode-ai
RUN npm install -g @openai/codex
# agy (Google Antigravity CLI) — Gemini CLI 단종에 따른 대체.
#   npm 배포가 아니라 공식 설치 스크립트가 플랫폼 바이너리(tar.gz)를 내려받아 $HOME/.local/bin 에 둔다.
#   빌드는 root 로 돌아 /root/.local/bin 에 깔리는데 실행 사용자(ive)가 /root 를 못 읽으므로,
#   임시 HOME 으로 설치한 뒤 다른 CLI 와 같은 관례 위치(/usr/local/bin)로 옮긴다.
RUN HOME=/tmp/agy-install sh -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash' \
    && mv /tmp/agy-install/.local/bin/agy /usr/local/bin/agy \
    && chmod 755 /usr/local/bin/agy \
    && rm -rf /tmp/agy-install \
    && agy --version

# dazzlepf 추출기(apps/extractor)를 작업자가 직접 돌릴 도구 — 파싱 후처리 규칙 접수건에서
# 「Java·pytest 가 없어 ODL 좌표도 골든도 못 돌렸다」로 멈췄다(MSHOP-202610-0004).
# - JRE: ODL(opendataloader-pdf) 은 java -jar 로 돈다. docker 는 필요 없다.
# - tesseract(kor, tessdata_best): 추출기 이미지와 같게 — 없으면 깨진 폰트 문서의 파싱 결과가 운영과 달라진다.
# - uv + python 3.12: 추출기 운영 이미지(python:3.12-slim)와 같은 판. 베이스의 python3(3.11)는 판이 달라 쓰지 않는다.
#   venv 는 저장소의 apps/extractor/scripts/setup-venv.sh 가 requirements.lock 으로 만든다.
#   uv 캐시를 /app/data(호스트 볼륨)에 두어 휠은 처음 한 번만 받는다.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_CACHE_DIR=/app/data/uv-cache \
    UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless \
    tesseract-ocr tesseract-ocr-kor \
    && rm -rf /var/lib/apt/lists/* \
    && (curl -fsSL -o /usr/share/tesseract-ocr/5/tessdata/kor.traineddata \
          https://github.com/tesseract-ocr/tessdata_best/raw/main/kor.traineddata \
        || echo "tessdata_best 내려받기 실패 — 배포판 kor 데이터 사용") \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh \
    && UV_CACHE_DIR=/tmp/uv-cache uv python install 3.12 \
    && rm -rf /tmp/uv-cache \
    && chmod -R a+rX /opt/uv-python \
    && java -version && uv --version && tesseract --list-langs | grep -x kor

# Playwright (에이전트가 웹 스크래핑/브라우저 자동화 시 사용)
# 브라우저 바이너리는 매번 ~150MB CDN 다운로드(느린 상류 회선에 취약) 대신
# 공식 playwright 이미지(v1.55.0)에서 COPY → 빌드 중 Playwright CDN 다운로드 제거.
# - npm 글로벌은 npx playwright 용이며, 복사한 브라우저와 동일 버전(1.55.0)으로 핀.
# - OS 의존성만 install-deps(apt)로 설치. 브라우저는 받지 않음.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
# install 은 기본으로 「지금 판이 안 쓰는 브라우저」를 지운다 — 아래 1.62.1 설치가 복사해 둔 1.55.0 chromium 을
# 지웠다. 여러 판을 한 경로에 두므로 정리를 끈다(에이전트가 런타임에 다른 판을 받을 때도 마찬가지).
ENV PLAYWRIGHT_SKIP_BROWSER_GC=1
COPY --from=pwbrowsers /ms-playwright /opt/playwright-browsers
RUN npm install -g playwright@1.55.0 \
    && npx playwright install-deps chromium \
    && chmod -R o+rx /opt/playwright-browsers

# 대상 저장소가 쓰는 Playwright 판의 브라우저 3종(chromium·webkit·firefox)과 그 OS 라이브러리.
# 에이전트는 root 가 없어 --with-deps 를 못 한다 — 여기서 미리 깔아 두지 않으면 WebKit·Firefox 를
# 띄우려고 .deb 를 풀고 LD_LIBRARY_PATH 를 만지며 헛돈다(#1788: 설치 10분 + 우회 17분 뒤 실패).
# - 판마다 브라우저 리비전 폴더가 달라 여러 판을 한 경로에 함께 둘 수 있다.
# - 대상 저장소의 판이 바뀌면 이 목록에 더한다(dazzlepf apps/web/frontend = 1.62.1).
# - 경로를 모두에게 쓰기 허용 → 목록에 없는 판도 에이전트가 root 없이 브라우저만 받아 쓸 수 있다.
ARG PLAYWRIGHT_EXTRA_VERSIONS="1.62.1"
RUN for v in $PLAYWRIGHT_EXTRA_VERSIONS; do \
      npx -y playwright@$v install --with-deps chromium webkit firefox || exit 1; \
    done \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rwX /opt/playwright-browsers

# 확인(④) 단계 작업자가 staging 을 직접 열어 보는 Playwright MCP.
# 판은 src/lib/scanner/confirm-worker.ts PLAYWRIGHT_MCP_PACKAGE 와 같아야 한다.
# 브라우저는 받지 않는다 — IVE 가 위에서 깐 chromium 을 --executable-path 로 넘긴다.
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g @playwright/mcp@0.0.78

# ── 앱 의존성 (package-lock 바뀔 때만 재설치) ──
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# ── 앱 산출물/소스 (커밋마다 변경 — 여기서부터 캐시 무효화되지만 네트워크 작업은 없음) ──
# Next.js 빌드 결과물 + public + 런타임 트랜스파일용 소스(server.ts, src/)
COPY --from=builder /app/.next ./.next
RUN --mount=type=bind,from=builder,source=/app/public,target=/builder-public \
    cp -r /builder-public ./public 2>/dev/null || mkdir -p public
COPY server.ts ./
COPY src ./src
COPY tsconfig.json ./
COPY next.config.mjs ./
# 도움말 › 변경 이력(/api/changelog)이 읽는다
COPY CHANGELOG.md ./

# non-root 사용자 생성 (Claude Code의 root 제한 우회)
RUN useradd -m -s /bin/bash ive \
    && mkdir -p data/logs workspaces /home/ive/.claude /home/ive/.local/share/opencode \
    && ln -s /home/ive/.claude/.claude.json /home/ive/.claude.json \
    && chown -R ive:ive /app /home/ive \
    && git config --global user.email "ive-agent@springware-ive.local" \
    && git config --global user.name "IVE Agent" \
    && cp /root/.gitconfig /home/ive/.gitconfig \
    && chown ive:ive /home/ive/.gitconfig

EXPOSE 443

ENV NODE_ENV=production
# gosu로 ive에 강등해 실행하므로 HOME을 명시한다(gosu는 HOME을 바꾸지 않음).
# CLI들이 ~/.claude, ~/.local/share/opencode 등을 찾으려면 HOME=/home/ive가 필요.
ENV HOME=/home/ive

# entrypoint를 root로 실행해 bind-mount된 디렉토리 소유권을 ive에 맞춘 뒤 ive로 강등한다.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]
