'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import AgentAvatar from '@/components/agent/AgentAvatar'
import CustomSelect from '@/components/ui/CustomSelect'

type WorkspaceRow = {
  id: string
  teamId: string
  teamName: string
  teamUrl: string
  name: string
  botUserId: string
  defaultUserId: string | null
  enabled: boolean
  createdAt: string
}

type UserRow = { id: string; name: string; email: string; avatar: string }

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
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', defaultUserId: '', enabled: true })

  // 앱 자격증명 (OAuth 설치/로그인 공통)
  const [appCfg, setAppCfg] = useState<{ clientId: string; hasClientSecret: boolean; hasSigningSecret: boolean }>({ clientId: '', hasClientSecret: false, hasSigningSecret: false })
  const [appForm, setAppForm] = useState({ clientId: '', clientSecret: '', signingSecret: '' })
  const [appSaving, setAppSaving] = useState(false)

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

  // 앱 자격증명 로드
  const loadApp = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/slack/app')
      if (res.ok) {
        const d = await res.json()
        setAppCfg(d)
        setAppForm({ clientId: d.clientId || '', clientSecret: '', signingSecret: '' })
      }
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadApp() }, [loadApp])

  // Add to Slack 설치 결과 토스트 (콜백이 ?slack_install_ok / ?slack_install_error 로 리다이렉트)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const ok = p.get('slack_install_ok')
    const err = p.get('slack_install_error')
    if (ok || err) {
      if (ok) { toast(`Slack 설치 완료: ${ok}`, 'success'); load() }
      else toast(`Slack 설치 실패: ${err}`, 'error')
      p.delete('slack_install_ok'); p.delete('slack_install_error')
      const qs = p.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [toast, load])

  async function saveApp() {
    setAppSaving(true)
    try {
      const res = await fetch('/api/admin/slack/app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appForm),
      })
      if (!res.ok) { toast(t('saveFailed'), 'error'); return }
      await loadApp()
      toast(t('appSaved'), 'success')
    } finally {
      setAppSaving(false)
    }
  }

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

  async function copyUrl(key: string, url: string) {
    try { await navigator.clipboard.writeText(url) } catch { /* ignore */ }
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  // Slack 앱에 등록할 주소 — 어느 메뉴에 넣는지까지 한 박스에 정리
  const slackUrls = [
    { key: 'events', menu: t('urlMenuEvents'), url: `${origin}/api/slack/events` },
    { key: 'install', menu: t('urlMenuInstall'), url: `${origin}/api/slack/install/callback` },
  ]

  function ownerUser(id: string | null): UserRow | undefined {
    if (!id) return undefined
    return users.find(u => u.id === id)
  }

  function openEdit(w: WorkspaceRow) {
    setEditing(w)
    setForm({ name: w.name, defaultUserId: w.defaultUserId || '', enabled: w.enabled })
    setShowForm(true)
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/slack/workspaces/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, defaultUserId: form.defaultUserId || null, enabled: form.enabled }),
      })
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-ive-text">
          <i className="fa-brands fa-slack mr-1.5" />{t('title')}
        </h2>
        <a
          href="/api/slack/install/start"
          className={`text-sm font-bold px-3 py-1.5 rounded-lg ${appCfg.clientId ? 'bg-ive-green-dark text-white' : 'bg-ive-bg-input border border-ive-border text-ive-text-dim pointer-events-none opacity-50'}`}
        >
          <i className="fa-solid fa-plus mr-1" />{t('addNew')}
        </a>
      </div>

      {/* 앱 자격증명 + Add to Slack (OAuth 설치) */}
      <div className="bg-ive-bg-card border border-ive-green/20 rounded-lg p-3 mb-3">
        <div className="text-sm font-bold text-ive-green mb-1">
          <i className="fa-solid fa-rocket mr-1.5" />{t('appTitle')}
        </div>
        <div className="text-xs text-ive-text-dim mb-2 leading-relaxed">{t('appDesc')}</div>
        <div className="flex flex-col gap-2">
          <div>
            <label className="block text-xs font-bold text-ive-text-muted mb-1">Client ID</label>
            <input
              type="text" value={appForm.clientId}
              onChange={e => setAppForm(f => ({ ...f, clientId: e.target.value }))}
              placeholder="1234567890.1234567890"
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-bold text-ive-text-muted mb-1">Client Secret {appCfg.hasClientSecret && <span className="text-ive-green">✓</span>}</label>
              <input
                type="password" value={appForm.clientSecret}
                onChange={e => setAppForm(f => ({ ...f, clientSecret: e.target.value }))}
                placeholder={appCfg.hasClientSecret ? t('ifBlankNoChange') : ''}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-ive-text-muted mb-1">Signing Secret {appCfg.hasSigningSecret && <span className="text-ive-green">✓</span>}</label>
              <input
                type="password" value={appForm.signingSecret}
                onChange={e => setAppForm(f => ({ ...f, signingSecret: e.target.value }))}
                placeholder={appCfg.hasSigningSecret ? t('ifBlankNoChange') : ''}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
              />
            </div>
          </div>
          <div className="flex items-center justify-end">
            <button onClick={saveApp} disabled={appSaving} className="bg-ive-bg-input border border-ive-border text-ive-text text-sm font-bold px-3 py-1.5 rounded-lg disabled:opacity-50">
              {appSaving ? <><i className="fa-solid fa-spinner fa-spin mr-1" />{t('saving')}</> : t('appSave')}
            </button>
          </div>
        </div>
      </div>

      {/* Slack에 등록할 주소 — 어느 메뉴에 넣는지까지 한 박스에 */}
      <div className="bg-ive-bg-card border border-ive-cyan/20 rounded-lg p-3 mb-3">
        <div className="text-sm font-bold text-ive-cyan mb-2">
          <i className="fa-solid fa-link mr-1.5" />{t('urlsTitle')}
        </div>
        <div className="flex flex-col gap-2.5">
          {slackUrls.map(({ key, menu, url }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-bold text-ive-text-muted">{menu}</span>
                <button
                  onClick={() => copyUrl(key, url)}
                  className={`text-xs font-bold px-2 py-0.5 rounded transition-colors ${copiedKey === key ? 'text-ive-green bg-ive-green/15' : 'text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20'}`}
                >
                  <i className={`fa-solid ${copiedKey === key ? 'fa-check' : 'fa-copy'} mr-1`} />{copiedKey === key ? t('copiedBtn') : t('copyBtn')}
                </button>
              </div>
              <div className="font-mono text-xs text-ive-text break-all bg-ive-bg-deep rounded px-2 py-1.5">{url}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-ive-text-dim mt-2 leading-relaxed">{t('urlsHint')}</div>
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
          {workspaces.map(w => {
            const ow = ownerUser(w.defaultUserId)
            const urlText = w.teamUrl ? w.teamUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : ''
            return (
            <div key={w.id} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5 flex items-start gap-2.5 ${!w.enabled ? 'opacity-60' : ''}`}>
              <i className="fa-brands fa-slack text-ive-cyan shrink-0 mt-1" />
              {/* 넓으면 한 줄, 좁으면 줄바꿈(flex-wrap) */}
              <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-bold text-ive-text shrink-0">{w.name}</span>
                {!w.enabled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ive-red/20 text-ive-red shrink-0">{t('disabledBadge')}</span>}
                <span className="flex items-center gap-1.5 text-xs text-ive-text-dim min-w-0">
                  {ow && <AgentAvatar avatar={ow.avatar} userId={ow.id} size="xs" />}
                  <span className="shrink-0">{ow ? ow.name : <span className="text-ive-amber">{t('ownerNone')}</span>}</span>
                  {urlText && (
                    <>
                      <span className="text-ive-text-dim/40 shrink-0">·</span>
                      <a href={w.teamUrl} target="_blank" rel="noreferrer" className="text-ive-cyan truncate min-w-0 hover:underline">{urlText}</a>
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => openEdit(w)} className="text-ive-cyan text-sm px-2 py-1 font-bold" title={t('editTitle')}><i className="fa-solid fa-pen" /></button>
                <button onClick={() => remove(w)} className="text-ive-red text-sm px-2 py-1 font-bold" title={t('deleteTitle')}><i className="fa-solid fa-trash" /></button>
              </div>
            </div>
          )})}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t('editTitle') : t('createTitle')} closeOnBackdrop={false}>
        <div className="flex flex-col gap-3">
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
            <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('ownerLabel')}</label>
            <CustomSelect
              value={form.defaultUserId}
              onChange={v => setForm(f => ({ ...f, defaultUserId: v }))}
              placeholder={t('ownerNone')}
              options={[
                { value: '', label: t('ownerNone') },
                ...users.map(u => ({ value: u.id, label: u.name, hint: u.email })),
              ]}
            />
            <div className="text-xs text-ive-text-dim mt-1">{t('ownerDesc')}</div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className="flex items-center gap-2 text-sm text-ive-text"
            >
              <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${form.enabled ? 'bg-ive-green' : 'bg-ive-border'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-4' : ''}`} />
              </span>
              {t('enabledCheckbox')}
            </button>
            <div className="text-xs text-ive-text-dim mt-1">{t('enabledDesc')}</div>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={() => setShowForm(false)} className="flex-1 h-10 inline-flex items-center justify-center rounded-lg text-sm font-bold bg-ive-bg-input border border-ive-border text-ive-text">
              {t('cancel')}
            </button>
            <button onClick={save} disabled={saving} className="flex-1 h-10 inline-flex items-center justify-center rounded-lg text-sm font-bold bg-ive-green-dark border border-transparent text-white disabled:opacity-50">
              {saving ? <><i className="fa-solid fa-spinner fa-spin mr-1" />{t('saving')}</> : t('save')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
