'use client'

import { useRef, useEffect, useState } from 'react'

interface Props {
  data: (number | null)[]
  width?: number | '100%'
  height?: number
  color?: 'auto' | 'green' | 'red' | 'gray' | 'cyan' | 'amber'
  className?: string
}

const COLORS = {
  green: '#4ade80',
  red: '#f87171',
  gray: '#6b7280',
  cyan: '#22d3ee',
  amber: '#fbbf24',
}

export default function Sparkline({ data, width = 48, height = 16, color = 'auto', className }: Props) {
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

  // non-null 값만 추출해서 최소 2개 필요
  const validData = data.filter((v): v is number => v !== null)
  if (!data || validData.length < 2) {
    if (isFluid) return <div ref={containerRef} className={className} style={{ width: '100%', height }} />
    return <svg width={width as number} height={height} className={className} />
  }

  const w = isFluid ? measuredWidth : (width as number)
  const totalSlots = data.length

  const min = Math.min(...validData)
  const max = Math.max(...validData)
  const range = max - min || 1
  const padding = 1

  // 추세 판별: non-null 값 기준 전반/후반
  const mid = Math.floor(validData.length / 2)
  const firstHalf = validData.slice(0, mid)
  const secondHalf = validData.slice(mid)
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
  const diff = avgSecond - avgFirst

  let lineColor: string
  if (color === 'auto') {
    if (Math.abs(diff) < range * 0.1) lineColor = COLORS.gray
    else if (diff > 0) lineColor = COLORS.green
    else lineColor = COLORS.red
  } else {
    lineColor = COLORS[color]
  }

  // 전체 슬롯 기준으로 x좌표 계산하되, null인 곳은 건너뜀
  // 연속된 non-null 구간을 세그먼트로 분할
  type Pt = { x: number; y: number }
  const segments: Pt[][] = []
  let current: Pt[] = []

  for (let i = 0; i < totalSlots; i++) {
    const v = data[i]
    const x = padding + (i / (totalSlots - 1)) * (w - padding * 2)
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

  const bottomY = height - padding

  const svg = (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={isFluid ? { display: 'block', width: '100%' } : undefined}>
      {segments.map((seg, si) => {
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
