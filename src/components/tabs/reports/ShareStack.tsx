'use client'

import { useTranslations } from 'next-intl'

// 고유색이 없는 항목용 팔레트 (브랜드 시안 우선 + 구분 가능한 색)
const PALETTE = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#facc15']
const OTHER_COLOR = '#52525b' // ive-text-dim
const MAX = 7

export interface ShareDatum {
  id: string
  name: string
  value: number
  color?: string  // 고유색(프로젝트 등). 없으면 팔레트 순서대로 배정
}

/**
 * 전체 대비 "비중"을 한 줄 누적 막대 + 범례로 표시한다.
 * 카드별 채움 막대(=진행률처럼 보임) 대신, 부분의 합=전체임이 한눈에 보이는 분배 막대.
 * value 내림차순 → 상위 MAX + 나머지는 '기타'로 묶음. 항목 1개거나 합 0이면 숨김.
 */
export default function ShareStack({ title, data }: { title: string; data: ShareDatum[] }) {
  const tr = useTranslations('report')
  const valued = data.filter(d => d.value > 0).sort((a, b) => b.value - a.value)
  const total = valued.reduce((s, d) => s + d.value, 0)
  if (valued.length < 2 || total <= 0) return null

  const head = valued.slice(0, MAX).map((d, i) => ({ ...d, color: d.color || PALETTE[i % PALETTE.length] }))
  const rest = valued.slice(MAX)
  const items = rest.length > 0
    ? [...head, { id: '__other__', name: tr('distOthers', { count: rest.length }), value: rest.reduce((s, d) => s + d.value, 0), color: OTHER_COLOR }]
    : head

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5 mb-2">
      <div className="text-[10px] font-bold text-ive-text-dim uppercase tracking-wider mb-2">{title}</div>
      <div className="flex h-2 rounded-full overflow-hidden bg-ive-bg-deep gap-px">
        {items.map(it => (
          <div key={it.id} style={{ width: `${(it.value / total) * 100}%`, backgroundColor: it.color }} title={it.name} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
        {items.map(it => (
          <span key={it.id} className="flex items-center gap-1.5 text-ive-text-secondary font-bold">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
            <span className="truncate max-w-[120px]">{it.name}</span>
            <span className="text-ive-text-dim">{Math.round((it.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}
