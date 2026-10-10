/**
 * 보드 카드가 다른 칸으로 옮겨질 때 「스르륵」 날아가는 효과.
 *
 * 카드는 칸(스크롤 영역)이 바뀌면 DOM 부모가 달라져 제자리에서 사라지고 새 칸에 나타난다 — 어디로 갔는지 눈이 못 따라간다.
 * 그리기 전 자리와 그린 뒤 자리를 견주어, 칸이 바뀐 카드는 화면 위에 띄운 복제본을 옛 자리에서 새 자리로 움직인다.
 * (카드 자체를 transform 으로 옮기면 칸의 overflow 에 잘린다 — 그래서 복제본을 body 에 띄운다.)
 *
 * 카드에는 data-fly(카드 식별자)·data-fly-col(칸)을 단다.
 */
export interface FlySpot { col: string; left: number; top: number; width: number; height: number }
export type FlySpots = Map<string, FlySpot>

const DURATION_MS = 450

/** 지금 화면의 카드 자리 — 안 보이는 카드(접힌 칸 등, 크기 0)는 뺀다 */
export function measureFly(root: HTMLElement | null): FlySpots {
  const spots: FlySpots = new Map()
  if (!root) return spots
  root.querySelectorAll<HTMLElement>('[data-fly]').forEach(el => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    spots.set(el.dataset.fly!, { col: el.dataset.flyCol || '', left: r.left, top: r.top, width: r.width, height: r.height })
  })
  return spots
}

/** before(그리기 전 자리)와 견주어 칸이 바뀐 카드를 날린다. 움직임 줄이기 설정이면 아무것도 하지 않는다 */
export function flyMoved(root: HTMLElement | null, before: FlySpots): void {
  if (!root || before.size === 0 || typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  root.querySelectorAll<HTMLElement>('[data-fly]').forEach(el => {
    const from = before.get(el.dataset.fly!)
    if (!from || from.col === (el.dataset.flyCol || '')) return
    // 날아가는 중에 또 옮겨졌으면 앞선 복제본은 치운다
    if (el.dataset.flying) return
    const to = el.getBoundingClientRect()
    if (to.width === 0 || to.height === 0) return
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-fly')
    ghost.setAttribute('aria-hidden', 'true')
    Object.assign(ghost.style, {
      position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
      margin: '0', zIndex: '55', pointerEvents: 'none', boxSizing: 'border-box',
    })
    document.body.appendChild(ghost)
    el.dataset.flying = '1'
    el.style.visibility = 'hidden'
    let ended = false
    const done = () => { if (ended) return; ended = true; ghost.remove(); el.style.visibility = ''; delete el.dataset.flying }
    // 애니메이션 끝 신호가 오지 않아도(가려진 탭 등) 카드가 숨은 채 남지 않게
    setTimeout(done, DURATION_MS + 200)
    try {
      const anim = ghost.animate(
        [
          { transform: 'translate(0, 0)', width: `${from.width}px`, height: `${from.height}px` },
          { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`, width: `${to.width}px`, height: `${to.height}px` },
        ],
        { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
      )
      anim.onfinish = done
      anim.oncancel = done
    } catch { done() }
  })
}
