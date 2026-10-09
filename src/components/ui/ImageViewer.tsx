'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'

export interface ViewerImage {
  src: string
  alt?: string
}

interface Props {
  images: ViewerImage[]
  /** 처음 보여 줄 이미지 위치. null 이면 닫힘 */
  index: number | null
  onClose: () => void
  onIndexChange?: (index: number) => void
}

const MIN_SCALE = 1
const MAX_SCALE = 8
const STEP = 1.5
const DOUBLE_TAP_SCALE = 2.5
/** 아래로 끌어 닫기 — 이만큼 내리거나, 덜 내려도 빠르게 튕기면 닫는다 */
const PULL_CLOSE_PX = 120
const PULL_FLICK_PX = 40
const PULL_FLICK_SPEED = 0.6 // px/ms

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * 사진 보기 — 이미지만 화면 가득 띄우고 확대·이동해 볼 수 있다.
 * 휠·핀치·더블클릭(더블탭)·버튼으로 확대, 끌어서 이동, ←/→·밀기로 앞뒤 이미지, Esc·바깥 누르면 닫힘.
 * 확대하지 않은 상태에서 아래로 끌어내리면 닫힘 — 끄는 동안 이미지가 손가락을 따라 내려오고 바탕이 옅어진다.
 * 배율은 화면에 맞춘 크기를 100% 로 본다.
 */
export default function ImageViewer({ images, index, onClose, onIndexChange }: Props) {
  const t = useTranslations('common')
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  // 아래로 끌어 닫는 중 내려온 거리(px) — 0 이면 끌지 않는 중
  const [pullY, setPullY] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // 이벤트 처리기(창 키보드·휠)에서 최신 배율을 읽는 용도
  const viewRef = useRef(view)
  useLayoutEffect(() => { viewRef.current = view }, [view])
  // 진행 중인 포인터(마우스·손가락) — 2개면 핀치
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  // axis — 확대 안 한 상태에서 한 손가락으로 끌 때 처음 움직인 방향으로 고정(x: 앞뒤 넘기기, y: 끌어 닫기)
  const gesture = useRef<{ startX: number; startY: number; startT: number; viewX: number; viewY: number; moved: boolean; onImage: boolean; pinchDist: number; pinchScale: number; axis: 'x' | 'y' | null } | null>(null)
  const lastTap = useRef(0)

  const open = index !== null && images.length > 0
  const current = open ? images[clamp(index!, 0, images.length - 1)] : null
  const count = images.length

  // 이미지를 바꾸면(열고 닫기 포함) 배율·위치 초기화 — 렌더 중 이전 값과 비교해 바로 맞춘다
  const [shownIndex, setShownIndex] = useState(index)
  if (shownIndex !== index) {
    setShownIndex(index)
    setView({ scale: 1, x: 0, y: 0 })
    setPullY(0)
  }

  // 열린 동안 뒤 화면 스크롤 막기 — 모달 안에서 열 수도 있어 닫을 때 원래 값으로 되돌린다
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  /** 화면 점(clientX, clientY)을 고정한 채로 배율을 바꾼다 */
  const zoomAt = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current
    setView(v => {
      const s = clamp(nextScale, MIN_SCALE, MAX_SCALE)
      if (s === MIN_SCALE) return { scale: 1, x: 0, y: 0 }
      if (!stage || clientX === undefined || clientY === undefined) {
        const r = s / v.scale
        return { scale: s, x: v.x * r, y: v.y * r }
      }
      const rect = stage.getBoundingClientRect()
      const px = clientX - (rect.left + rect.width / 2)
      const py = clientY - (rect.top + rect.height / 2)
      const r = s / v.scale
      return { scale: s, x: px - (px - v.x) * r, y: py - (py - v.y) * r }
    })
  }, [])

  const go = useCallback((delta: number) => {
    if (index === null || count < 2) return
    onIndexChange?.((index + delta + count) % count)
  }, [index, count, onIndexChange])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === '+' || e.key === '=') zoomAt(viewRef.current.scale * STEP)
      else if (e.key === '-') zoomAt(viewRef.current.scale / STEP)
      else if (e.key === '0') setView({ scale: 1, x: 0, y: 0 })
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // 캡처 단계 — 뒤에 깔린 모달·화면의 키 처리보다 먼저 받아 사진 보기에서만 쓴다
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose, go, zoomAt])

  // 휠 확대 — React onWheel 은 passive 라 preventDefault 가 안 먹어 직접 붙인다
  useEffect(() => {
    const stage = stageRef.current
    if (!open || !stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // 줄 단위 휠(Firefox)은 픽셀로 환산, 트랙패드 핀치(ctrlKey)는 값이 작아 더 민감하게
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002))
      zoomAt(viewRef.current.scale * factor, e.clientX, e.clientY)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open, zoomAt])

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return
    // 포인터 캡처 뒤로는 이벤트 대상이 무대로 바뀐다 — 이미지 위에서 눌렀는지는 지금 기록해 둔다
    const onImage = !!imgRef.current?.contains(e.target as Node)
    stageRef.current?.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const v = viewRef.current
    const pts = [...pointers.current.values()]
    gesture.current = {
      startX: e.clientX, startY: e.clientY, startT: Date.now(), viewX: v.x, viewY: v.y,
      moved: gesture.current?.moved ?? false,
      // 두 번째 손가락이 닿으면 핀치 — 끌어 닫기는 그만둔다
      axis: pts.length === 1 ? null : 'x',
      onImage: gesture.current?.onImage ?? onImage,
      pinchDist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      pinchScale: v.scale,
    }
    if (pts.length === 1) { gesture.current.moved = false; gesture.current.onImage = onImage }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2 && g.pinchDist > 0) {
      g.moved = true
      setPullY(0)
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      zoomAt(g.pinchScale * dist / g.pinchDist, (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2)
      return
    }
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.moved && Math.hypot(dx, dy) > 4) {
      g.moved = true
      setDragging(true)
      if (g.axis === null) g.axis = dy > 0 && Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
    }
    if (g.moved && viewRef.current.scale > 1) setView(v => ({ ...v, x: g.viewX + dx, y: g.viewY + dy }))
    else if (g.moved && g.axis === 'y') setPullY(Math.max(0, dy))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    const wasPinch = pointers.current.size === 2
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) {
      setPullY(0)
      // 핀치에서 한 손가락만 남음 — 남은 손가락 기준으로 이동을 이어 간다
      const [rest] = [...pointers.current.values()]
      const v = viewRef.current
      if (g) gesture.current = { ...g, startX: rest.x, startY: rest.y, viewX: v.x, viewY: v.y, pinchDist: 0, pinchScale: v.scale }
      return
    }
    gesture.current = null
    setDragging(false)
    if (!g || wasPinch) return
    const dx = e.clientX - g.startX
    if (g.moved && g.axis === 'y' && viewRef.current.scale === 1) {
      // 아래로 끌어 닫기 — 충분히 내렸거나 빠르게 튕겼으면 닫고, 아니면 제자리로 돌아간다
      const dy = Math.max(0, e.clientY - g.startY)
      const speed = dy / Math.max(1, Date.now() - g.startT)
      setPullY(0)
      if (dy > PULL_CLOSE_PX || (dy > PULL_FLICK_PX && speed > PULL_FLICK_SPEED)) onClose()
      return
    }
    if (g.moved) {
      // 확대 안 한 상태에서 옆으로 밀면 앞뒤 이미지
      if (viewRef.current.scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - g.startY)) go(dx < 0 ? 1 : -1)
      return
    }
    const onImage = g.onImage
    const now = Date.now()
    if (onImage && now - lastTap.current < 300) {
      // 더블클릭·더블탭 — 확대/원래대로
      lastTap.current = 0
      if (viewRef.current.scale > 1) setView({ scale: 1, x: 0, y: 0 })
      else zoomAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY)
      return
    }
    lastTap.current = onImage ? now : 0
    // 이미지 바깥(검은 바탕)을 누르면 닫힘
    if (!onImage) onClose()
  }

  // 사용자가 눌러야 열리므로 열린 상태는 늘 브라우저 — 서버 렌더에서는 닫혀 있어 document 를 건드리지 않는다
  if (!open || !current) return null

  const btn = 'w-10 h-10 flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none'

  // 포털이어도 React 이벤트는 부모 컴포넌트로 거슬러 올라간다 — 노트 접기 등 바깥 클릭 처리가 같이 돌지 않게 막는다
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  // 끌어 내리는 만큼 바탕·도구줄이 옅어진다(0.9 → 0.3)
  const pullFade = Math.min(pullY / 300, 1)

  return createPortal(
    <div onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onTouchEnd={stop} onDoubleClick={stop} onContextMenu={stop}
      style={{ backgroundColor: `rgba(0, 0, 0, ${0.9 - 0.6 * pullFade})` }}
      className="fixed inset-0 z-[60] flex flex-col select-none" role="dialog" aria-modal="true" aria-label={t('imageViewer.title')}>
      <div className="flex items-center gap-1 px-2 py-2 shrink-0 text-white/80 text-sm" style={pullY ? { opacity: 1 - pullFade } : undefined}>
        <span className="px-2 font-bold tabular-nums min-w-0 truncate">
          {count > 1 && <span className="mr-3">{clamp(index!, 0, count - 1) + 1} / {count}</span>}
          <span className="text-white/60">{Math.round(view.scale * 100)}%</span>
        </span>
        <div className="flex-1" />
        <button type="button" className={btn} onClick={() => zoomAt(view.scale / STEP)} disabled={view.scale <= MIN_SCALE} title={t('imageViewer.zoomOut')} aria-label={t('imageViewer.zoomOut')}>
          <i className="fa-solid fa-magnifying-glass-minus" />
        </button>
        <button type="button" className={btn} onClick={() => zoomAt(view.scale * STEP)} disabled={view.scale >= MAX_SCALE} title={t('imageViewer.zoomIn')} aria-label={t('imageViewer.zoomIn')}>
          <i className="fa-solid fa-magnifying-glass-plus" />
        </button>
        <button type="button" className={btn} onClick={() => setView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === 1} title={t('imageViewer.fit')} aria-label={t('imageViewer.fit')}>
          <i className="fa-solid fa-compress" />
        </button>
        <a href={current.src} target="_blank" rel="noopener noreferrer" className={btn} title={t('imageViewer.openOriginal')} aria-label={t('imageViewer.openOriginal')}>
          <i className="fa-solid fa-arrow-up-right-from-square" />
        </a>
        <button type="button" className={btn} onClick={onClose} title={t('close')} aria-label={t('close')}>
          <i className="fa-solid fa-xmark text-xl" />
        </button>
      </div>

      <div
        ref={stageRef}
        className={`relative flex-1 min-h-0 flex items-center justify-center overflow-hidden touch-none p-2 desk:p-6 ${view.scale > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          key={current.src}
          src={current.src}
          alt={current.alt || ''}
          draggable={false}
          className={`max-w-full max-h-full object-contain ${dragging ? '' : 'transition-transform duration-150'}`}
          style={{ transform: `translate(${view.x}px, ${view.y + pullY}px) scale(${view.scale * (1 - 0.15 * pullFade)})` }}
        />

        {count > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} className={`${btn} absolute left-2 top-1/2 -translate-y-1/2 bg-black/40`} title={t('previous')} aria-label={t('previous')}>
              <i className="fa-solid fa-chevron-left" />
            </button>
            <button type="button" onClick={() => go(1)} className={`${btn} absolute right-2 top-1/2 -translate-y-1/2 bg-black/40`} title={t('next')} aria-label={t('next')}>
              <i className="fa-solid fa-chevron-right" />
            </button>
          </>
        )}
      </div>

      {current.alt && (
        <div className="shrink-0 px-4 py-2 text-center text-sm text-white/70 truncate">{current.alt}</div>
      )}
    </div>,
    document.body,
  )
}
