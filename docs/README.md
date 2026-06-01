# IVE 제품 소개서 (브로셔)

IVE 운영 구조와 도입 효과를 담은 제품 소개서. 그림 중심 슬라이드(16:9)로 구성.

## 산출물
| 파일 | 내용 |
|------|------|
| `ive-brochure.pdf` | **전체 브로셔 (멀티페이지)** — 아래 슬라이드를 한 PDF로 |
| `ive-overview.pdf` / `.png` | 1장 — 전체 운영 구조도 |
| `ive-impact.pdf` / `.png` | 2장 — 도입 효과 (역할별 Before → After + 조직 변화) |

## 재생성
```bash
bash docs/build.sh          # HTML → PDF/PNG 까지 일괄 생성
# 또는 HTML만:
node docs/build-brochure.js
```
- `build-brochure.js` 가 SVG 슬라이드를 HTML로 만든다. 로고는 `public/cli/*`, `public/slack-icon-1024.png`, `docs/assets/{github,gitlab}.svg` 를 base64로 인라인하므로 PDF/HTML이 단독으로 열린다.
- `build.sh` 는 headless Chrome로 PDF/PNG를 렌더링한다. Chrome 경로가 다르면 `CHROME=/path/to/chrome bash docs/build.sh`.

## 디자인
[DESIGN_GUIDE.md](../DESIGN_GUIDE.md)의 `ive-*` 팔레트(시안=정상/브랜드, 앰버=행동/산출, 레드=문제)와 다크 톤을 따른다. 슬라이드 문구·배치는 `build-brochure.js` 상단의 노드/배지 좌표에서 수정한다.
