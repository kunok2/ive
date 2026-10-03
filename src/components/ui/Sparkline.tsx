'use client'

import { useRef, useEffect, useState } from 'react'

interface Props {
  data: (number | null)[]
  bgData?: (number | null)[]
  width?: number | '100%'
  height?: number
  /**
   * 색 정책 (DESIGN_GUIDE 준수):
   *   - 기본값 'cyan': 단순 측정값. 모든 sparkline의 기본.
   *   - 'amber': 사용자 행동/주의 필요한 신호 (예: 임계 초과 상태)
   *   - 'red': 위험/실패
   *   - 'gray': 비교용 보조 시리즈
   *   - 'auto': 추세 의미가 명확할 때만 (긍정 맥락: 증가↑=cyan, 감소↓=red)
   */
  color?: 'cyan' | 'amber' | 'red' | 'gray' | 'verify' | 'confirm' | 'auto'
  className?: string
}

// 모든 색은 디자인 토큰 CSS 변수 참조.
const COLORS = {
  cyan:  'var(--color-ive-cyan)',
  amber: 'var(--color-ive-amber)',
  red:   'var(--color-ive-red)',
  gray:  'var(--color-ive-text-muted)',
  verify: 'var(--color-ive-stage-verify)',
  confirm: 'var(--color-ive-stage-confirm)',
}

function buildSegments(
  data: (number | null)[],
  w: number,
  height: number,
  min: number,
  range: number,
  padding: number,
) {
  type Pt = { x: number; y: number }
  const segments: Pt[][] = []
  let current: Pt[] = []
  const totalSlots = data.length

  for (let i = 0; i < totalSlots; i++) {
    const v = data[i]
    const x = totalSlots <= 1 ? w / 2 : padding + (i / (totalSlots - 1)) * (w - padding * 2)
    if (v !== null) {
      const y = padding + (1 - (v - min) / range) * (height - padding * 2)
      current.push({ x, y })
    } else {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}

export default function Sparkline({ data, bgData, width = 48, height = 16, color = 'cyan', className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(typeof width === 'number' ? width : 120)
  const isFluid = width === '100%'

  useEffect(() => {
    if (!isFluid || !containerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setMeasuredWidth(Math.round(entry.contentRect.width))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [isFluid])

  // non-null 값만 추출해서 최소 1개 필요
  const validData = data.filter((v): v is number => v !== null)
  if (!data || validData.length < 1) {
    if (isFluid) return <div ref={containerRef} className={className} style={{ width: '100%', height }} />
    return <svg width={width as number} height={height} className={className} />
  }

  const w = isFluid ? measuredWidth : (width as number)
  const padding = 1

  // bgData가 있으면 min/max를 합산해서 동일 스케일 사용
  const validBgData = bgData?.filter((v): v is number => v !== null) ?? []
  const allValid = [...validData, ...validBgData]
  const min = Math.min(...allValid)
  const max = Math.max(...allValid)
  const range = max - min || 1

  // 추세 판별: non-null 값 기준 전반/후반 (1개일 때는 추세 없음)
  const mid = Math.floor(validData.length / 2)
  const firstHalf = validData.slice(0, mid)
  const secondHalf = validData.slice(mid)
  const avgFirst = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0
  const avgSecond = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0
  const diff = validData.length < 2 ? 0 : avgSecond - avgFirst

  let lineColor: string
  if (color === 'auto') {
    // 긍정 맥락 추세: 증가=cyan(좋음), 감소=red(나쁨), 미미=gray
    if (Math.abs(diff) < range * 0.1) lineColor = COLORS.gray
    else if (diff > 0) lineColor = COLORS.cyan
    else lineColor = COLORS.red
  } else {
    lineColor = COLORS[color]
  }

  const segments = buildSegments(data, w, height, min, range, padding)
  const bgSegments = bgData && validBgData.length >= 1
    ? buildSegments(bgData, w, height, min, range, padding)
    : null

  const bottomY = height - padding

  const svg = (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={isFluid ? { display: 'block', width: '100%' } : undefined}>
      {/* 배경: 이전 기간 데이터 */}
      {bgSegments?.map((seg, si) => {
        if (seg.length === 1) {
          return <circle key={`bg-${si}`} cx={seg[0].x} cy={seg[0].y} r={1.5} fill={lineColor} opacity={0.25} />
        }
        if (seg.length < 2) return null
        const linePoints = seg.map(p => `${p.x},${p.y}`).join(' ')
        return (
          <polyline
            key={`bg-${si}`}
            points={linePoints}
            fill="none"
            stroke={lineColor}
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2,2"
            opacity={0.25}
          />
        )
      })}
      {/* 전경: 현재 기간 데이터 */}
      {segments.map((seg, si) => {
        if (seg.length === 1) {
          return <circle key={si} cx={seg[0].x} cy={seg[0].y} r={2} fill={lineColor} />
        }
        if (seg.length < 2) return null
        const linePoints = seg.map(p => `${p.x},${p.y}`).join(' ')
        const areaPoints = `${seg[0].x},${bottomY} ${linePoints} ${seg[seg.length - 1].x},${bottomY}`
        return (
          <g key={si}>
            <polygon
              points={areaPoints}
              fill={lineColor}
              fillOpacity={0.15}
            />
            <polyline
              points={linePoints}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )
      })}
    </svg>
  )

  if (isFluid) {
    return (
      <div ref={containerRef} className={className} style={{ width: '100%', height }}>
        {measuredWidth > 0 && svg}
      </div>
    )
  }

  return svg
}
