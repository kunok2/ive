'use client'

import { useEffect } from 'react'

/**
 * 가로 오버플로 진단기 (콘솔 로그 전용).
 *
 * 실기기(아이폰)에서만 재현되는 "화면보다 살짝 넓은" 현상을 잡기 위한 도구.
 * 화면에는 아무것도 그리지 않고, Safari 웹 인스펙터(맥-아이폰 연결)에서 볼 수 있게
 * console 으로만 출력한다.
 *
 * 켜는 법:
 *   - URL 에 ?ovf=1 추가 → localStorage 'ive-ovf' = '1' 로 저장되어 이후에도 유지
 *   - 끄는 법: ?ovf=0
 *
 * 출력 내용:
 *   - 문서 가로 스크롤 가능 여부 (documentElement.scrollWidth vs clientWidth)
 *   - 뷰포트 오른쪽 경계를 넘어가는(또는 왼쪽 < 0) 엘리먼트 목록
 *     각 항목: 초과 px, 태그, id/class, rect, DOM 참조
 */
export default function DebugOverflow() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // 활성화 판단 (URL 파라미터 → localStorage 동기화)
    try {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('ovf')
      if (q === '1') localStorage.setItem('ive-ovf', '1')
      else if (q === '0') localStorage.removeItem('ive-ovf')
    } catch { /* ignore */ }

    let enabled = false
    try { enabled = localStorage.getItem('ive-ovf') === '1' } catch { /* ignore */ }
    if (!enabled) return

    const TAG = '[OVF]'

    function describe(el: Element): string {
      const tag = el.tagName.toLowerCase()
      const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : ''
      const cls = typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 6).join('.')
        : ''
      return `${tag}${id}${cls}`
    }

    function scan(label: string) {
      const docEl = document.documentElement
      // clientWidth: 스크롤바 제외한 실제 표시 너비 (모바일은 보통 == innerWidth)
      const vw = docEl.clientWidth
      const innerW = window.innerWidth
      const scrollW = docEl.scrollWidth
      const bodyScrollW = document.body.scrollWidth
      const overscroll = scrollW - vw

      console.log(
        `${TAG} ── scan (${label}) ──\n` +
        `  innerWidth=${innerW} docClientWidth=${vw} ` +
        `docScrollWidth=${scrollW} bodyScrollWidth=${bodyScrollW} ` +
        `→ 가로 초과=${overscroll}px ${overscroll > 0.5 ? '⚠️ 스크롤 발생' : 'OK'}`,
      )

      // 두 종류의 가로 오버플로를 한 번에 수집한다.
      //  (A) 박스 자체가 뷰포트(vw) 경계를 넘는 엘리먼트 (오른쪽 밖으로 삐져나옴)
      //  (B) 박스는 화면 안에 있지만 "내부 콘텐츠"가 가로로 넘쳐 스크롤되는 엘리먼트
      //      (scrollWidth > clientWidth). overflow-y-auto 는 CSS 상 overflow-x 도 auto 로
      //      승격되므로, 안쪽 콘텐츠가 살짝만 넓어도 그 컨테이너가 가로 스크롤된다.
      //      → "화면보다 약간 큰" 증상의 실제 정체. (A)로는 안 잡히는 사각지대.
      const offenders: { el: Element; r: DOMRect; over: number }[] = []
      const scrollers: { el: Element; sx: number; ox: string }[] = []
      const all = document.querySelectorAll('*')
      for (const el of Array.from(all)) {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const over = Math.max(r.right - vw, -r.left)
        if (over > 0.5) offenders.push({ el, r, over })
        const sx = el.scrollWidth - el.clientWidth
        if (sx > 1 && el.clientWidth > 0) scrollers.push({ el, sx, ox: cs.overflowX })
      }
      offenders.sort((a, b) => b.over - a.over)
      scrollers.sort((a, b) => b.sx - a.sx)

      // (A) 뷰포트 경계 초과
      if (offenders.length === 0) {
        console.log(`${TAG} (A) 뷰포트 경계 넘는 엘리먼트: 없음`)
      } else {
        console.log(`${TAG} (A) 뷰포트 경계 넘는 엘리먼트 ${offenders.length}개 (상위 15):`)
        offenders.slice(0, 15).forEach((o, i) => console.log(
          `${TAG}  A#${i + 1} +${o.over.toFixed(1)}px  ${describe(o.el)}\n` +
          `       left=${o.r.left.toFixed(1)} right=${o.r.right.toFixed(1)} width=${o.r.width.toFixed(1)} (vw=${vw})`,
          o.el,
        ))
      }

      // (B) 내부 가로 오버플로(스크롤 발생) — 이게 핵심 진단
      if (scrollers.length === 0) {
        console.log(`${TAG} (B) 내부 가로 오버플로(스크롤) 엘리먼트: 없음`)
      } else {
        console.log(`${TAG} (B) 내부 가로 오버플로 엘리먼트 ${scrollers.length}개 (넘침 큰 순, 상위 15):`)
        scrollers.slice(0, 15).forEach((s, i) => console.log(
          `${TAG}  B#${i + 1} 내부 +${s.sx}px  overflow-x:${s.ox}  ${describe(s.el)}\n` +
          `       clientWidth=${s.el.clientWidth} scrollWidth=${s.el.scrollWidth}`,
          s.el, // DOM 참조 — 인스펙터에서 클릭해 강조 가능
        ))
      }
    }

    // 초기 + 비동기 콘텐츠 로드 대비 지연 스캔, 리사이즈/회전 시 재스캔
    const t1 = window.setTimeout(() => scan('mount+500ms'), 500)
    const t2 = window.setTimeout(() => scan('mount+2000ms'), 2000)
    const onResize = () => scan('resize')
    const onOrient = () => window.setTimeout(() => scan('orientationchange'), 300)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrient)

    // 수동 재스캔용 전역 훅
    ;(window as unknown as { __ovfScan?: () => void }).__ovfScan = () => scan('manual')
    console.log(`${TAG} 활성화됨. 수동 재스캔: window.__ovfScan()  /  끄기: ?ovf=0`)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrient)
    }
  }, [])

  return null
}
