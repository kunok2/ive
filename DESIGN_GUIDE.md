# IVE Design Guide

이 문서는 UI 컴포넌트의 스타일 기준입니다. 새 컴포넌트를 만들거나 기존 컴포넌트를 수정할 때 반드시 따릅니다.

## 색상 (globals.css @theme)
```
배경:   ive-bg-deep(#060c06) > ive-bg(#0e160e) > ive-bg-card(#121e14) > ive-bg-input(#0a120a)
초록:   ive-green(#4ade80), ive-green-dark(#16a34a), ive-green-light(#86efac), ive-green-pale(#dcfce7)
강조:   ive-amber(#fbbf24), ive-cyan(#22d3ee), ive-purple(#a78bfa), ive-red(#ef4444)
텍스트: ive-text(#e0e0e0) > ive-text-secondary(#b0c8b4) > ive-text-muted(#618068) > ive-text-dim(#455048)
테두리: ive-border(#1a3a1e), ive-border-dark(#152a18), ive-border-subtle(#1a2e1c)
```

## 라운딩
| 용도 | 값 | 비고 |
|------|-----|------|
| 버튼, 인풋, 카드, 배지 | `rounded-lg` | 기본값, 가장 많이 사용 |
| 모달 | `rounded-2xl` | 모달 외곽만 |
| 아바타, 상태 점 | `rounded-full` | 원형 요소만 |

`rounded-xl`, `rounded-md`, `rounded-sm` 사용 금지. 예외 없음.

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
Icon:      w-8 h-8 rounded-full (정사각형 아이콘 버튼)
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
