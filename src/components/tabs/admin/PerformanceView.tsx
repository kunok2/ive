'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateFull } from '@/lib/format-date'

interface PerfRow {
  kind: 'mail' | 'social'
  id: string
  title: string
  createdAt: string
  clicks: number
  unique: number
  conversions: number | null
}

export default function PerformanceView() {
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('admin')
  const tc = useTranslations('common')

  const [rows, setRows] = useState<PerfRow[]>([])
  const [totals, setTotals] = useState<{ clicks: number; conversions: number }>({ clicks: 0, conversions: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/admin/promotion/performance?limit=200')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setRows(d.rows); setTotals(d.totals) } })
      .finally(() => setLoading(false))
  }, [])

  if (loading && rows.length === 0) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  return (
    <div>
      {/* 합계 카드 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-ive-text-dim font-bold">{t('perfTotalClicks')}</div>
          <div className="text-lg font-bold text-ive-cyan"><i className="fa-solid fa-arrow-pointer text-sm mr-1" />{totals.clicks}</div>
        </div>
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-ive-text-dim font-bold">{t('perfTotalConversions')}</div>
          <div className="text-lg font-bold text-ive-green"><i className="fa-solid fa-user-plus text-sm mr-1" />{totals.conversions}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10">
          <i className="fa-solid fa-chart-simple text-3xl text-ive-text-dim mb-3 block" />
          <p className="text-sm text-ive-text-dim">{t('perfEmpty')}</p>
        </div>
      ) : (
        <>
          {/* 헤더 */}
          <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold text-ive-text-dim uppercase">
            <span className="flex-1">{t('perfCampaign')}</span>
            <span className="w-10 text-right" title={t('perfClicks')}><i className="fa-solid fa-arrow-pointer" /></span>
            <span className="w-10 text-right" title={t('perfUnique')}><i className="fa-solid fa-user" /></span>
            <span className="w-10 text-right" title={t('perfConversions')}><i className="fa-solid fa-user-plus" /></span>
          </div>
          <div className="space-y-1">
            {rows.map(r => (
              <div key={`${r.kind}-${r.id}`} className="flex items-center gap-2 bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2">
                <span className={`shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] ${r.kind === 'mail' ? 'bg-ive-amber/15 text-ive-amber' : 'bg-ive-cyan/15 text-ive-cyan'}`}>
                  <i className={`fa-solid ${r.kind === 'mail' ? 'fa-envelope' : 'fa-share-nodes'}`} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-ive-text truncate">{r.title}</div>
                  <div className="text-[10px] text-ive-text-dim">{formatDateFull(r.createdAt, userLocale, userTz)}</div>
                </div>
                <span className="w-10 text-right text-xs font-bold text-ive-cyan">{r.clicks}</span>
                <span className="w-10 text-right text-xs font-bold text-ive-text-dim">{r.unique}</span>
                <span className="w-10 text-right text-xs font-bold text-ive-green">{r.conversions == null ? '—' : r.conversions}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-ive-text-dim mt-3 leading-relaxed">{t('perfNote')}</p>
        </>
      )}
    </div>
  )
}
