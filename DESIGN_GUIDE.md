# IVE Design Guide

이 문서는 UI 컴포넌트의 스타일 기준입니다. 새 컴포넌트를 만들거나 기존 컴포넌트를 수정할 때 반드시 따릅니다.

## 색상 (globals.css @theme)

### 핵심 원칙 — "색은 의미. 측정값은 색이 아니다."

색을 본 사용자가 **즉시 같은 추론**을 할 수 있어야 합니다. 화면마다 다른 의미로 색을 쓰면 사용자에게 알록달록한 장식 그 이상이 못 됩니다.

**색을 쓰는 곳 (의미 있는 신호):**
1. 상태 배지 (이슈 단계, 실행 상태)
2. 추세 화살표 (증가/감소)
3. 알림/경고 아이콘
4. 액션 버튼 (Primary 강조, Danger 삭제)

**색을 쓰지 않는 곳 (측정값/정보):**
- 숫자(카운트, 시간, 금액, 토큰)
- 라벨, 제목, 본문
- 표/카드의 데이터 셀
- 차트의 데이터 시리즈가 1종일 때 (단색 시안)
- 비활성/종료 상태

→ 측정값과 라벨은 **흰색 톤(`ive-text` / `text-secondary` / `text-muted` / `text-dim`)** 으로만 표현. 강조가 필요하면 굵기(`font-bold`)와 크기로 한다.

### 의미-토큰 매핑 (전 화면 동일 적용)
| 사용자가 보고 추론할 의미 | 토큰 | 적용 대상 |
|---|---|---|
| **"정상/완료/정보"** — 확인만 하면 됨 | `ive-cyan` (`ive-green` 별칭) | 완료(done), 대기(waiting), 정보 알림, 정상 상태 배지, 브랜드 강조, 포커스 링, Primary 액션 버튼 |
| **"내가 행동/관여 필요"** — 진행 중 또는 사용자 응답 필요 | `ive-amber` | 개발중(dev), 검증대기(verify_waiting), 검증중(verifying), 진행중(running), 경고 알림 |
| **"문제 발생"** | `ive-red` | 실패(failed/dev_fail), 거절(rejected), 위험, 부정적 추세(감소가 나쁜 맥락), 삭제 버튼 |
| **"중립/측정값/비활성"** | `ive-text` / `text-muted` / `text-dim` | 모든 숫자/시간/금액, 비활성/종료/취소 상태, 라벨, 본문 |

### 추세(델타) 색
- **양의 변화가 좋은 맥락**(처리량, 완료수, 가동률): 증가 → `ive-cyan`, 감소 → `ive-red`
- **양의 변화가 나쁜 맥락**(비용, 대기시간, 실패율): 증가 → `ive-red`, 감소 → `ive-cyan`
- 변화가 미미(±5% 이하): 중립 텍스트, 색 없음
- 일반적인 측정값 변화 표시(맥락 모호): 색 없이 숫자만

### 차트 색
- 데이터 시리즈가 1종 → **단색 `ive-cyan`**
- 2종(예: 유입 vs 처리) → 시안 + 회색 (대비 시리즈는 항상 회색)
- 3종 이상 → 시안 단색 + 굵기/투명도/패턴으로 구분
- "비용" 차트라고 amber로 칠하지 말 것. 비용은 측정값이지 경고가 아님.

### 토큰 (globals.css)
```
배경:   ive-bg-deep > ive-bg > ive-bg-card > ive-bg-input
브랜드: ive-cyan == ive-green (#22d3ee)
       ive-green-dark/light/pale (브랜드 변주, Primary 버튼 등)
의미:   ive-amber (#f59e0b)   — 행동/진행 필요
       ive-red   (#ef4444)   — 문제 발생
텍스트: ive-text > ive-text-secondary > ive-text-muted > ive-text-dim (밝은 순)
테두리: ive-border, ive-border-dark, ive-border-subtle
```

### 금지 (색)
- 측정값(숫자, 시간, 금액)에 색 부여 금지
- "장식"용 색 금지 (예쁘게 보이려고)
- 같은 의미를 화면마다 다른 색으로 표시 금지
- 다른 의미를 같은 색으로 표시 금지 (예: 비용=amber 와 검증=amber 동시 사용 시 사용자 혼란)
- 원시 Tailwind 팔레트(`purple-*`, `orange-*`, `emerald-*`, `sky-*`, `rose-*`, `pink-*`, `slate-*`, `yellow-*`, `indigo-*`, `teal-*`, `blue-*`, `violet-*`, `fuchsia-*`, `cyan-*`, `green-*`, `red-*`, `gray-*`, `zinc-*`) 전부 금지
- className/style hex 리터럴 금지 — 반드시 ive-* 토큰 또는 `var(--color-ive-*)`

## 라운딩
| 용도 | 값 | 비고 |
|------|-----|------|
| 버튼, 인풋, 카드, 배지, 아바타 | `rounded-lg` | 기본값, 가장 많이 사용. 사용자/에이전트 아바타 포함 |
| 모달 | `rounded-2xl` | 모달 외곽만 |
| 상태 점, 알림 카운트 뱃지, 진행률 바, 토글 스위치, 라벨 컬러 도트, 페이지네이션 도트 | `rounded-full` | 의미적으로 원형이어야 하는 요소만 |
| 아이콘 버튼, pill/chip 버튼, 상태 뱃지, 단계 번호, 탑바 버튼/아바타 | `rounded-lg` | 라운딩 사각형 (시각적 안정감) |

`rounded-xl`, `rounded-md`, `rounded-sm` 사용 금지. 예외 없음.

**원형(`rounded-full`)은 위 우측 행에 명시된 의미를 가질 때만 사용.** 일반 버튼·뱃지·칩·아이콘 컨테이너는 모두 `rounded-lg`. 아바타도 `rounded-lg`.

## 타이포그래피
| 용도 | 크기 | 웨이트 |
|------|------|--------|
| 페이지 제목 | `text-xl` ~ `text-2xl` | `font-bold` |
| 섹션 제목 | `text-base` ~ `text-lg` | `font-bold` |
| 본문 | `text-sm` | `font-bold` 또는 기본 |
| 보조 텍스트, 라벨 | `text-xs` | `font-bold` |
| 버튼 텍스트 | `text-sm` | `font-bold` |

- `font-bold`가 기본. `font-semibold`, `font-black`, `font-extrabold`, `font-medium` 사용 금지.
- 강조가 필요하면 색상(`ive-green`, `text-white`)으로 구분.

## 버튼
```
Primary:   bg-ive-green-dark text-white font-bold text-sm px-4 py-3 rounded-lg
Secondary: bg-white/5 text-ive-text-muted font-bold text-sm px-3 py-2 rounded-lg border border-ive-border-subtle
Danger:    text-ive-red font-bold text-sm px-3 py-2 rounded-lg border border-ive-red/30
Ghost:     text-ive-text-muted font-bold text-sm px-3 py-2 rounded-lg hover:bg-white/5
Icon:      w-8 h-8 rounded-lg (정사각형 아이콘 버튼)
```
- 모든 버튼 hover: `hover:opacity-80` 또는 `hover:bg-*` 사용
- disabled: `disabled:opacity-40`

## 카드
```
기본:    bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4
내부 카드: bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3
```
- `shadow-*` 사용 금지. 카드 구분은 배경색과 테두리로만.
- 카드 내 패딩은 `p-4` (기본) 또는 `p-3` (컴팩트).

## 인풋 / 폼
```
Input:    w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green
Select:   동일
Textarea: 동일 + resize-none
Label:    text-sm font-bold text-ive-text-muted mb-1
```

## 모달
```
Overlay:  fixed inset-0 bg-black/60 z-50
Container: bg-ive-bg-card border border-ive-border rounded-2xl
Header:   px-4 py-3 border-b border-ive-border-dark
Body:     px-4 py-4
Footer:   px-4 py-3 border-t border-ive-border-dark
```

## 배지 / 태그
```
기본: px-2 py-0.5 rounded-lg text-xs font-bold
상태(성공): bg-ive-green/20 text-ive-green
상태(경고): bg-ive-amber/20 text-ive-amber
상태(에러): bg-ive-red/20 text-ive-red
상태(정보): bg-ive-cyan/20 text-ive-cyan
```

## 아이콘
- FontAwesome `fa-solid` 사용
- 버튼/배지 내 아이콘: 텍스트와 동일 크기 (별도 크기 지정 안 함)
- 독립 아이콘: `text-sm` (기본), `text-base` (강조)
- `text-[11px]` 같은 임의 크기 사용 금지

## 간격
| 용도 | 값 |
|------|-----|
| 리스트 아이템 간격 | `gap-2` |
| 섹션 간격 | `gap-3` 또는 `gap-4` |
| 인라인 요소 간격 | `gap-1` 또는 `gap-1.5` |
| 카드 내부 패딩 | `p-4` (기본), `p-3` (컴팩트) |
| 버튼 패딩 | `px-4 py-3` (기본), `px-3 py-2` (작은) |

## 금지 사항
- `shadow-*` 사용 금지 (예외: 모달/다이얼로그는 `shadow-2xl`, 드롭다운 팝업은 `shadow-lg` 허용)
- `rounded-xl` 사용 금지 (rounded-lg 또는 rounded-2xl(모달)만)
- `font-black`, `font-semibold`, `font-extrabold`, `font-medium` 사용 금지
- `text-[임의값]` 형태의 커스텀 크기 사용 금지
- 컴포넌트마다 다른 색상 체계 사용 금지 (globals.css의 ive-* 변수만 사용)
- **원시 Tailwind 팔레트(purple/orange/rose/emerald/sky/pink/slate/yellow/indigo/teal/blue/violet/fuchsia-*) 사용 금지**
- **className 또는 style에 hex(#…) 리터럴 직접 사용 금지** — 반드시 ive-* 토큰 또는 CSS 변수(`var(--color-ive-*)`) 참조
- `ive-purple`, `ive-lime` 토큰은 삭제됨 — 사용 금지
