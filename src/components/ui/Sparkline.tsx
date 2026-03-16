'use client'

interface Props {
  data: number[]
  width?: number
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
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} />
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const padding = 1

  // 추세 판별: 후반부 평균 vs 전반부 평균
  const mid = Math.floor(data.length / 2)
  const firstHalf = data.slice(0, mid)
  const secondHalf = data.slice(mid)
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

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = padding + (1 - (v - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')

  // 영역 채우기용 폴리곤
  const firstPoint = `${padding},${height - padding}`
  const lastPoint = `${padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2)},${height - padding}`
  const areaPoints = `${firstPoint} ${points} ${lastPoint}`

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`}>
      <polygon
        points={areaPoints}
        fill={lineColor}
        fillOpacity={0.15}
      />
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
