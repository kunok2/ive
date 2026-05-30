'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'

type WorkspaceRow = {
  id: string
  teamId: string
  teamName: string
  name: string
  botUserId: string
  defaultUserId: string | null
  enabled: boolean
  createdAt: string
}

type UserRow = { id: string; name: string; email: string }
type MappingRow = { workspaceId: string; slackUserId: string; iveUserId: string }

const MASK = '__secret_set__'

export default function SlackWorkspacesPanel() {
  const t = useTranslations('admin.slack')
  const { confirm } = useDialog()
  const { toast } = useToast()

  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<WorkspaceRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({ name: '', botToken: '', signingSecret: '', defaultUserId: '', enabled: true })

  // 매핑 (수정 모드)
  const [mappings, setMappings] = useState<MappingRow[]>([])
  const [mapSlackUser, setMapSlackUser] = useState('')
  const [mapIveUser, setMapIveUser] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wsRes, uRes] = await Promise.all([
        fetch('/api/admin/slack/workspaces'),
        fetch('/api/admin/users'),
      ])
      if (wsRes.ok) setWorkspaces(await wsRes.json())
      if (uRes.ok) setUsers(await uRes.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Request URL origin (oauth.redirect_base 재사용, 없으면 브라우저 origin)
  const [redirectBase, setRedirectBase] = useState('')
  useEffect(() => {
    fetch('/api/admin/env')
      .then(r => r.json())
      .then(d => setRedirectBase((d?.settings?.['oauth.redirect_base'] || '').replace(/\/+$/, '')))
      .catch(() => {})
  }, [])
  const browserOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const origin = redirectBase || browserOrigin
  const requestUrl = `${origin}/api/slack/events`

  async function copyRequestUrl() {
    try { await navigator.clipboard.writeText(requestUrl) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function userName(id: string | null): string {
    if (!id) return ''
    const u = users.find(u => u.id === id)
    return u ? `${u.name} (${u.email})` : id
  }

  function openCreate() {
    setEditing(null)
    setForm({ name: '', botToken: '', signingSecret: '', defaultUserId: '', enabled: true })
    setMappings([])
    setShowForm(true)
  }

  async function openEdit(w: WorkspaceRow) {
    setEditing(w)
    setForm({ name: w.name, botToken: '', signingSecret: '', defaultUserId: w.defaultUserId || '', enabled: w.enabled })
    setShowForm(true)
    // 매핑 로드
    try {
      const res = await fetch(`/api/admin/slack/workspaces/${w.id}/mappings`)
      if (res.ok) setMappings(await res.json())
      else setMappings([])
    } catch { setMappings([]) }
    setMapSlackUser(''); setMapIveUser('')
  }

  async function save() {
    if (!editing && (!form.botToken || !form.signingSecret)) {
      toast(t('validationRequired'), 'error')
      return
    }
    setSaving(true)
    try {
      let res: Response
      if (editing) {
        const patch: any = { name: form.name, defaultUserId: form.defaultUserId || null, enabled: form.enabled }
        if (form.botToken) patch.botToken = form.botToken
        if (form.signingSecret) patch.signingSecret = form.signingSecret
        res = await fetch(`/api/admin/slack/workspaces/${editing.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        })
      } else {
        res = await fetch('/api/admin/slack/workspaces', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name, botToken: form.botToken, signingSecret: form.signingSecret, defaultUserId: form.defaultUserId || null, enabled: form.enabled }),
        })
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }))
        toast(err.error || t('saveFailed'), 'error')
        return
      }
      setShowForm(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(w: WorkspaceRow) {
    const ok = await confirm({ title: t('deleteTitle'), message: t('deleteConfirm', { name: w.name }), variant: 'danger' })
    if (!ok) return
    const res = await fetch(`/api/admin/slack/workspaces/${w.id}`, { method: 'DELETE' })
    if (res.ok) await load()
  }

  async function addMapping() {
    if (!editing || !mapSlackUser.trim() || !mapIveUser) return
    const res = await fetch(`/api/admin/slack/workspaces/${editing.id}/mappings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slackUserId: mapSlackUser.trim(), iveUserId: mapIveUser }),
    })
    if (res.ok) {
      const r = await fetch(`/api/admin/slack/workspaces/${editing.id}/mappings`)
      if (r.ok) setMappings(await r.json())
      setMapSlackUser(''); setMapIveUser('')
    } else {
      const err = await res.json().catch(() => ({ error: 'unknown' }))
      toast(err.error || t('saveFailed'), 'error')
    }
  }

  async function removeMapping(slackUserId: string) {
    if (!editing) return
    const res = await fetch(`/api/admin/slack/workspaces/${editing.id}/mappings?slackUserId=${encodeURIComponent(slackUserId)}`, { method: 'DELETE' })
    if (res.ok) setMappings(ms => ms.filter(m => m.slackUserId !== slackUserId))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-ive-text">
          <i className="fa-brands fa-slack mr-1.5" />{t('title')}
        </h2>
        <button onClick={openCreate} className="bg-ive-green-dark text-white text-sm font-bold px-3 py-1.5 rounded-lg">
          <i className="fa-solid fa-plus mr-1" />{t('addNew')}
        </button>
      </div>

      {/* Request URL 박스 */}
      <div className="bg-ive-bg-card border border-ive-cyan/20 rounded-lg p-2.5 mb-3 text-xs">
        <div className="flex items-center justify-between mb-1">
          <div className="text-ive-cyan font-bold">
            <i className="fa-solid fa-link mr-1" />{t('requestUrlTitle')}
          </div>
          <button
            onClick={copyRequestUrl}
            className={`font-bold px-2 py-0.5 rounded transition-colors ${copied ? 'text-ive-green bg-ive-green/15' : 'text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20'}`}
          >
            <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'} mr-1`} />{copied ? t('copiedBtn') : t('copyBtn')}
          </button>
        </div>
        <div className="font-mono text-ive-text break-all">{requestUrl}</div>
        <div className="text-ive-text-dim mt-1 leading-relaxed">{t('requestUrlHint')}</div>
      </div>

      <details className="text-sm text-ive-text-muted mb-3 bg-ive-bg-card border border-ive-border-subtle rounded-lg">
        <summary className="cursor-pointer px-3 py-2 font-bold text-ive-text">
          <i className="fa-solid fa-circle-info mr-1.5 text-ive-cyan" />{t('howTo')}
        </summary>
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
          <div className="text-ive-text-dim">{t('howToIntro')}</div>
          <ol className="list-decimal list-inside flex flex-col gap-1 text-xs text-ive-text-dim">
            <li>{t('step1')}</li>
            <li>{t('step2')}</li>
            <li>{t('step3')}</li>
            <li>{t('step4')}</li>
            <li>{t('step5')}</li>
          </ol>
        </div>
      </details>

      {loading ? (
        <div className="text-center text-ive-text-dim py-8"><i className="fa-solid fa-spinner fa-spin mr-1" />{t('loading')}</div>
      ) : workspaces.length === 0 ? (
        <div className="text-center text-ive-text-dim py-8">{t('empty')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {workspaces.map(w => (
            <div key={w.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <i className="fa-brands fa-slack text-ive-cyan" />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ive-text truncate">{w.name}</div>
                    <div className="text-xs text-ive-text-dim font-mono truncate">{t('teamLabel')}: {w.teamName || w.teamId}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${w.enabled ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-red/20 text-ive-red'}`}>
                    {w.enabled ? t('enabledBadge') : t('disabledBadge')}
                  </span>
                  <button onClick={() => openEdit(w)} className="text-ive-cyan text-sm px-2 font-bold"><i className="fa-solid fa-pen" /></button>
                  <button onClick={() => remove(w)} className="text-ive-red text-sm px-2 font-bold"><i className="fa-solid fa-trash" /></button>
                </div>
              </div>
              {w.defaultUserId && (
                <div className="mt-2 text-xs text-ive-text-dim">
                  <i className="fa-solid fa-user mr-1" />{t('defaultUserLabel')}: {userName(w.defaultUserId)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t('editTitle') : t('createTitle')} closeOnBackdrop={false}>
        <div className="flex flex-col gap-3 px-4 py-4">
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('nameLabel')}</label>
            <input
              type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('namePlaceholder')}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">
              {t('botTokenLabel')} {editing ? t('onlyIfChanging') : '*'}
            </label>
            <input
              type="password" value={form.botToken}
              onChange={e => setForm(f => ({ ...f, botToken: e.target.value }))}
              placeholder={editing ? t('ifBlankNoChange') : 'xoxb-...'}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">
              {t('signingSecretLabel')} {editing ? t('onlyIfChanging') : '*'}
            </label>
            <input
              type="password" value={form.signingSecret}
              onChange={e => setForm(f => ({ ...f, signingSecret: e.target.value }))}
              placeholder={editing ? t('ifBlankNoChange') : ''}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('defaultUserLabel')}</label>
            <select
              value={form.defaultUserId}
              onChange={e => setForm(f => ({ ...f, defaultUserId: e.target.value }))}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text"
            >
              <option value="">{t('defaultUserNone')}</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
            <div className="text-xs text-ive-text-dim mt-1">{t('defaultUserDesc')}</div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-ive-text">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
              {t('enabledCheckbox')}
            </label>
          </div>

          {/* 개인 매핑 (수정 모드에서만) */}
          {editing && (
            <div className="border-t border-ive-border-subtle pt-3">
              <div className="text-xs font-bold text-ive-text mb-1">
                <i className="fa-solid fa-user-tag mr-1 text-ive-cyan" />{t('mappingsTitle')}
              </div>
              <div className="text-xs text-ive-text-dim mb-2">{t('mappingsDesc')}</div>
              {mappings.length === 0 ? (
                <div className="text-xs text-ive-text-dim mb-2">{t('noMappings')}</div>
              ) : (
                <div className="flex flex-col gap-1 mb-2">
                  {mappings.map(m => (
                    <div key={m.slackUserId} className="flex items-center justify-between bg-ive-bg-deep rounded-lg px-2 py-1 text-xs">
                      <span className="font-mono text-ive-text truncate">{m.slackUserId} → {userName(m.iveUserId)}</span>
                      <button onClick={() => removeMapping(m.slackUserId)} className="text-ive-red px-1"><i className="fa-solid fa-xmark" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input
                  type="text" value={mapSlackUser}
                  onChange={e => setMapSlackUser(e.target.value)}
                  placeholder={t('slackUserIdPlaceholder')}
                  className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text font-mono"
                />
                <select
                  value={mapIveUser}
                  onChange={e => setMapIveUser(e.target.value)}
                  className="bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text max-w-[40%]"
                >
                  <option value="">{t('mappingUserLabel')}</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button onClick={addMapping} className="bg-ive-cyan/15 text-ive-cyan font-bold px-2.5 py-1.5 rounded-lg text-xs shrink-0">
                  <i className="fa-solid fa-plus" />
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-bg-input border border-ive-border text-ive-text">
              {t('cancel')}
            </button>
            <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green-dark text-white disabled:opacity-50">
              {saving ? <><i className="fa-solid fa-spinner fa-spin mr-1" />{t('saving')}</> : t('save')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
