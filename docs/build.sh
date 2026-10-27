#!/usr/bin/env bash
# IVE 브로셔 재생성: HTML(build-brochure.js) → PDF/PNG(headless Chrome)
# 사용: bash docs/build.sh
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  echo "Chrome 실행 파일을 찾을 수 없습니다. CHROME 환경변수로 경로를 지정하세요." >&2
  exit 1
fi

node build-brochure.js
node build-brochure-en.js

# 멀티페이지 브로셔 + 개별 슬라이드 PDF
for n in ive-cover ive-overview ive-screens ive-record ive-impact ive-why ive-poc ive-brochure; do
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$n.pdf" "file://$PWD/$n.html" 2>/dev/null
  echo "PDF  → $n.pdf"
done

# 미리보기 PNG (개별 슬라이드, 2x)
for n in ive-cover ive-overview ive-screens ive-record ive-impact ive-why ive-poc ive-overview-en ive-screens-en; do
  "$CHROME" --headless --disable-gpu --screenshot="$n.png" \
    --window-size=1280,720 --force-device-scale-factor=2 "file://$PWD/$n.html" 2>/dev/null
  echo "PNG  → $n.png"
done

echo "완료."
