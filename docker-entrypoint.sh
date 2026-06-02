#!/bin/sh
set -e

# bind-mount된 설정/데이터 디렉토리는 호스트 소유권을 그대로 따라간다.
# 특히 호스트에 디렉토리가 없는 채로 docker compose가 처음 뜨면 Docker 데몬(root)이
# 그 디렉토리를 root:root로 생성하므로, non-root 사용자 ive가 그 안에 쓰지 못해
# EACCES(예: opencode가 ~/.local/share/opencode/repos mkdir 실패)가 난다.
# 컨테이너 시작 시 root로 소유권을 ive에 맞춘 뒤 ive로 강등해 실행한다.
IVE_UID="$(id -u ive)"
IVE_GID="$(id -g ive)"

# CLI 인증/세션 상태 디렉토리(작음) — 재귀로 맞춘다.
for d in \
  /home/ive/.claude \
  /home/ive/.codex \
  /home/ive/.gemini \
  /home/ive/.local/share/opencode \
; do
  mkdir -p "$d"
  chown -R "$IVE_UID:$IVE_GID" "$d"
done

# data/workspaces는 시간이 지나면 커질 수 있어 마운트 루트만(비재귀) 맞춘다.
# 실패 모드는 "root가 만든 빈 마운트 루트에 ive가 못 쓰는 것"이므로 루트만 고치면 충분하다.
for d in /app/data /app/data/logs /app/workspaces; do
  mkdir -p "$d"
  chown "$IVE_UID:$IVE_GID" "$d"
done

exec gosu ive "$@"
