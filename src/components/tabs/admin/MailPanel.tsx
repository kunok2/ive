'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { User } from '@/types'
import { useStore } from '@/lib/store'
import { formatDateFull } from '@/lib/format-date'
import { useDialog } from '@/components/ui/ConfirmDialog'

// ── Mail Panel ──
type MailSubView = 'broadcast' | 'reports' | 'logs'

interface ReportScheduleState {
  id: string; reportType: string; enabled: boolean
  recipients: string[]; sendHour: number
}

interface SendLogEntry {
  id: string; scheduleId: string; reportType: string
  periodStart: string; periodEnd: string; recipientEmail: string
  status: string; errorMessage?: string | null; sentAt: string
}

const REPORT_TYPE_OPTIONS_STATIC = [
  { value: 'weekly', labelKey: 'weekly' as const, icon: 'fa-solid fa-calendar-week', scheduleKey: 'scheduleWeekly' as const, sendDayKey: 'sendDayWeekly' as const },
  { value: 'monthly', labelKey: 'monthly' as const, icon: 'fa-solid fa-calendar', scheduleKey: 'scheduleMonthly' as const, sendDayKey: 'sendDayMonthly' as const },
  { value: 'yearly', labelKey: 'yearly' as const, icon: 'fa-solid fa-calendar-check', scheduleKey: 'scheduleYearly' as const, sendDayKey: 'sendDayYearly' as const },
]

export default function MailPanel() {
  const t = useTranslations('admin')
  const [view, setView] = useState<MailSubView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('admin-mail-subview')
      if (saved === 'broadcast' || saved === 'reports' || saved === 'logs') return saved
    }
    return 'broadcast'
  })

  const handleSetView = (v: MailSubView) => {
    setView(v)
    localStorage.setItem('admin-mail-subview', v)
  }

  const views: { key: MailSubView; label: string; icon: string }[] = [
    { key: 'broadcast', label: t('mailSend'), icon: 'fa-solid fa-paper-plane' },
    { key: 'reports', label: t('reportLabel'), icon: 'fa-solid fa-file-lines' },
    { key: 'logs', label: t('sendHistory'), icon: 'fa-solid fa-clock-rotate-left' },
  ]

  return (
    <main>
      {/* 서브뷰 토글 */}
      <div className="sticky top-0 z-10 bg-ive-bg-deep pb-2">
        <div className="flex gap-1.5">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => handleSetView(v.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                view === v.key
                  ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
                  : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'
              }`}
            >
              <i className={`${v.icon} mr-1`} />{v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'broadcast' && <BroadcastView />}
      {view === 'reports' && <ReportScheduleView />}
      {view === 'logs' && <SendLogView />}
    </main>
  )
}

// ── 일반 메일 발송 (기존 기능) ──
function BroadcastView() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { confirm, alert } = useDialog()
  const [users, setUsers] = useState<User[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers).catch(() => {})
  }, [])

  function toggleUser(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === users.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(users.map(u => u.id)))
    }
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      await alert({ message: t('subjectContentRequired'), variant: 'info' })
      return
    }
    const targets = selectedIds.size > 0 ? Array.from(selectedIds) : undefined
    if (!targets) {
      const ok = await confirm({
        title: t('sendToAll'),
        message: t('sendToAllConfirm'),
        confirmText: t('send'),
        variant: 'warning',
      })
      if (!ok) return
    }
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), userIds: targets }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ sent: data.sent, failed: data.failed })
      } else {
        await alert({ message: data.error || t('sendFailed'), variant: 'error' })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* 수신자 선택 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-bold text-ive-text-muted">{t('recipients')}</label>
          <button onClick={toggleAll} className="text-xs text-ive-cyan font-bold">
            {selectedIds.size === users.length ? t('unselectAll') : t('selectAll')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => toggleUser(u.id)}
              className={`text-xs px-2.5 py-1.5 rounded-full font-bold transition-all ${
                selectedIds.has(u.id)
                  ? 'bg-ive-green/20 text-ive-green border border-ive-green/30'
                  : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-ive-text-dim mt-1">
          {selectedIds.size === 0 ? t('noSelectionAllSend') : t('selectedCount', { count: selectedIds.size })}
        </p>
      </div>

      {/* 제목 */}
      <div className="mb-3">
        <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('subject')}</label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder={t('subjectPlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 본문 */}
      <div className="mb-4">
        <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('contentHtml')}</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          placeholder={t('contentPlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none"
        />
      </div>

      {result && (
        <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${result.failed ? 'bg-ive-amber/10 text-ive-amber' : 'bg-ive-green/10 text-ive-green'}`}>
          {t('sendComplete', { sent: result.sent })}{result.failed > 0 && t('sendCompleteFailed', { failed: result.failed })}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending || !subject.trim() || !body.trim()}
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40"
      >
        {sending ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('sending')}</> : <><i className="fa-solid fa-paper-plane mr-1" />{t('mailSend')}</>}
      </button>
    </>
  )
}

// ── 보고서 스케줄 관리 ──
function ReportScheduleView() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const tr = useTranslations('report')
  const { confirm, alert } = useDialog()
  const [schedules, setSchedules] = useState<ReportScheduleState[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<ReportScheduleState>>({})

  async function fetchData() {
    try {
      const [sRes, uRes] = await Promise.all([
        fetch('/api/admin/reports/schedules'),
        fetch('/api/admin/users'),
      ])
      if (sRes.ok) setSchedules(await sRes.json())
      if (uRes.ok) setUsers(await uRes.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  function startEdit(s: ReportScheduleState) {
    setEditing(s.id)
    setEditForm({ ...s })
  }

  function cancelEdit() {
    setEditing(null)
    setEditForm({})
  }

  function toggleRecipient(email: string) {
    setEditForm(prev => {
      const list = prev.recipients || []
      return {
        ...prev,
        recipients: list.includes(email)
          ? list.filter(e => e !== email)
          : [...list, email],
      }
    })
  }

  function toggleAllRecipients() {
    const allEmails = users.map(u => u.email)
    setEditForm(prev => {
      const current = prev.recipients || []
      return {
        ...prev,
        recipients: current.length === allEmails.length ? [] : allEmails,
      }
    })
  }

  async function handleSave(reportType: string) {
    const form = editForm
    setSaving(reportType)
    try {
      const res = await fetch('/api/admin/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `rs-${reportType}`,
          reportType,
          enabled: form.enabled ?? true,
          recipients: form.recipients || [],
          sendHour: form.sendHour ?? 9,
        }),
      })
      if (res.ok) {
        await fetchData()
        setEditing(null)
      } else {
        const data = await res.json()
        await alert({ message: data.error || tc('saveFailed'), variant: 'error' })
      }
    } finally {
      setSaving(null)
    }
  }

  async function handleSendNow(reportType: string) {
    const label = tr(reportType as any)
    const ok = await confirm({
      title: t('sendNow'),
      message: t('sendNowConfirm', { label }),
      confirmText: t('send'),
      variant: 'warning',
    })
    if (!ok) return

    setSending(reportType)
    try {
      const res = await fetch('/api/admin/reports/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, force: true }),
      })
      const data = await res.json()
      if (res.ok) {
        await alert({
          title: t('sendComplete', { sent: data.sent }),
          message: `${t('sendResult', { sent: data.sent })}${data.failed > 0 ? t('sendResultFailed', { failed: data.failed }) : ''}${data.skipped > 0 ? t('sendResultSkipped', { skipped: data.skipped }) : ''}`,
          variant: data.failed > 0 ? 'error' : 'success',
        })
      } else {
        await alert({ message: data.error || t('sendFailed'), variant: 'error' })
      }
    } finally {
      setSending(null)
    }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  // 3종류 보고서에 대해 각각 카드 표시
  return (
    <div className="space-y-3">
      <div className="text-xs text-ive-text-dim mb-1">
        {t('reportScheduleDesc')}
      </div>

      {REPORT_TYPE_OPTIONS_STATIC.map(opt => {
        const optLabel = tr(opt.labelKey)
        const schedule = schedules.find(s => s.reportType === opt.value)
        const isEditing = editing === `rs-${opt.value}`
        const form = isEditing ? editForm : null

        return (
          <div key={opt.value} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
            {/* 헤더 */}
            <div className="px-4 py-3 flex items-center gap-2">
              <i className={`${opt.icon} text-sm ${schedule?.enabled ? 'text-ive-green' : 'text-ive-text-dim'}`} />
              <span className="text-sm font-bold text-ive-text flex-1">{t('reportCard', { label: optLabel })}</span>
              {schedule ? (
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${schedule.enabled ? 'bg-ive-green/15 text-ive-green' : 'bg-white/5 text-ive-text-dim'}`}>
                    {schedule.enabled ? t('active') : t('inactive')}
                  </span>
                  <span className="text-xs text-ive-text-dim">{t('personsCount', { count: schedule.recipients.length })}</span>
                  <button
                    onClick={() => handleSendNow(opt.value)}
                    disabled={!schedule?.recipients.length || sending === opt.value}
                    className="w-7 h-7 rounded-lg bg-ive-cyan/10 text-ive-cyan flex items-center justify-center text-xs active:scale-95 disabled:opacity-40"
                    title={t('sendNow')}
                  >
                    {sending === opt.value ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
                  </button>
                  <button
                    onClick={() => isEditing ? cancelEdit() : startEdit(schedule)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs active:scale-95 ${isEditing ? 'bg-ive-amber/15 text-ive-amber' : 'bg-ive-bg-deep text-ive-text-dim'}`}
                  >
                    <i className={`fa-solid ${isEditing ? 'fa-xmark' : 'fa-pen'}`} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const newSchedule: ReportScheduleState = {
                      id: `rs-${opt.value}`, reportType: opt.value, enabled: true,
                      recipients: [], sendHour: 9,
                    }
                    setSchedules(prev => [...prev, newSchedule])
                    startEdit(newSchedule)
                  }}
                  className="text-xs font-bold text-ive-cyan"
                >
                  <i className="fa-solid fa-plus mr-1" />{t('setup')}
                </button>
              )}
            </div>

            {/* 편집 패널 */}
            {isEditing && form && (
              <div className="px-4 pb-4 border-t border-ive-border-dark space-y-3 pt-3 animate-in fade-in slide-in-from-top-1">
                {/* 활성화 토글 */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-20 shrink-0">{t('status')}</label>
                  <button
                    onClick={() => setEditForm(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      form.enabled ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-deep border-ive-border-subtle text-ive-text-dim'
                    }`}
                  >
                    {form.enabled ? t('active') : t('inactive')}
                  </button>
                </div>

                {/* 발송 시점: 발송일(고정) + 시각(선택) */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-20 shrink-0">{t('sendTime')}</label>
                  <span className="text-xs font-bold text-ive-text">{t(opt.sendDayKey)}</span>
                  <select
                    value={form.sendHour ?? 9}
                    onChange={e => setEditForm(prev => ({ ...prev, sendHour: Number(e.target.value) }))}
                    className="bg-ive-bg-deep border border-ive-border-subtle rounded-lg px-2 py-1.5 text-xs font-bold text-ive-cyan outline-none"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  <span className="text-xs text-ive-text-dim">KST</span>
                </div>

                {/* 수신자 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-ive-text-muted">{t('recipients')}</label>
                    <button onClick={toggleAllRecipients} className="text-xs text-ive-cyan font-bold">
                      {(form.recipients || []).length === users.length ? t('unselectAll') : t('selectAll')}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {users.map(u => (
                      <button
                        key={u.id}
                        onClick={() => toggleRecipient(u.email)}
                        className={`text-xs px-2 py-1 rounded-full font-bold transition-all ${
                          (form.recipients || []).includes(u.email)
                            ? 'bg-ive-green/20 text-ive-green border border-ive-green/30'
                            : 'bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle'
                        }`}
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-ive-text-dim mt-1">{t('selectedCount', { count: (form.recipients || []).length })}</p>
                </div>

                {/* 저장/취소 */}
                <div className="flex gap-2">
                  <button onClick={cancelEdit}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle active:scale-[0.98]">
                    {tc('cancel')}
                  </button>
                  <button onClick={() => handleSave(opt.value)}
                    disabled={saving === opt.value}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-green-dark text-white active:scale-[0.98] disabled:opacity-40">
                    {saving === opt.value ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('saving')}</> : tc('save')}
                  </button>
                </div>
              </div>
            )}

            {/* 요약 정보 (편집 중 아닐 때) */}
            {!isEditing && schedule && schedule.recipients.length > 0 && (
              <div className="px-4 pb-3 text-xs text-ive-text-dim">
                {t(opt.scheduleKey, { hour: String(schedule.sendHour ?? 9).padStart(2, '0') })} KST | {schedule.recipients.slice(0, 3).join(', ')}
                {schedule.recipients.length > 3 && ` +${schedule.recipients.length - 3}`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 발송 이력 조회 ──
function SendLogView() {
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
