'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { User, UserActivityLog, DEFAULT_AVATARS } from '@/types'
import { useStore } from '@/lib/store'
import { formatDateFull, formatDateWithSeconds } from '@/lib/format-date'
import { useDialog } from '@/components/ui/ConfirmDialog'
import TerminalTab from './TerminalTab'
import PullToRefresh from '@/components/ui/PullToRefresh'

type SubTab = 'users' | 'mail' | 'settings' | 'cli'

export default function AdminTab() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-subtab')
      if (saved && ['users', 'mail', 'settings', 'cli'].includes(saved)) return saved as SubTab
      // 기존 'activity' 저장값은 'users'로 매핑
      if (saved === 'activity') return 'users'
    }
    return 'users'
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    localStorage.setItem('ive-admin-subtab', subTab)
  }, [subTab])

  const handleRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1)
  }, [])

  const subTabs: { key: SubTab; icon: string; label: string }[] = [
    { key: 'users', icon: 'fa-solid fa-users', label: t('users') },
    { key: 'mail', icon: 'fa-solid fa-envelope', label: t('mail') },
    { key: 'settings', icon: 'fa-solid fa-gear', label: t('settings') },
    { key: 'cli', icon: 'fa-solid fa-terminal', label: t('cli') },
  ]

  return (
    <PullToRefresh onRefresh={handleRefresh} className="min-h-screen pb-20">
      {/* 서브 탭 바 */}
      <div className="sticky top-[57px] z-30 bg-ive-bg-deep border-b border-ive-border-dark">
        <div className="flex max-w-lg mx-auto">
          {subTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex-1 py-2.5 text-sm font-bold text-center transition-colors ${
                subTab === t.key
                  ? 'text-ive-green border-b-2 border-ive-green'
                  : 'text-ive-text-dim'
              }`}
            >
              <i className={`${t.icon} mr-1`} />{t.label}
            </button>
          ))}
        </div>
      </div>

      {subTab === 'users' && <UsersPanel key={refreshKey} />}
      {subTab === 'mail' && <MailPanel key={refreshKey} />}
      {subTab === 'settings' && <SettingsPanel key={refreshKey} />}
      {subTab === 'cli' && <TerminalTab />}
    </PullToRefresh>
  )
}

// ── Users Panel ──
type UsersSubView = 'users' | 'activity'

function UsersPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const ta = useTranslations('agent')
  const { confirm, alert } = useDialog()
  const [view, setView] = useState<UsersSubView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-users-subview')
      if (saved === 'activity') return 'activity'
    }
    return 'users'
  })
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingLimits, setEditingLimits] = useState<string | null>(null)
  const [limitValues, setLimitValues] = useState<{ maxAgents: number; maxTurns: number; allowedClis: string[] }>({ maxAgents: 0, maxTurns: 0, allowedClis: ['opencode'] })

  useEffect(() => {
    localStorage.setItem('ive-admin-users-subview', view)
  }, [view])

  const views: { key: UsersSubView; label: string; icon: string }[] = [
    { key: 'users', label: t('users'), icon: 'fa-solid fa-users' },
    { key: 'activity', label: t('activity'), icon: 'fa-solid fa-clock-rotate-left' },
  ]

  async function fetchUsers() {
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  async function handleDelete(userId: string, userName: string) {
    const ok = await confirm({
      title: t('deleteUser'),
      message: t('deleteUserConfirm', { name: userName }),
      confirmText: tc('delete'),
      variant: 'danger',
    })
    if (!ok) return
    setDeleting(userId)
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== userId))
    } else {
      const data = await res.json()
      await alert({ message: data.error || tc('deleteFailed'), variant: 'error' })
    }
    setDeleting(null)
  }

  async function handleToggleAdmin(userId: string, currentAdmin: boolean) {
    const newAdmin = !currentAdmin
    const body: any = { userId, isAdmin: newAdmin }
    // 관리자로 지정 시 모든 CLI 허용
    if (newAdmin) body.allowedClis = ['claude', 'opencode']
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? {
        ...u,
        isAdmin: newAdmin,
        ...(newAdmin ? { allowedClis: ['claude', 'opencode'] as User['allowedClis'] } : {}),
      } : u))
    } else {
      const data = await res.json()
      await alert({ message: data.error || t('permissionChangeFailed'), variant: 'error' })
    }
  }

  async function toggleEditLimits(u: User) {
    if (editingLimits === u.id) {
      // 닫기 — 변경 사항 확인
      const changed = limitValues.maxAgents !== u.maxAgents || limitValues.maxTurns !== u.maxTurns
        || JSON.stringify([...limitValues.allowedClis].sort()) !== JSON.stringify([...(u.allowedClis || [])].sort())
      if (changed) {
        const ok = await confirm({
          title: t('saveChanges'),
          message: t('saveChangesConfirm'),
          confirmText: tc('save'),
          cancelText: t('discard'),
          variant: 'warning',
        })
        if (ok) {
          await saveLimits(u.id)
          return
        }
      }
      setEditingLimits(null)
    } else {
      setEditingLimits(u.id)
      setLimitValues({ maxAgents: u.maxAgents, maxTurns: u.maxTurns, allowedClis: u.allowedClis || ['opencode'] })
    }
  }

  async function saveLimits(userId: string) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, maxAgents: limitValues.maxAgents, maxTurns: limitValues.maxTurns, allowedClis: limitValues.allowedClis }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, maxAgents: limitValues.maxAgents, maxTurns: limitValues.maxTurns, allowedClis: limitValues.allowedClis as User['allowedClis'] } : u))
      setEditingLimits(null)
    } else {
      const data = await res.json()
      await alert({ message: data.error || tc('saveFailed'), variant: 'error' })
    }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  if (view === 'activity') {
    return (
      <main className="px-4 py-4 max-w-lg mx-auto">
        {/* 서브뷰 토글 */}
        <div className="flex gap-1.5 mb-4">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                view === v.key
                  ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
                  : 'bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.96]'
              }`}
            >
              <i className={`${v.icon} mr-1`} />{v.label}
            </button>
          ))}
        </div>
        <ActivityContent />
      </main>
    )
  }

  return (
    <main className="px-4 py-4 max-w-lg mx-auto">
      {/* 서브뷰 토글 */}
      <div className="flex gap-1.5 mb-4">
        {views.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              view === v.key
                ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
                : 'bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.96]'
            }`}
          >
            <i className={`${v.icon} mr-1`} />{v.label}
          </button>
        ))}
      </div>
      <div className="text-xs text-ive-text-dim mb-3">{t('totalUsersCount', { count: users.length })}</div>
      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              {(() => {
                const av = DEFAULT_AVATARS.find(a => a.id === u.avatar)
                return (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                    style={u.avatar !== 'photo' ? { backgroundColor: av ? `${av.color}20` : '#4ade8020' } : undefined}
                  >
                    {u.avatar === 'photo' ? (
                      <img src={`/api/auth/avatar/image?id=${u.id}`} alt="" className="w-full h-full object-cover" />
                    ) : av ? (
                      <i className={`${av.icon} text-sm`} style={{ color: av.color }} />
                    ) : (
                      <i className="fa-solid fa-user text-sm text-ive-green" />
                    )}
                  </div>
                )
              })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ive-text truncate">{u.name}</span>
                  {u.isAdmin && (
                    <span className="text-xs font-bold bg-ive-green/15 text-ive-green px-1.5 py-0.5 rounded-full">{t('adminBadge')}</span>
                  )}
                </div>
                <div className="text-xs text-ive-text-dim break-all">{u.email}</div>
                <div className="text-xs text-ive-text-dim">{new Date(u.createdAt).toLocaleDateString('ko-KR')} {t('joined')}</div>
                <div className="flex items-center gap-x-2 text-xs mt-0.5">
                  <span className="inline-flex items-center text-ive-cyan">
                    <i className="fa-solid fa-robot mr-0.5" />{u.maxAgents || '∞'}
                  </span>
                  <span className="inline-flex items-center text-ive-amber">
                    <i className="fa-solid fa-repeat mr-0.5" />{u.maxTurns || '∞'}
                  </span>
                  <span className="text-ive-text-dim">|</span>
                  {(u.allowedClis || []).map(cli => (
                    <span key={cli} className="inline-flex items-center text-ive-green">
                      <i className={`${cli === 'claude' ? 'fa-solid fa-atom' : 'fa-solid fa-terminal'} mr-0.5`} />{cli}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => toggleEditLimits(u)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all ${
                    editingLimits === u.id ? 'bg-ive-cyan/15 text-ive-cyan' : 'bg-ive-bg-deep text-ive-text-dim'
                  }`}
                  title={t('limitSettings')}
                >
                  <i className="fa-solid fa-gauge text-xs" />
                </button>
                <button
                  onClick={() => handleToggleAdmin(u.id, u.isAdmin)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all ${
                    u.isAdmin ? 'bg-ive-green/15 text-ive-green' : 'bg-ive-bg-deep text-ive-text-dim'
                  }`}
                  title={u.isAdmin ? t('revokeAdmin') : t('grantAdmin')}
                >
                  <i className="fa-solid fa-shield text-xs" />
                </button>
                <button
                  onClick={() => handleDelete(u.id, u.name)}
                  disabled={deleting === u.id}
                  className="w-8 h-8 rounded-lg bg-ive-red/10 text-ive-red flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                >
                  {deleting === u.id ? <i className="fa-solid fa-circle-notch fa-spin text-xs" /> : <i className="fa-solid fa-trash text-xs" />}
                </button>
              </div>
            </div>

            {/* 제한 설정 패널 */}
            {editingLimits === u.id && (
              <div className="mt-3 pt-3 border-t border-ive-border-dark space-y-3 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-24 shrink-0">
                    <i className="fa-solid fa-robot mr-1" />{t('maxDevelopers')}
                  </label>
                  <div className="flex items-center gap-1.5 flex-1">
                    <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxAgents: Math.max(0, v.maxAgents - 1) }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-bold">−</button>
                      <span className="w-10 py-1.5 flex items-center justify-center text-xs font-bold text-ive-text border-x border-ive-border">
                        {limitValues.maxAgents || '∞'}
                      </span>
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxAgents: v.maxAgents + 1 }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-bold">+</button>
                    </div>
                    <span className="text-xs text-ive-text-dim">{t('unlimited')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-24 shrink-0">
                    <i className="fa-solid fa-repeat mr-1" />{t('maxTurns')}
                  </label>
                  <div className="flex items-center gap-1.5 flex-1">
                    <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxTurns: Math.max(0, v.maxTurns - 10) }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-bold">−</button>
                      <span className="w-10 py-1.5 flex items-center justify-center text-xs font-bold text-ive-text border-x border-ive-border">
                        {limitValues.maxTurns || '∞'}
                      </span>
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxTurns: v.maxTurns + 10 }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-bold">+</button>
                    </div>
                    <span className="text-xs text-ive-text-dim">{t('unlimited')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-24 shrink-0">
                    <i className="fa-solid fa-terminal mr-1" />{t('cliTools')}
                  </label>
                  <div className="flex gap-2 flex-1">
                    {[{ value: 'claude', label: 'Claude Code', icon: 'fa-solid fa-atom' }, { value: 'opencode', label: 'OpenCode', icon: 'fa-solid fa-terminal' }].map(cli => {
                      const checked = limitValues.allowedClis.includes(cli.value)
                      return (
                        <button
                          key={cli.value}
                          type="button"
                          onClick={() => setLimitValues(v => ({
                            ...v,
                            allowedClis: checked
                              ? v.allowedClis.filter(c => c !== cli.value)
                              : [...v.allowedClis, cli.value],
                          }))}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                            checked ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-deep border-ive-border-subtle text-ive-text-dim'
                          }`}
                        >
                          <i className={cli.icon} />{cli.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingLimits(null)}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle active:scale-[0.98]">
                    {tc('cancel')}
                  </button>
                  <button onClick={() => saveLimits(u.id)}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-green-dark text-white active:scale-[0.98]">
                    {tc('save')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  )
}

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

function MailPanel() {
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
    <main className="px-4 py-4 max-w-lg mx-auto">
      {/* 서브뷰 토글 */}
      <div className="flex gap-1.5 mb-4">
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

// ── Settings Panel ──

interface SettingField {
  key: string; label: string; type: 'text' | 'password' | 'number' | 'textarea' | 'model-select'
  placeholder?: string; defaultValue?: string; rows?: number; cliName?: string
}
interface SettingGroup {
  key: string
  label: string
  icon: string
  fields: SettingField[]
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    key: 'cli_paths', label: 'cliPathLabel', icon: 'fa-solid fa-terminal',
    fields: [
      { key: 'cli.claude.path', label: 'Claude Code', type: 'text', placeholder: '/usr/local/bin/claude', defaultValue: '/usr/local/bin/claude' },
      { key: 'cli.claude.model', label: 'Claude Model', type: 'model-select', cliName: 'claude' },
      { key: 'cli.opencode.path', label: 'OpenCode', type: 'text', placeholder: '/usr/local/bin/opencode', defaultValue: '/usr/local/bin/opencode' },
      { key: 'cli.opencode.model', label: 'OpenCode Model', type: 'model-select', cliName: 'opencode' },
    ],
  },
  {
    key: 'mail', label: 'smtpMail', icon: 'fa-solid fa-envelope',
    fields: [
      { key: 'mail.smtp_host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com' },
      { key: 'mail.smtp_port', label: 'SMTP Port', type: 'text', placeholder: '587' },
      { key: 'mail.smtp_user', label: 'SMTP User', type: 'text', placeholder: 'user@gmail.com' },
      { key: 'mail.smtp_password', label: 'SMTP Password', type: 'password', placeholder: 'App Password' },
      { key: 'mail.from_name', label: 'From Name', type: 'text', placeholder: 'IVE' },
      { key: 'mail.domain', label: 'Mail Domain', type: 'text', placeholder: 'example.com' },
    ],
  },
  {
    key: 'retention', label: 'dataRetention', icon: 'fa-solid fa-database',
    fields: [
      { key: 'retention.executions_days', label: 'Execution Retention (days)', type: 'number', placeholder: '365' },
      { key: 'retention.snapshots_days', label: 'Snapshot Retention (days)', type: 'number', placeholder: '7' },
    ],
  },
  {
    key: 'mcp', label: 'mcpServer', icon: 'fa-solid fa-plug',
    fields: [
      {
        key: 'mcp.config',
        label: 'MCP Config (JSON)',
        type: 'textarea',
        rows: 8,
        placeholder: `{\n  "github": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-github"],\n    "environment": { "GITHUB_TOKEN": "ghp_xxx" }\n  }\n}`,
      },
    ],
  },
]

interface PricingItem {
  id: string; cliName: string; modelName: string
  inputPrice: number; outputPrice: number; updatedAt: string
}

const CLI_ICONS: Record<string, string> = {
  claude: 'fa-solid fa-c',
  gemini: 'fa-solid fa-g',
  codex: 'fa-solid fa-code',
}

function ModelSelect({ models, value, onChange }: { models: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const options = [{ value: '', label: 'CLI 기본값' }, ...models.map(m => ({ value: m, label: m }))]
  const selected = options.find(o => o.value === value) || options[0]

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50"
      >
        <span className={value ? 'text-ive-text' : 'text-ive-text-dim'}>{selected.label}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg shadow-black/30 max-h-52 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ive-text-dim/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ive-text-dim/50">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-white/[0.05] ${
                o.value === value ? 'text-ive-green font-bold' : 'text-ive-text'
              } ${o.value === '' ? 'text-ive-text-dim' : ''}`}
            >
              {o.value === value && <i className="fa-solid fa-check text-xs mr-2" />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { alert } = useDialog()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  // pricing
  const [pricingItems, setPricingItems] = useState<PricingItem[]>([])
  const [pricingFetching, setPricingFetching] = useState(false)
  const [pricingSaving, setPricingSaving] = useState(false)
  const [pricingSaved, setPricingSaved] = useState(false)
  // CLI 모델 목록
  const [cliModels, setCliModels] = useState<Record<string, string[]>>({})

  useEffect(() => {
    fetch('/api/admin/env')
      .then(r => r.json())
      .then(data => {
        const s = data.settings || {}
        for (const group of SETTING_GROUPS) {
          for (const field of group.fields) {
            if (field.defaultValue && !s[field.key]) {
              s[field.key] = field.defaultValue
            }
          }
        }
        setSettings(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    fetch('/api/settings/pricing').then(r => r.json()).then(setPricingItems).catch(() => {})
    fetch('/api/settings/cli-models').then(r => r.json()).then(setCliModels).catch(() => {})
  }, [])

  function updateSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        await alert({ message: data.error || tc('saveFailed'), variant: 'error' })
      }
    } finally { setSaving(false) }
  }

  async function handleTestMail() {
    if (!testEmail) {
      await alert({ message: t('recipientPlaceholder'), variant: 'error' })
      return
    }
    setTesting(true)
    try {
      // 먼저 현재 설정 저장
      await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      // 테스트 메일 발송 (입력한 주소로만)
      const res = await fetch('/api/admin/mail/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      })
      const data = await res.json()
      if (res.ok) {
        await alert({ title: t('sendSuccess'), message: t('testMailSent', { email: testEmail }), variant: 'success' })
      } else {
        await alert({ message: data.error || t('sendFailed'), variant: 'error' })
      }
    } catch {
      await alert({ message: t('testFailed'), variant: 'error' })
    } finally { setTesting(false) }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <div className="text-xs text-ive-text-dim mb-1">
        {t('systemSettingsDesc')}
      </div>

      {SETTING_GROUPS.map((group, groupIdx) => (
        <div key={group.key} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg relative" style={{ zIndex: SETTING_GROUPS.length - groupIdx }}>
          <button
            onClick={() => setExpandedGroup(expandedGroup === group.key ? null : group.key)}
            className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
          >
            <i className={`${group.icon} text-sm text-ive-text-dim`} />
            <span className="text-sm font-bold text-ive-text flex-1">{t(group.label as any)}</span>
            <span className="text-xs text-ive-text-dim">
              {group.fields.filter(f => settings[f.key]).length}/{group.fields.length}
            </span>
            <i className={`fa-solid fa-chevron-${expandedGroup === group.key ? 'up' : 'down'} text-xs text-ive-text-dim`} />
          </button>

          {expandedGroup === group.key && (
            <div className="px-4 pb-4 border-t border-ive-border-dark space-y-3 pt-3">
              {group.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-bold text-ive-text-muted mb-1">{field.label}</label>
                  {field.type === 'model-select' ? (
                    <ModelSelect
                      models={cliModels[field.cliName || ''] || []}
                      value={settings[field.key] || ''}
                      onChange={v => updateSetting(field.key, v)}
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={settings[field.key] || ''}
                      onChange={e => updateSetting(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={field.rows ?? 5}
                      className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50 font-mono resize-y"
                    />
                  ) : (
                    <input
                      type={field.type}
                      value={settings[field.key] || ''}
                      onChange={e => updateSetting(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                    />
                  )}
                </div>
              ))}

              {/* 메일 그룹에 테스트 발송 */}
              {group.key === 'mail' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    placeholder={t('recipientPlaceholder')}
                    className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                  />
                  <button
                    onClick={handleTestMail}
                    disabled={testing || !testEmail}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40 whitespace-nowrap"
                  >
                    {testing
                      ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('testSending')}</>
                      : <><i className="fa-solid fa-paper-plane mr-1" />{t('test')}</>
                    }
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* 단가 설정 섹션 */}
      <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedGroup(expandedGroup === 'pricing' ? null : 'pricing')}
          className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
        >
          <i className="fa-solid fa-coins text-sm text-ive-text-dim" />
          <span className="text-sm font-bold text-ive-text flex-1">{t('pricing')}</span>
          <span className="text-xs text-ive-text-dim">{pricingItems.length}</span>
          <i className={`fa-solid fa-chevron-${expandedGroup === 'pricing' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>

        {expandedGroup === 'pricing' && (
          <div className="px-4 pb-4 border-t border-ive-border-dark pt-3">
            <div className="text-xs text-ive-text-dim mb-2">{t('pricingDesc')}</div>
            <div className="space-y-2.5">
              {pricingItems.map(it => (
                <div key={it.cliName} className="bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <i className={`${CLI_ICONS[it.cliName] || 'fa-solid fa-robot'} text-sm text-ive-text-dim`} />
                    <span className="text-xs font-bold text-ive-text uppercase">{it.cliName}</span>
                    <input
                      value={it.modelName}
                      onChange={e => { setPricingItems(prev => prev.map(p => p.cliName === it.cliName ? { ...p, modelName: e.target.value } : p)); setPricingSaved(false) }}
                      className="flex-1 text-xs text-ive-text-muted bg-transparent border-b border-ive-border-dark focus:border-ive-green focus:outline-none px-1 py-0.5 text-right"
                      placeholder={t('modelName')}
                    />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-ive-text-dim mb-0.5">{t('input')}</div>
                      <input
                        type="number" step="0.01" min="0"
                        value={it.inputPrice}
                        onChange={e => { setPricingItems(prev => prev.map(p => p.cliName === it.cliName ? { ...p, inputPrice: parseFloat(e.target.value) || 0 } : p)); setPricingSaved(false) }}
                        className="w-full text-sm font-bold text-ive-cyan bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-green"
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-ive-text-dim mb-0.5">{t('output')}</div>
                      <input
                        type="number" step="0.01" min="0"
                        value={it.outputPrice}
                        onChange={e => { setPricingItems(prev => prev.map(p => p.cliName === it.cliName ? { ...p, outputPrice: parseFloat(e.target.value) || 0 } : p)); setPricingSaved(false) }}
                        className="w-full text-sm font-bold text-ive-amber bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-green"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-ive-text-dim mt-1.5 text-right">
                    {t('modified')}: {new Date(it.updatedAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={async () => {
                  setPricingFetching(true)
                  try {
                    const res = await fetch('/api/settings/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto-fetch' }) })
                    if (res.ok) { setPricingItems(await res.json()); setPricingSaved(false); await alert({ title: t('fetchComplete'), message: t('latestPricingApplied'), variant: 'success' }) }
                    else { const data = await res.json(); await alert({ message: data.error || t('fetchFailed'), variant: 'error' }) }
                  } finally { setPricingFetching(false) }
                }}
                disabled={pricingFetching}
                className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {pricingFetching
                  ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('fetching')}</>
                  : <><i className="fa-solid fa-rotate mr-1" />{t('applyLatestPricing')}</>
                }
              </button>
              <button
                onClick={async () => {
                  setPricingSaving(true)
                  try {
                    const res = await fetch('/api/settings/pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: pricingItems.map(it => ({ cliName: it.cliName, modelName: it.modelName, inputPrice: it.inputPrice, outputPrice: it.outputPrice })) }) })
                    if (res.ok) { setPricingItems(await res.json()); setPricingSaved(true); setTimeout(() => setPricingSaved(false), 2000) }
                    else { const data = await res.json(); await alert({ message: data.error || tc('saveFailed'), variant: 'error' }) }
                  } finally { setPricingSaving(false) }
                }}
                disabled={pricingSaving}
                className={`flex-1 py-2 rounded-lg text-xs font-bold active:scale-[0.98] transition-all disabled:opacity-40 ${pricingSaved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'}`}
              >
                {pricingSaving
                  ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('saving')}</>
                  : pricingSaved
                    ? <><i className="fa-solid fa-check mr-1" />{t('saved')}</>
                    : <><i className="fa-solid fa-floppy-disk mr-1" />{tc('save')}</>
                }
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full font-bold py-3 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40 ${
          saved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'
        }`}
      >
        {saving
          ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('saving')}</>
          : saved
            ? <><i className="fa-solid fa-check mr-1" />{t('saved')}</>
            : <><i className="fa-solid fa-floppy-disk mr-1" />{tc('save')}</>
        }
      </button>
    </main>
  )
}

// ── Activity Panel (사용자 활동 로그) ──

const CATEGORY_META: Record<string, { labelKey: string; icon: string; color: string }> = {
  auth: { labelKey: 'categoryAuth', icon: 'fa-solid fa-right-to-bracket', color: 'text-ive-cyan' },
  project: { labelKey: 'categoryProject', icon: 'fa-solid fa-folder', color: 'text-ive-green' },
  agent: { labelKey: 'categoryAgent', icon: 'fa-solid fa-robot', color: 'text-ive-amber' },
  execution: { labelKey: 'categoryExecution', icon: 'fa-solid fa-play', color: 'text-blue-400' },
  task: { labelKey: 'categoryTask', icon: 'fa-solid fa-list-check', color: 'text-teal-400' },
  admin: { labelKey: 'categoryAdmin', icon: 'fa-solid fa-shield', color: 'text-ive-red' },
  settings: { labelKey: 'categorySettings', icon: 'fa-solid fa-gear', color: 'text-purple-400' },
}

function getDateStr(daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

const DATE_PRESETS: { labelKey: string; days: number | null }[] = [
  { labelKey: 'dateToday', days: 0 },
  { labelKey: 'dateDays7', days: 7 },
  { labelKey: 'dateDays30', days: 30 },
  { labelKey: 'dateDays90', days: 90 },
  { labelKey: 'dateAll', days: null },
]

const ACTIVITY_FILTER_KEY = 'ive-admin-activity-filter'

function loadActivityFilter(): {
  category: string
  userId: string
  startDate: string
  endDate: string
  preset: number | null
} {
  if (typeof window === 'undefined') return { category: '', userId: '', startDate: getDateStr(30), endDate: getDateStr(0), preset: 30 }
  try {
    const raw = localStorage.getItem(ACTIVITY_FILTER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        category: parsed.category ?? '',
        userId: parsed.userId ?? '',
        startDate: parsed.startDate ?? getDateStr(30),
        endDate: parsed.endDate ?? getDateStr(0),
        preset: parsed.preset !== undefined ? parsed.preset : 30,
      }
    }
  } catch {}
  return { category: '', userId: '', startDate: getDateStr(30), endDate: getDateStr(0), preset: 30 }
}

function ActivityContent() {
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [logs, setLogs] = useState<UserActivityLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const savedFilter = loadActivityFilter()
  const [filterCategory, setFilterCategory] = useState<string>(savedFilter.category)
  const [filterUserId, setFilterUserId] = useState<string>(savedFilter.userId)
  const [filterStartDate, setFilterStartDate] = useState<string>(savedFilter.startDate)
  const [filterEndDate, setFilterEndDate] = useState<string>(savedFilter.endDate)
  const [activePreset, setActivePreset] = useState<number | null>(savedFilter.preset)
  const [users, setUsers] = useState<User[]>([])
  const offsetRef = useRef(0)
  const PAGE_SIZE = 30

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITY_FILTER_KEY, JSON.stringify({
        category: filterCategory,
        userId: filterUserId,
        startDate: filterStartDate,
        endDate: filterEndDate,
        preset: activePreset,
      }))
    } catch {}
  }, [filterCategory, filterUserId, filterStartDate, filterEndDate, activePreset])

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers).catch(() => {})
  }, [])

  const fetchLogs = useCallback(async (reset: boolean = true) => {
    if (reset) { setLoading(true); offsetRef.current = 0 }
    else setLoadingMore(true)

    const sp = new URLSearchParams()
    sp.set('limit', String(PAGE_SIZE))
    sp.set('offset', String(offsetRef.current))
    if (filterCategory) sp.set('category', filterCategory)
    if (filterUserId) sp.set('userId', filterUserId)
    if (filterStartDate) sp.set('startDate', filterStartDate)
    if (filterEndDate) sp.set('endDate', filterEndDate)

    try {
      const res = await fetch(`/api/admin/activity-logs?${sp}`)
      if (res.ok) {
        const data = await res.json()
        if (reset) {
          setLogs(data.logs)
        } else {
          setLogs(prev => [...prev, ...data.logs])
        }
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filterCategory, filterUserId, filterStartDate, filterEndDate])

  useEffect(() => { fetchLogs(true) }, [fetchLogs])

  function handleLoadMore() {
    offsetRef.current += PAGE_SIZE
    fetchLogs(false)
  }

  function formatTime(iso: string) {
    return formatDateWithSeconds(iso, userLocale, userTz)
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  return (
    <>
      {/* 필터 */}
      <div className="flex gap-2 mb-2">
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2.5 py-2 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        >
          <option value="">{t('allCategories')}</option>
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>{t(v.labelKey as any)}</option>
          ))}
        </select>
        <select
          value={filterUserId}
          onChange={e => setFilterUserId(e.target.value)}
          className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2.5 py-2 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        >
          <option value="">{t('allUsers')}</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>

      {/* 기간 프리셋 */}
      <div className="flex gap-1 mb-2">
        {DATE_PRESETS.map(p => (
          <button
            key={p.labelKey}
            onClick={() => {
              setActivePreset(p.days)
              if (p.days === null) {
                setFilterStartDate('')
                setFilterEndDate('')
              } else {
                setFilterStartDate(getDateStr(p.days))
                setFilterEndDate(getDateStr(0))
              }
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activePreset === p.days
                ? 'bg-ive-green/20 text-ive-green border border-ive-green/40'
                : 'bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.96]'
            }`}
          >
            {t(p.labelKey as any)}
          </button>
        ))}
      </div>

      {/* 일자 범위 직접 입력 */}
      <div className="flex items-center gap-1.5 mb-3">
        <input
          type="date"
          value={filterStartDate}
          onChange={e => { setFilterStartDate(e.target.value); setActivePreset(-1) }}
          className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        />
        <span className="text-xs text-ive-text-dim">~</span>
        <input
          type="date"
          value={filterEndDate}
          onChange={e => { setFilterEndDate(e.target.value); setActivePreset(-1) }}
          className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        />
      </div>

      <div className="text-xs text-ive-text-dim mb-3">{filterStartDate && filterEndDate ? t('totalCountRange', { count: total, start: filterStartDate, end: filterEndDate }) : filterStartDate ? t('totalCountStartOnly', { count: total, start: filterStartDate }) : filterEndDate ? t('totalCountEndOnly', { count: total, end: filterEndDate }) : t('totalCount', { count: total })}</div>

      {/* 로그 목록 */}
      <div className="space-y-1.5">
        {logs.map(log => {
          const meta = CATEGORY_META[log.category] || CATEGORY_META.auth
          return (
            <div key={log.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-ive-bg-deep`}>
                  <i className={`${meta.icon} text-xs ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${meta.color} bg-ive-bg-deep`}>{t(meta.labelKey as any)}</span>
                    <span className="text-xs text-ive-text-dim">{formatTime(log.createdAt)}</span>
                  </div>
                  <div className="text-xs text-ive-text leading-relaxed">{log.detail}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-ive-text-muted">
                      <i className="fa-solid fa-user mr-0.5" />{log.userName || t('unknown')}
                    </span>
                    {log.ipAddress && log.ipAddress !== '0.0.0.0' && (
                      <span className="text-xs text-ive-text-dim">
                        <i className="fa-solid fa-globe mr-0.5" />{log.ipAddress}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {logs.length === 0 && (
        <div className="text-center py-10 text-ive-text-dim text-sm">
          <i className="fa-solid fa-clock-rotate-left text-2xl mb-2 block opacity-30" />
          {t('noActivityRecords')}
        </div>
      )}

      {/* 더 보기 */}
      {logs.length < total && (
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="w-full mt-3 py-2.5 rounded-lg text-xs font-bold bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {loadingMore
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tc('loading')}</>
            : <><i className="fa-solid fa-chevron-down mr-1" />{t('loadMore', { current: logs.length, total })}</>
          }
        </button>
      )}
    </>
  )
}
