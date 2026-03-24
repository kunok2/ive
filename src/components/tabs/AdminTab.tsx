'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { User, UserActivityLog, DEFAULT_AVATARS } from '@/types'
import { useDialog } from '@/components/ui/ConfirmDialog'
import TerminalTab from './TerminalTab'
import PullToRefresh from '@/components/ui/PullToRefresh'

type SubTab = 'users' | 'mail' | 'settings' | 'pricing' | 'activity' | 'cli'

export default function AdminTab() {
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-subtab')
      if (saved && ['users', 'mail', 'settings', 'pricing', 'activity', 'cli'].includes(saved)) return saved as SubTab
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
    { key: 'users', icon: 'fa-solid fa-users', label: '사용자' },
    { key: 'mail', icon: 'fa-solid fa-envelope', label: '메일' },
    { key: 'settings', icon: 'fa-solid fa-gear', label: '설정' },
    { key: 'pricing', icon: 'fa-solid fa-coins', label: '단가' },
    { key: 'activity', icon: 'fa-solid fa-clock-rotate-left', label: '활동' },
    { key: 'cli', icon: 'fa-solid fa-terminal', label: 'CLI' },
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
      {subTab === 'pricing' && <PricingPanel key={refreshKey} />}
      {subTab === 'activity' && <ActivityPanel key={refreshKey} />}
      {subTab === 'cli' && <TerminalTab />}
    </PullToRefresh>
  )
}

// ── Users Panel ──
function UsersPanel() {
  const { confirm, alert } = useDialog()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingLimits, setEditingLimits] = useState<string | null>(null)
  const [limitValues, setLimitValues] = useState<{ maxAgents: number; maxTurns: number; allowedClis: string[] }>({ maxAgents: 0, maxTurns: 0, allowedClis: ['opencode'] })

  async function fetchUsers() {
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchUsers() }, [])

  async function handleDelete(userId: string, userName: string) {
    const ok = await confirm({
      title: '사용자 삭제',
      message: `"${userName}" 사용자를 삭제하시겠습니까?\n관련 프로젝트, 에이전트 등 모든 데이터가 함께 삭제됩니다.`,
      confirmText: '삭제',
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
      await alert({ message: data.error || '삭제 실패', variant: 'error' })
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
      await alert({ message: data.error || '권한 변경 실패', variant: 'error' })
    }
  }

  async function toggleEditLimits(u: User) {
    if (editingLimits === u.id) {
      // 닫기 — 변경 사항 확인
      const changed = limitValues.maxAgents !== u.maxAgents || limitValues.maxTurns !== u.maxTurns
        || JSON.stringify([...limitValues.allowedClis].sort()) !== JSON.stringify([...(u.allowedClis || [])].sort())
      if (changed) {
        const ok = await confirm({
          title: '변경 사항 저장',
          message: '수정된 제한 설정을 저장하시겠습니까?',
          confirmText: '저장',
          cancelText: '버리기',
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
      await alert({ message: data.error || '저장 실패', variant: 'error' })
    }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">불러오는 중...</div>

  return (
    <main className="px-4 py-4 max-w-lg mx-auto">
      <div className="text-xs text-ive-text-dim mb-3">총 {users.length}명</div>
      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3">
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
                    <span className="text-[10px] font-bold bg-ive-green/15 text-ive-green px-1.5 py-0.5 rounded-full">관리자</span>
                  )}
                </div>
                <div className="text-xs text-ive-text-dim break-all">{u.email}</div>
                <div className="text-xs text-ive-text-dim">{new Date(u.createdAt).toLocaleDateString('ko-KR')} 가입</div>
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
                  title="제한 설정"
                >
                  <i className="fa-solid fa-gauge text-xs" />
                </button>
                <button
                  onClick={() => handleToggleAdmin(u.id, u.isAdmin)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center active:scale-95 transition-all ${
                    u.isAdmin ? 'bg-ive-green/15 text-ive-green' : 'bg-ive-bg-deep text-ive-text-dim'
                  }`}
                  title={u.isAdmin ? '관리자 해제' : '관리자 지정'}
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
                    <i className="fa-solid fa-robot mr-1" />최대 개발자
                  </label>
                  <div className="flex items-center gap-1.5 flex-1">
                    <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxAgents: Math.max(0, v.maxAgents - 1) }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-black">−</button>
                      <span className="w-10 py-1.5 flex items-center justify-center text-xs font-black text-ive-text border-x border-ive-border">
                        {limitValues.maxAgents || '∞'}
                      </span>
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxAgents: v.maxAgents + 1 }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-black">+</button>
                    </div>
                    <span className="text-[10px] text-ive-text-dim">0 = 무제한</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-24 shrink-0">
                    <i className="fa-solid fa-repeat mr-1" />최대 턴 수
                  </label>
                  <div className="flex items-center gap-1.5 flex-1">
                    <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxTurns: Math.max(0, v.maxTurns - 10) }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-black">−</button>
                      <span className="w-10 py-1.5 flex items-center justify-center text-xs font-black text-ive-text border-x border-ive-border">
                        {limitValues.maxTurns || '∞'}
                      </span>
                      <button type="button" onClick={() => setLimitValues(v => ({ ...v, maxTurns: v.maxTurns + 10 }))}
                        className="px-2 py-1.5 text-ive-text-muted hover:text-ive-cyan text-xs font-black">+</button>
                    </div>
                    <span className="text-[10px] text-ive-text-dim">0 = 무제한</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-24 shrink-0">
                    <i className="fa-solid fa-terminal mr-1" />CLI 도구
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
                    취소
                  </button>
                  <button onClick={() => saveLimits(u.id)}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-green-dark text-white active:scale-[0.98]">
                    저장
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
  recipients: string[]
}

interface SendLogEntry {
  id: string; scheduleId: string; reportType: string
  periodStart: string; periodEnd: string; recipientEmail: string
  status: string; errorMessage?: string | null; sentAt: string
}

const REPORT_TYPE_OPTIONS = [
  { value: 'weekly', label: '주간', icon: 'fa-solid fa-calendar-week', schedule: '매주 월요일 09:00' },
  { value: 'monthly', label: '월간', icon: 'fa-solid fa-calendar', schedule: '매월 1일 09:00' },
  { value: 'yearly', label: '연간', icon: 'fa-solid fa-calendar-check', schedule: '매년 1월 1일 09:00' },
]

function MailPanel() {
  const [view, setView] = useState<MailSubView>('broadcast')

  const views: { key: MailSubView; label: string; icon: string }[] = [
    { key: 'broadcast', label: '메일발송', icon: 'fa-solid fa-paper-plane' },
    { key: 'reports', label: '보고서', icon: 'fa-solid fa-file-lines' },
    { key: 'logs', label: '발송이력', icon: 'fa-solid fa-clock-rotate-left' },
  ]

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
      await alert({ message: '제목과 내용을 입력해주세요.', variant: 'info' })
      return
    }
    const targets = selectedIds.size > 0 ? Array.from(selectedIds) : undefined
    if (!targets) {
      const ok = await confirm({
        title: '전체 발송',
        message: '전체 사용자에게 메일을 발송합니다. 계속하시겠습니까?',
        confirmText: '발송',
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
        await alert({ message: data.error || '발송 실패', variant: 'error' })
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
          <label className="text-sm font-bold text-ive-text-muted">수신자</label>
          <button onClick={toggleAll} className="text-xs text-ive-cyan font-bold">
            {selectedIds.size === users.length ? '전체 해제' : '전체 선택'}
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
          {selectedIds.size === 0 ? '선택 없음 = 전체 발송' : `${selectedIds.size}명 선택`}
        </p>
      </div>

      {/* 제목 */}
      <div className="mb-3">
        <label className="block text-sm font-bold text-ive-text-muted mb-1">제목</label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="메일 제목"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 본문 */}
      <div className="mb-4">
        <label className="block text-sm font-bold text-ive-text-muted mb-1">내용 (HTML 가능)</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          placeholder="메일 본문..."
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none"
        />
      </div>

      {result && (
        <div className={`mb-3 text-sm rounded-lg px-3 py-2 ${result.failed ? 'bg-ive-amber/10 text-ive-amber' : 'bg-ive-green/10 text-ive-green'}`}>
          발송 완료: {result.sent}건 성공{result.failed > 0 && `, ${result.failed}건 실패`}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending || !subject.trim() || !body.trim()}
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40"
      >
        {sending ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />발송 중...</> : <><i className="fa-solid fa-paper-plane mr-1" />메일 발송</>}
      </button>
    </>
  )
}

// ── 보고서 스케줄 관리 ──
function ReportScheduleView() {
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
        }),
      })
      if (res.ok) {
        await fetchData()
        setEditing(null)
      } else {
        const data = await res.json()
        await alert({ message: data.error || '저장 실패', variant: 'error' })
      }
    } finally {
      setSaving(null)
    }
  }

  async function handleSendNow(reportType: string) {
    const ok = await confirm({
      title: '즉시 발송',
      message: `${REPORT_TYPE_OPTIONS.find(o => o.value === reportType)?.label} 보고서를 지금 즉시 발송하시겠습니까?`,
      confirmText: '발송',
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
          title: '발송 완료',
          message: `발송 ${data.sent}건 성공${data.failed > 0 ? `, ${data.failed}건 실패` : ''}${data.skipped > 0 ? `, ${data.skipped}건 건너뜀` : ''}`,
          variant: data.failed > 0 ? 'error' : 'success',
        })
      } else {
        await alert({ message: data.error || '발송 실패', variant: 'error' })
      }
    } finally {
      setSending(null)
    }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">불러오는 중...</div>

  // 3종류 보고서에 대해 각각 카드 표시
  return (
    <div className="space-y-3">
      <div className="text-xs text-ive-text-dim mb-1">
        보고서 자동 발송 스케줄을 설정합니다. 중복발송은 자동으로 차단됩니다.
      </div>

      {REPORT_TYPE_OPTIONS.map(opt => {
        const schedule = schedules.find(s => s.reportType === opt.value)
        const isEditing = editing === `rs-${opt.value}`
        const form = isEditing ? editForm : null

        return (
          <div key={opt.value} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
            {/* 헤더 */}
            <div className="px-4 py-3 flex items-center gap-2">
              <i className={`${opt.icon} text-sm ${schedule?.enabled ? 'text-ive-green' : 'text-ive-text-dim'}`} />
              <span className="text-sm font-bold text-ive-text flex-1">{opt.label} 보고서</span>
              {schedule ? (
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${schedule.enabled ? 'bg-ive-green/15 text-ive-green' : 'bg-white/5 text-ive-text-dim'}`}>
                    {schedule.enabled ? '활성' : '비활성'}
                  </span>
                  <span className="text-[10px] text-ive-text-dim">{schedule.recipients.length}명</span>
                  <button
                    onClick={() => handleSendNow(opt.value)}
                    disabled={!schedule?.recipients.length || sending === opt.value}
                    className="w-7 h-7 rounded-lg bg-ive-cyan/10 text-ive-cyan flex items-center justify-center text-xs active:scale-95 disabled:opacity-40"
                    title="즉시 발송"
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
                      recipients: [],
                    }
                    setSchedules(prev => [...prev, newSchedule])
                    startEdit(newSchedule)
                  }}
                  className="text-xs font-bold text-ive-cyan"
                >
                  <i className="fa-solid fa-plus mr-1" />설정
                </button>
              )}
            </div>

            {/* 편집 패널 */}
            {isEditing && form && (
              <div className="px-4 pb-4 border-t border-ive-border-dark space-y-3 pt-3 animate-in fade-in slide-in-from-top-1">
                {/* 활성화 토글 */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-20 shrink-0">상태</label>
                  <button
                    onClick={() => setEditForm(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      form.enabled ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-deep border-ive-border-subtle text-ive-text-dim'
                    }`}
                  >
                    {form.enabled ? '활성' : '비활성'}
                  </button>
                </div>

                {/* 발송 시점 (고정) */}
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-ive-text-muted w-20 shrink-0">발송 시점</label>
                  <span className="text-xs text-ive-cyan font-bold">{opt.schedule} KST</span>
                  <span className="text-[10px] text-ive-text-dim">
                    (지난 {opt.label} 보고서 자동 발송)
                  </span>
                </div>

                {/* 수신자 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-ive-text-muted">수신자</label>
                    <button onClick={toggleAllRecipients} className="text-[10px] text-ive-cyan font-bold">
                      {(form.recipients || []).length === users.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {users.map(u => (
                      <button
                        key={u.id}
                        onClick={() => toggleRecipient(u.email)}
                        className={`text-[11px] px-2 py-1 rounded-full font-bold transition-all ${
                          (form.recipients || []).includes(u.email)
                            ? 'bg-ive-green/20 text-ive-green border border-ive-green/30'
                            : 'bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle'
                        }`}
                      >
                        {u.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-ive-text-dim mt-1">{(form.recipients || []).length}명 선택</p>
                </div>

                {/* 저장/취소 */}
                <div className="flex gap-2">
                  <button onClick={cancelEdit}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle active:scale-[0.98]">
                    취소
                  </button>
                  <button onClick={() => handleSave(opt.value)}
                    disabled={saving === opt.value}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-ive-green-dark text-white active:scale-[0.98] disabled:opacity-40">
                    {saving === opt.value ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />저장 중</> : '저장'}
                  </button>
                </div>
              </div>
            )}

            {/* 요약 정보 (편집 중 아닐 때) */}
            {!isEditing && schedule && schedule.recipients.length > 0 && (
              <div className="px-4 pb-3 text-[11px] text-ive-text-dim">
                {opt.schedule} KST | {schedule.recipients.slice(0, 3).join(', ')}
                {schedule.recipients.length > 3 && ` 외 ${schedule.recipients.length - 3}명`}
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

  if (loading && logs.length === 0) return <div className="text-center py-10 text-ive-text-dim">불러오는 중...</div>

  if (total === 0) {
    return (
      <div className="text-center py-10">
        <i className="fa-solid fa-inbox text-3xl text-ive-text-dim mb-3 block" />
        <p className="text-sm text-ive-text-dim">발송 이력이 없습니다.</p>
      </div>
    )
  }

  const typeLabel = (t: string) => t === 'weekly' ? '주간' : t === 'monthly' ? '월간' : '연간'

  return (
    <div>
      <div className="text-xs text-ive-text-dim mb-3">총 {total}건의 발송 이력</div>

      <div className="space-y-1.5">
        {logs.map(log => (
          <div key={log.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.status === 'success' ? 'bg-ive-green' : 'bg-ive-red'}`} />
              <span className="text-xs font-bold text-ive-text">{typeLabel(log.reportType)}</span>
              <span className="text-[10px] text-ive-text-dim flex-1 truncate">{log.recipientEmail}</span>
              <span className={`text-[10px] font-bold ${log.status === 'success' ? 'text-ive-green' : 'text-ive-red'}`}>
                {log.status === 'success' ? '성공' : '실패'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-ive-text-dim">
              <span>{log.periodStart} ~ {log.periodEnd}</span>
              <span className="ml-auto">{new Date(log.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
            </div>
            {log.errorMessage && (
              <div className="mt-1 text-[10px] text-ive-red bg-ive-red/5 rounded px-2 py-1 break-all">
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

interface SettingGroup {
  key: string
  label: string
  icon: string
  fields: { key: string; label: string; type: 'text' | 'password' | 'number' | 'textarea'; placeholder?: string; defaultValue?: string; rows?: number }[]
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    key: 'cli_paths', label: 'CLI 경로', icon: 'fa-solid fa-terminal',
    fields: [
      { key: 'cli.claude.path', label: 'Claude Code 경로', type: 'text', placeholder: '/usr/local/bin/claude', defaultValue: '/usr/local/bin/claude' },
      { key: 'cli.opencode.path', label: 'OpenCode 경로', type: 'text', placeholder: '/usr/local/bin/opencode', defaultValue: '/usr/local/bin/opencode' },
    ],
  },
  {
    key: 'mail', label: 'SMTP 메일', icon: 'fa-solid fa-envelope',
    fields: [
      { key: 'mail.smtp_host', label: 'SMTP 호스트', type: 'text', placeholder: 'smtp.gmail.com' },
      { key: 'mail.smtp_port', label: 'SMTP 포트', type: 'text', placeholder: '587' },
      { key: 'mail.smtp_user', label: 'SMTP 계정', type: 'text', placeholder: 'user@gmail.com' },
      { key: 'mail.smtp_password', label: 'SMTP 비밀번호', type: 'password', placeholder: '앱 비밀번호' },
      { key: 'mail.from_name', label: '발신자 이름', type: 'text', placeholder: 'IVE' },
      { key: 'mail.domain', label: '메일 도메인', type: 'text', placeholder: 'example.com' },
    ],
  },
  {
    key: 'retention', label: '데이터 보관', icon: 'fa-solid fa-database',
    fields: [
      { key: 'retention.executions_days', label: '실행 기록 보관 (일)', type: 'number', placeholder: '365 — 보고서 원본 데이터. 이 기간이 지난 실행 기록과 로그 파일이 자동 삭제됩니다.' },
      { key: 'retention.snapshots_days', label: '스냅샷 보관 (일)', type: 'number', placeholder: '7 — 프로젝트 카드 스파크라인용. 짧게 유지해도 보고서에는 영향 없습니다.' },
    ],
  },
  {
    key: 'mcp', label: 'MCP 서버', icon: 'fa-solid fa-plug',
    fields: [
      {
        key: 'mcp.config',
        label: 'MCP 서버 설정 (JSON)',
        type: 'textarea',
        rows: 8,
        placeholder: `{\n  "github": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-github"],\n    "environment": { "GITHUB_TOKEN": "ghp_xxx" }\n  }\n}`,
      },
    ],
  },
]

function SettingsPanel() {
  const { alert } = useDialog()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/env')
      .then(r => r.json())
      .then(data => {
        const s = data.settings || {}
        // 기본값이 있는 필드에 값이 없으면 기본값 적용
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
        await alert({ message: data.error || '저장 실패', variant: 'error' })
      }
    } finally { setSaving(false) }
  }

  async function handleTestMail() {
    if (!testEmail) {
      await alert({ message: '수신 주소를 입력해주세요', variant: 'error' })
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
        await alert({ title: '발송 성공', message: `${testEmail}로 테스트 메일을 발송했습니다.`, variant: 'success' })
      } else {
        await alert({ message: data.error || '발송 실패', variant: 'error' })
      }
    } catch {
      await alert({ message: '테스트 실패', variant: 'error' })
    } finally { setTesting(false) }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">불러오는 중...</div>

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-3">
      <div className="text-xs text-ive-text-dim mb-1">
        시스템 설정은 DB에 저장되며 즉시 적용됩니다.
      </div>

      {SETTING_GROUPS.map(group => (
        <div key={group.key} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
          <button
            onClick={() => setExpandedGroup(expandedGroup === group.key ? null : group.key)}
            className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
          >
            <i className={`${group.icon} text-sm text-ive-text-dim`} />
            <span className="text-sm font-bold text-ive-text flex-1">{group.label}</span>
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
                  {field.type === 'textarea' ? (
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
                    placeholder="수신 주소 입력"
                    className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                  />
                  <button
                    onClick={handleTestMail}
                    disabled={testing || !testEmail}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40 whitespace-nowrap"
                  >
                    {testing
                      ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />발송중</>
                      : <><i className="fa-solid fa-paper-plane mr-1" />테스트</>
                    }
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full font-bold py-3 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40 ${
          saved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'
        }`}
      >
        {saving
          ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />저장 중...</>
          : saved
            ? <><i className="fa-solid fa-check mr-1" />저장됨</>
            : <><i className="fa-solid fa-floppy-disk mr-1" />저장</>
        }
      </button>
    </main>
  )
}

// ── Pricing Panel ──
interface PricingItem {
  id: string; cliName: string; modelName: string
  inputPrice: number; outputPrice: number; updatedAt: string
}

const CLI_ICONS: Record<string, string> = {
  claude: 'fa-solid fa-c',
  gemini: 'fa-solid fa-g',
  codex: 'fa-solid fa-code',
}

function PricingPanel() {
  const { alert } = useDialog()
  const [items, setItems] = useState<PricingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/pricing').then(r => r.json()).then(data => {
      setItems(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function updateItem(cliName: string, field: 'modelName' | 'inputPrice' | 'outputPrice', value: string) {
    setItems(prev => prev.map(it =>
      it.cliName === cliName
        ? { ...it, [field]: field === 'modelName' ? value : parseFloat(value) || 0 }
        : it
    ))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map(it => ({
          cliName: it.cliName, modelName: it.modelName,
          inputPrice: it.inputPrice, outputPrice: it.outputPrice,
        })) }),
      })
      if (res.ok) {
        setItems(await res.json())
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        await alert({ message: data.error || '저장 실패', variant: 'error' })
      }
    } finally { setSaving(false) }
  }

  async function handleAutoFetch() {
    setFetching(true)
    try {
      const res = await fetch('/api/settings/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-fetch' }),
      })
      if (res.ok) {
        setItems(await res.json())
        setSaved(false)
        await alert({ title: '갱신 완료', message: '최신 단가가 적용되었습니다.', variant: 'success' })
      } else {
        const data = await res.json()
        await alert({ message: data.error || '갱신 실패', variant: 'error' })
      }
    } finally { setFetching(false) }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">불러오는 중...</div>

  return (
    <main className="px-4 py-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-ive-text-dim">
          토큰 단가 ($/1M tokens) — 보고서 비용 산출에 사용됩니다
        </div>
      </div>

      <div className="space-y-2.5">
        {items.map(it => (
          <div key={it.cliName} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2 mb-2">
              <i className={`${CLI_ICONS[it.cliName] || 'fa-solid fa-robot'} text-sm text-ive-text-dim`} />
              <span className="text-xs font-extrabold text-ive-text uppercase">{it.cliName}</span>
              <input
                value={it.modelName}
                onChange={e => updateItem(it.cliName, 'modelName', e.target.value)}
                className="flex-1 text-xs text-ive-text-muted bg-transparent border-b border-ive-border-dark focus:border-ive-green focus:outline-none px-1 py-0.5 text-right"
                placeholder="모델명"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <div className="text-[10px] text-ive-text-dim mb-0.5">입력 (Input)</div>
                <input
                  type="number"
                  step="0.01"
                  min="0"

                  value={it.inputPrice}
                  onChange={e => updateItem(it.cliName, 'inputPrice', e.target.value)}
                  className="w-full text-sm font-bold text-ive-cyan bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-green"
                />
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-ive-text-dim mb-0.5">출력 (Output)</div>
                <input
                  type="number"
                  step="0.01"
                  min="0"

                  value={it.outputPrice}
                  onChange={e => updateItem(it.cliName, 'outputPrice', e.target.value)}
                  className="w-full text-sm font-bold text-ive-amber bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-green"
                />
              </div>
            </div>
            <div className="text-[10px] text-ive-text-dim mt-1.5 text-right">
              수정: {new Date(it.updatedAt).toLocaleDateString('ko-KR')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={handleAutoFetch}
          disabled={fetching}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold bg-ive-bg-card border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {fetching
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />갱신 중...</>
            : <><i className="fa-solid fa-rotate mr-1" />최신 단가 적용</>
          }
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold active:scale-[0.98] transition-all disabled:opacity-40 ${
            saved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'
          }`}
        >
          {saving
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />저장 중...</>
            : saved
              ? <><i className="fa-solid fa-check mr-1" />저장됨</>
              : <><i className="fa-solid fa-floppy-disk mr-1" />저장</>
          }
        </button>
      </div>
    </main>
  )
}

// ── Activity Panel (사용자 활동 로그) ──

const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
  auth: { label: '인증', icon: 'fa-solid fa-right-to-bracket', color: 'text-ive-cyan' },
  project: { label: '프로젝트', icon: 'fa-solid fa-folder', color: 'text-ive-green' },
  agent: { label: '개발자', icon: 'fa-solid fa-robot', color: 'text-ive-amber' },
  execution: { label: '실행', icon: 'fa-solid fa-play', color: 'text-blue-400' },
  admin: { label: '관리', icon: 'fa-solid fa-shield', color: 'text-ive-red' },
  settings: { label: '설정', icon: 'fa-solid fa-gear', color: 'text-purple-400' },
}

function ActivityPanel() {
  const [logs, setLogs] = useState<UserActivityLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [filterUserId, setFilterUserId] = useState<string>('')
  const [users, setUsers] = useState<User[]>([])
  const offsetRef = useRef(0)
  const PAGE_SIZE = 30

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
  }, [filterCategory, filterUserId])

  useEffect(() => { fetchLogs(true) }, [fetchLogs])

  function handleLoadMore() {
    offsetRef.current += PAGE_SIZE
    fetchLogs(false)
  }

  function formatTime(iso: string) {
    try {
      const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
      return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    } catch { return iso }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">불러오는 중...</div>

  return (
    <main className="px-4 py-4 max-w-lg mx-auto">
      {/* 필터 */}
      <div className="flex gap-2 mb-3">
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2.5 py-2 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        >
          <option value="">전체 카테고리</option>
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={filterUserId}
          onChange={e => setFilterUserId(e.target.value)}
          className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2.5 py-2 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        >
          <option value="">전체 사용자</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-ive-text-dim mb-3">총 {total}건</div>

      {/* 로그 목록 */}
      <div className="space-y-1.5">
        {logs.map(log => {
          const meta = CATEGORY_META[log.category] || CATEGORY_META.auth
          return (
            <div key={log.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-xl px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-ive-bg-deep`}>
                  <i className={`${meta.icon} text-[10px] ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meta.color} bg-ive-bg-deep`}>{meta.label}</span>
                    <span className="text-[10px] text-ive-text-dim">{formatTime(log.createdAt)}</span>
                  </div>
                  <div className="text-xs text-ive-text leading-relaxed">{log.detail}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-ive-text-muted">
                      <i className="fa-solid fa-user mr-0.5" />{log.userName || '알 수 없음'}
                    </span>
                    {log.ipAddress && log.ipAddress !== '0.0.0.0' && (
                      <span className="text-[10px] text-ive-text-dim">
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
          기록된 활동이 없습니다
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
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />불러오는 중...</>
            : <><i className="fa-solid fa-chevron-down mr-1" />더 보기 ({logs.length}/{total})</>
          }
        </button>
      )}
    </main>
  )
}
