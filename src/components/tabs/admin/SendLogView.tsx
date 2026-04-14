'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateFull } from '@/lib/format-date'

interface SendLogEntry {
  id: string; scheduleId: string; reportType: string
  periodStart: string; periodEnd: string; recipientEmail: string
  status: string; errorMessage?: string | null; sentAt: string
}

export default function SendLogView() {
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const tr = useTranslations('report')
  const [logs, setLogs] = useState<SendLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  async function fetchLogs(p: number = 0) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/reports/logs?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs)
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLogs(page) }, [page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (loading && logs.length === 0) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  if (total === 0) {
    return (
      <div className="text-center py-10">
        <i className="fa-solid fa-inbox text-3xl text-ive-text-dim mb-3 block" />
        <p className="text-sm text-ive-text-dim">{t('noSendHistory')}</p>
      </div>
    )
  }

  const typeLabel = (type: string) => tr(type as any)

  return (
    <div>
      <div className="text-xs text-ive-text-dim mb-3">{t('totalSendLogs', { count: total })}</div>

      <div className="space-y-1.5">
        {logs.map(log => (
          <div key={log.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.status === 'success' ? 'bg-ive-green' : 'bg-ive-red'}`} />
              <span className="text-xs font-bold text-ive-text">{typeLabel(log.reportType)}</span>
              <span className="text-xs text-ive-text-dim flex-1 truncate">{log.recipientEmail}</span>
              <span className={`text-xs font-bold ${log.status === 'success' ? 'text-ive-green' : 'text-ive-red'}`}>
                {log.status === 'success' ? t('statusSuccess') : t('statusFailed')}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-ive-text-dim">
              <span>{log.periodStart} ~ {new Date(new Date(log.periodEnd).getTime() - 86400000).toISOString().slice(0, 10)}</span>
              <span className="ml-auto">{formatDateFull(log.sentAt, userLocale, userTz)}</span>
            </div>
            {log.errorMessage && (
              <div className="mt-1 text-xs text-ive-red bg-ive-red/5 rounded px-2 py-1 break-all">
                {log.errorMessage}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="w-8 h-8 rounded-lg bg-ive-bg-deep text-ive-text-dim text-xs disabled:opacity-30">
            <i className="fa-solid fa-chevron-left" />
          </button>
          <span className="text-xs text-ive-text-dim">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="w-8 h-8 rounded-lg bg-ive-bg-deep text-ive-text-dim text-xs disabled:opacity-30">
            <i className="fa-solid fa-chevron-right" />
          </button>
        </div>
      )}
    </div>
  )
}
