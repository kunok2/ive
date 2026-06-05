'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { User } from '@/types'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import CustomSelect from '@/components/ui/CustomSelect'
import AgentAvatar from '@/components/agent/AgentAvatar'

interface ReportScheduleState {
  id: string; reportType: string; enabled: boolean
  recipients: string[]; sendHour: number
}

const REPORT_TYPE_OPTIONS_STATIC = [
  { value: 'weekly', labelKey: 'weekly' as const, icon: 'fa-solid fa-calendar-week', scheduleKey: 'scheduleWeekly' as const, sendDayKey: 'sendDayWeekly' as const },
  { value: 'monthly', labelKey: 'monthly' as const, icon: 'fa-solid fa-calendar', scheduleKey: 'scheduleMonthly' as const, sendDayKey: 'sendDayMonthly' as const },
  { value: 'yearly', labelKey: 'yearly' as const, icon: 'fa-solid fa-calendar-check', scheduleKey: 'scheduleYearly' as const, sendDayKey: 'sendDayYearly' as const },
]

export default function ReportScheduleView() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const tr = useTranslations('report')
  const { confirm, alert } = useDialog()
  const { toast } = useToast()
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
        toast(data.error || tc('saveFailed'), 'error')
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
        const msg = `${t('sendResult', { sent: data.sent })}${data.failed > 0 ? t('sendResultFailed', { failed: data.failed }) : ''}${data.skipped > 0 ? t('sendResultSkipped', { skipped: data.skipped }) : ''}`
        toast(msg, data.failed > 0 ? 'error' : 'success')
      } else {
        toast(data.error || t('sendFailed'), 'error')
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
                  <CustomSelect
                    size="sm"
                    className="w-[88px]"
                    value={String(form.sendHour ?? 9)}
                    onChange={v => setEditForm(prev => ({ ...prev, sendHour: Number(v) }))}
                    options={Array.from({ length: 24 }, (_, h) => ({
                      value: String(h),
                      label: `${String(h).padStart(2, '0')}:00`,
                    }))}
                  />
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
                        title={u.email}
                        className={`text-xs pl-1 pr-2 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                          (form.recipients || []).includes(u.email)
                            ? 'bg-ive-green/20 text-ive-green border border-ive-green/30'
                            : 'bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle'
                        }`}
                      >
                        <AgentAvatar avatar={u.avatar} userId={u.id} size="xs" />
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
