'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { User, DEFAULT_AVATARS } from '@/types'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import ActivityContent from './ActivityContent'

type UsersSubView = 'users' | 'activity'

export default function UsersPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const ta = useTranslations('agent')
  const { confirm, alert } = useDialog()
  const { toast } = useToast()
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
      toast(data.error || tc('deleteFailed'), 'error')
    }
    setDeleting(null)
  }

  async function handleToggleAdmin(userId: string, currentAdmin: boolean) {
    const newAdmin = !currentAdmin
    const body: any = { userId, isAdmin: newAdmin }
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
      toast(data.error || t('permissionChangeFailed'), 'error')
    }
  }

  async function toggleEditLimits(u: User) {
    if (editingLimits === u.id) {
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
      toast(data.error || tc('saveFailed'), 'error')
    }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  if (view === 'activity') {
    return (
      <main>
        <div className="sticky top-0 z-10 bg-ive-bg-deep pb-2">
          <div className="flex gap-1.5">
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
        </div>
        <ActivityContent />
      </main>
    )
  }

  return (
    <main>
      <div className="sticky top-0 z-10 bg-ive-bg-deep pb-2">
        <div className="flex gap-1.5">
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
                <div className="flex items-center gap-x-2 text-xs mt-0.5 text-ive-text-muted">
                  <span className="inline-flex items-center">
                    <i className="fa-solid fa-robot mr-0.5" />{u.maxAgents || '∞'}
                  </span>
                  <span className="inline-flex items-center">
                    <i className="fa-solid fa-repeat mr-0.5" />{u.maxTurns || '∞'}
                  </span>
                  <span className="text-ive-text-dim">|</span>
                  {(u.allowedClis || []).map(cli => (
                    <span key={cli} className="inline-flex items-center">
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
