'use client'

import { useCallback, useEffect, useState } from 'react'
import { User, DEFAULT_AVATARS } from '@/types'
import { useDialog } from '@/components/ui/ConfirmDialog'
import TerminalTab from './TerminalTab'
import PullToRefresh from '@/components/ui/PullToRefresh'

type SubTab = 'users' | 'mail' | 'settings' | 'pricing' | 'cli'

export default function AdminTab() {
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-subtab')
      if (saved && ['users', 'mail', 'settings', 'pricing', 'cli'].includes(saved)) return saved as SubTab
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
  const [limitValues, setLimitValues] = useState<{ maxAgents: number; maxTurns: number }>({ maxAgents: 0, maxTurns: 0 })

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
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isAdmin: !currentAdmin }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isAdmin: !currentAdmin } : u))
    } else {
      const data = await res.json()
      await alert({ message: data.error || '권한 변경 실패', variant: 'error' })
    }
  }

  async function toggleEditLimits(u: User) {
    if (editingLimits === u.id) {
      // 닫기 — 변경 사항 확인
      const changed = limitValues.maxAgents !== u.maxAgents || limitValues.maxTurns !== u.maxTurns
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
      setLimitValues({ maxAgents: u.maxAgents, maxTurns: u.maxTurns })
    }
  }

  async function saveLimits(userId: string) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, maxAgents: limitValues.maxAgents, maxTurns: limitValues.maxTurns }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, maxAgents: limitValues.maxAgents, maxTurns: limitValues.maxTurns } : u))
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
                <div className="text-xs text-ive-text-dim truncate">{u.email}</div>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-ive-text-dim mt-0.5">
                  <span>가입: {new Date(u.createdAt).toLocaleDateString('ko-KR')}</span>
                  <span className="inline-flex items-center text-ive-cyan">
                    <i className="fa-solid fa-robot mr-0.5" /><span className="hidden sm:inline">개발자 </span>{u.maxAgents || '∞'}
                  </span>
                  <span className="inline-flex items-center text-ive-amber">
                    <i className="fa-solid fa-repeat mr-0.5" /><span className="hidden sm:inline">턴 </span>{u.maxTurns || '∞'}
                  </span>
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
function MailPanel() {
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
    <main className="px-4 py-4 max-w-lg mx-auto">
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
    </main>
  )
}

// ── Settings Panel ──

interface SettingGroup {
  key: string
  label: string
  icon: string
  fields: { key: string; label: string; type: 'text' | 'password' | 'number'; placeholder?: string; defaultValue?: string }[]
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    key: 'cli_paths', label: 'CLI 경로', icon: 'fa-solid fa-terminal',
    fields: [
      { key: 'cli.claude.path', label: 'Claude Code 경로', type: 'text', placeholder: '/usr/local/bin/claude', defaultValue: '/usr/local/bin/claude' },
      { key: 'cli.gemini.path', label: 'Gemini CLI 경로', type: 'text', placeholder: '/usr/local/bin/gemini', defaultValue: '/usr/local/bin/gemini' },
      { key: 'cli.codex.path', label: 'Codex CLI 경로', type: 'text', placeholder: '/usr/local/bin/codex', defaultValue: '/usr/local/bin/codex' },
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
                  <input
                    type={field.type}
                    value={settings[field.key] || ''}
                    onChange={e => updateSetting(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                  />
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
