import type { CSSProperties } from 'react'

/**
 * 넓은 화면(desk) 카드 격자 — 카드가 열 수보다 적으면 그만큼만 열을 두고, 칸 폭은 그대로 둔 채 가운데에 놓는다.
 * (3열에 2장이면 왼쪽 두 칸에 붙지 않고 가운데 두 칸 폭) 열 수 이상이면 보통 격자.
 * 값은 CSS 변수로만 넘긴다 — 격자 클래스가 desk 에서만 이 변수를 쓰므로 폰·패드(한 줄 목록)에는 영향이 없다.
 * 함께 쓸 클래스: `desk:grid desk:grid-cols-[var(--grid-cols)] desk:w-[var(--grid-w)] desk:mx-auto` + 같은 gap.
 */
export function cardGridVars(count: number, cols: number, gapRem: number): CSSProperties {
  const n = count > 0 && count < cols ? count : cols
  const cell = `((100% - ${(cols - 1) * gapRem}rem) / ${cols})`
  return {
    '--grid-cols': `repeat(${n}, minmax(0, 1fr))`,
    '--grid-w': n === cols ? '100%' : `calc(${cell} * ${n} + ${(n - 1) * gapRem}rem)`,
  } as CSSProperties
}
