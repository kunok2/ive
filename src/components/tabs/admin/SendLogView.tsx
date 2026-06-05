'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateFull } from '@/lib/format-date'
import Modal from '@/components/ui/Modal'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

interface ReportLogEntry {
  id: string; scheduleId: string; reportType: string
  periodStart: string; periodEnd: string; recipientEmail: string
  status: string; errorMessage?: string | null; sentAt: string
}

interface MailLogSummary {
  id: string
  senderUserId: string | null
  senderName: string | null
  senderEmail: string | null
  subject: string
  bodyLength: number
  recipientEmails: string[]
  totalCount: number
  sentCount: number
  failedCount: number
  failedRecipients: { email: string; error?: string }[]
  sentAt: string
  clickCount: number
  clickUserCount: number
}

interface MailLogDetail extends Omit<MailLogSummary, 'bodyLength' | 'clickCount' | 'clickUserCount'> {
  body: string
}

interface ClickStat {
  userId: string | null
  email: string | null
  name: string | null
  avatar: string | null
  count: number
  firstAt: string
  lastAt: string
}

type LogKind = 'mail' | 'report'

export default function SendLogView() {
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const tr = useTranslations('report')
  const { confirm } = useDialog()
  const { toast } = useToast()

  const [kind, setKind] = useState<LogKind>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('admin-mail-log-kind')
      if (saved === 'mail' || saved === 'report') return saved
    }
    return 'mail'
  })

  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  // 보고서
  const [reportLogs, setReportLogs] = useState<ReportLogEntry[]>([])
  const [reportTotal, setReportTotal] = useState(0)
  // 메일
  const [mailLogs, setMailLogs] = useState<MailLogSummary[]>([])
  const [mailTotal, setMailTotal] = useState(0)

  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<MailLogDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showHtml, setShowHtml] = useState(true)
  // IVE 접속(클릭) 사용자별 통계 모달
  const [clickStats, setClickStats] = useState<{ subject: string; stats: ClickStat[]; totalClicks: number; userCount: number } | null>(null)
  const [clickLoading, setClickLoading] = useState(false)

  function handleSetKind(k: LogKind) {
    setKind(k)
    setPage(0)
    localStorage.setItem('admin-mail-log-kind', k)
  }

  async function fetchLogs(p: number = 0) {
    setLoading(true)
    try {
      if (kind === 'report') {
        const res = await fetch(`/api/admin/reports/logs?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`)
        if (res.ok) {
          const data = await res.json()
          setReportLogs(data.logs)
          setReportTotal(data.total)
        }
      } else {
        const res = await fetch(`/api/admin/mail/logs?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`)
        if (res.ok) {
          const data = await res.json()
          setMailLogs(data.logs)
          setMailTotal(data.total)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLogs(page) }, [page, kind])

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/mail/logs/${id}`)
      if (res.ok) {
        const data = await res.json()
        setDetail(data.log)
        setShowHtml(true)
      } else {
        toast(t('detailLoadFailed'), 'error')
      }
    } finally {
      setDetailLoading(false)
    }
  }

  async function openClickStats(log: { id: string; subject: string }) {
    setClickLoading(true)
    try {
      const res = await fetch(`/api/admin/mail/logs/${log.id}/clicks`)
      if (res.ok) {
        const data = await res.json()
        setClickStats({ subject: log.subject, stats: data.stats, totalClicks: data.totalClicks, userCount: data.userCount })
      } else {
        toast(t('detailLoadFailed'), 'error')
      }
    } finally {
      setClickLoading(false)
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: t('deleteLogTitle'),
      message: t('deleteLogConfirm'),
      confirmText: tc('delete'),
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`/api/admin/mail/logs/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast(t('deleted'), 'success')
      setDetail(null)
      fetchLogs(page)
    } else {
      toast(t('deleteFailed'), 'error')
    }
  }

  const total = kind === 'report' ? reportTotal : mailTotal
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const typeLabel = (type: string) => tr(type as any)

  return (
    <div>
      {/* Kind 토글 */}
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={() => handleSetKind('mail')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
            kind === 'mail'
              ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
              : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'
          }`}
        >
          <i className="fa-solid fa-paper-plane mr-1" />{t('mailSendLogs')}
        </button>
        <button
          onClick={() => handleSetKind('report')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
            kind === 'report'
              ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
              : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'
          }`}
        >
          <i className="fa-solid fa-file-lines mr-1" />{t('reportSendLogs')}
        </button>
      </div>

      {loading && total === 0 ? (
        <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>
      ) : total === 0 ? (
        <div className="text-center py-10">
          <i className="fa-solid fa-inbox text-3xl text-ive-text-dim mb-3 block" />
          <p className="text-sm text-ive-text-dim">{t('noSendHistory')}</p>
        </div>
      ) : (
        <>
          <div className="text-xs text-ive-text-dim mb-3">{t('totalSendLogs', { count: total })}</div>

          <div className="space-y-1.5">
            {kind === 'report' ? (
              reportLogs.map(log => (
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
              ))
            ) : (
              mailLogs.map(log => {
                const allOk = log.failedCount === 0
                return (
                  <button
                    key={log.id}
                    onClick={() => openDetail(log.id)}
                    className="w-full text-left bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5 active:scale-[0.99] transition-transform hover:border-ive-border"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${allOk ? 'bg-ive-green' : 'bg-ive-amber'}`} />
                      <span className="text-xs font-bold text-ive-text flex-1 truncate">{log.subject}</span>
                      <span className={`text-xs font-bold ${allOk ? 'text-ive-green' : 'text-ive-amber'}`}>
                        {log.sentCount}/{log.totalCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-ive-text-dim">
                      <span className="truncate flex-1">{log.senderName || log.senderEmail || '-'}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); openClickStats(log) }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); openClickStats(log) } }}
                        title={t('viewAccessStats')}
                        className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border font-bold transition-colors ${
                          log.clickCount > 0
                            ? 'bg-ive-cyan/10 text-ive-cyan border-ive-cyan/30 hover:bg-ive-cyan/20'
                            : 'bg-ive-bg-deep text-ive-text-dim border-ive-border-subtle hover:border-ive-border'
                        }`}
                      >
                        <i className="fa-solid fa-arrow-pointer" />{t('accessCount', { count: log.clickCount })}
                      </span>
                      <span className="shrink-0">{formatDateFull(log.sentAt, userLocale, userTz)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

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
        </>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 pointer-events-none">
          <i className="fa-solid fa-circle-notch fa-spin text-2xl text-white" />
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('mailLogDetailTitle')}>
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-ive-text-dim font-bold mb-1">{t('sender')}</div>
                <div className="text-ive-text break-words">{detail.senderName || '-'}{detail.senderEmail && <span className="text-ive-text-dim ml-1">({detail.senderEmail})</span>}</div>
              </div>
              <div>
                <div className="text-ive-text-dim font-bold mb-1">{t('sentAt')}</div>
                <div className="text-ive-text">{formatDateFull(detail.sentAt, userLocale, userTz)}</div>
              </div>
              <div>
                <div className="text-ive-text-dim font-bold mb-1">{t('totalRecipients')}</div>
                <div className="text-ive-text">{detail.totalCount}</div>
              </div>
              <div>
                <div className="text-ive-text-dim font-bold mb-1">{t('result')}</div>
                <div>
                  <span className="text-ive-green font-bold">{t('successCount', { count: detail.sentCount })}</span>
                  {detail.failedCount > 0 && <span className="text-ive-red font-bold ml-2">{t('failedCount', { count: detail.failedCount })}</span>}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs text-ive-text-dim font-bold mb-1">{t('subject')}</div>
              <div className="text-sm text-ive-text font-bold break-words bg-ive-bg-deep rounded-lg px-3 py-2">{detail.subject}</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-ive-text-dim font-bold">{t('contentHtml')}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setShowHtml(true)}
                    className={`text-xs px-2 py-0.5 rounded-lg font-bold ${showHtml ? 'bg-ive-cyan/15 text-ive-cyan border border-ive-cyan/30' : 'text-ive-text-dim border border-ive-border-subtle'}`}
                  >
                    {t('preview')}
                  </button>
                  <button
                    onClick={() => setShowHtml(false)}
                    className={`text-xs px-2 py-0.5 rounded-lg font-bold ${!showHtml ? 'bg-ive-cyan/15 text-ive-cyan border border-ive-cyan/30' : 'text-ive-text-dim border border-ive-border-subtle'}`}
                  >
                    {t('source')}
                  </button>
                </div>
              </div>
              {showHtml ? (
                <div
                  className="bg-white text-black rounded-lg p-4 text-sm border border-ive-border-subtle break-words overflow-x-auto max-h-72 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: detail.body }}
                />
              ) : (
                <pre className="bg-ive-bg-deep text-ive-text rounded-lg p-3 text-xs border border-ive-border-subtle overflow-x-auto whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{detail.body}</pre>
              )}
            </div>

            <div>
              <div className="text-xs text-ive-text-dim font-bold mb-1">{t('recipients')} ({detail.recipientEmails.length})</div>
              <div className="bg-ive-bg-deep rounded-lg p-2 max-h-32 overflow-y-auto text-xs text-ive-text-dim space-y-0.5">
                {detail.recipientEmails.map((e, i) => {
                  const failed = detail.failedRecipients.find(fr => fr.email === e)
                  return (
                    <div key={i} className={failed ? 'text-ive-red' : ''}>
                      {failed ? <i className="fa-solid fa-circle-xmark mr-1" /> : <i className="fa-solid fa-circle-check mr-1 text-ive-green" />}
                      {e}{failed?.error && <span className="ml-1 text-ive-red/80">— {failed.error}</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { const d = detail; setDetail(null); openClickStats({ id: d.id, subject: d.subject }) }}
                className="flex-1 py-2 rounded-lg bg-ive-cyan/10 text-ive-cyan border border-ive-cyan/30 text-xs font-bold active:scale-[0.98]"
              >
                <i className="fa-solid fa-arrow-pointer mr-1" />{t('accessStatsTitle')}
              </button>
              <button
                onClick={() => handleDelete(detail.id)}
                className="flex-1 py-2 rounded-lg bg-ive-red/10 text-ive-red border border-ive-red/30 text-xs font-bold active:scale-[0.98]"
              >
                <i className="fa-solid fa-trash mr-1" />{tc('delete')}
              </button>
              <button
                onClick={() => setDetail(null)}
                className="flex-1 py-2 rounded-lg bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle text-xs font-bold active:scale-[0.98]"
              >
                {tc('close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {clickLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 pointer-events-none">
          <i className="fa-solid fa-circle-notch fa-spin text-2xl text-white" />
        </div>
      )}

      <Modal open={!!clickStats} onClose={() => setClickStats(null)} title={t('accessStatsTitle')}>
        {clickStats && (
          <div className="space-y-3">
            <div className="text-sm text-ive-text font-bold break-words bg-ive-bg-deep rounded-lg px-3 py-2">{clickStats.subject}</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ive-cyan/10 text-ive-cyan border border-ive-cyan/30 font-bold">
                <i className="fa-solid fa-arrow-pointer" />{t('accessTotalClicks', { count: clickStats.totalClicks })}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle font-bold">
                <i className="fa-solid fa-user" />{t('accessUserCount', { count: clickStats.userCount })}
              </span>
            </div>

            {clickStats.stats.length === 0 ? (
              <div className="text-center py-8 text-ive-text-dim text-sm">
                <i className="fa-solid fa-arrow-pointer text-2xl mb-2 block opacity-50" />{t('noAccessYet')}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {clickStats.stats.map((s, i) => (
                  <div key={s.userId || s.email || i} className="flex items-center gap-2 bg-ive-bg-deep rounded-lg px-2.5 py-2">
                    <AgentAvatar avatar={s.avatar || 'av-01'} userId={s.userId} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-ive-text truncate">{s.name || s.email || '-'}</div>
                      {s.name && s.email && <div className="text-[11px] text-ive-text-dim truncate">{s.email}</div>}
                      <div className="text-[11px] text-ive-text-dim">{t('accessLastAt')}: {formatDateFull(s.lastAt, userLocale, userTz)}</div>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ive-cyan/10 text-ive-cyan border border-ive-cyan/30 text-xs font-bold">
                      {t('accessTimesCount', { count: s.count })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setClickStats(null)}
              className="w-full py-2 rounded-lg bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle text-xs font-bold active:scale-[0.98]"
            >
              {tc('close')}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
