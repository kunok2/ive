'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'

type ProviderType = 'github' | 'gitlab' | 'slack'

type OAuthProviderRow = {
  id: string
  type: ProviderType
  name: string
  baseUrl: string
  clientId: string
  hasSigningSecret?: boolean
  enabled: boolean
  createdAt: string
}

export default function OAuthProvidersPanel() {
  const t = useTranslations('admin.oauth')
  const { alert, confirm } = useDialog()
  const { toast } = useToast()
  const [providers, setProviders] = useState<OAuthProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<OAuthProviderRow | null>(null)
  const [form, setForm] = useState({
    id: '',
    type: 'gitlab' as ProviderType,
    name: '',
    baseUrl: 'https://gitlab.com',
    clientId: '',
    clientSecret: '',
    signingSecret: '',
    enabled: true,
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/oauth-providers')
      if (res.ok) setProviders(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 시스템 설정(`oauth.redirect_base`)을 불러와 콜백 URL 프리뷰에 사용.
  // 비어 있으면 현재 브라우저 origin을 폴백으로 씀.
  const [redirectBase, setRedirectBase] = useState<string>('')
  useEffect(() => {
    fetch('/api/admin/env')
      .then(r => r.json())
      .then(data => setRedirectBase((data?.settings?.['oauth.redirect_base'] || '').replace(/\/+$/, '')))
      .catch(() => {})
  }, [])
  const browserOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const origin = redirectBase || browserOrigin
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function copyText(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // fallback — textarea select
      const ta = document.createElement('textarea')
      ta.value = url; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }
  function copyCallbackUrl() {
    copyText('callback', `${origin}/api/auth/oauth/${form.id}/callback`)
  }
  const copied = copiedKey === 'callback'

  // 타입당 1개 제약 — 이미 등록된 타입 확인
  const hasGitlab = providers.some(p => p.type === 'gitlab')
  const hasGithub = providers.some(p => p.type === 'github')
  const hasSlack = providers.some(p => p.type === 'slack')
  const allRegistered = hasGitlab && hasGithub && hasSlack

  // provider별 인라인 도움말 키 + "값을 가져오고 Redirect를 등록하는" 사이트 링크
  const providerHelp = {
    github: { cred: 'helpCredGithub', redirect: 'helpRedirectGithub' },
    gitlab: { cred: 'helpCredGitlab', redirect: 'helpRedirectGitlab' },
    slack: { cred: 'helpCredSlack', redirect: 'helpRedirectSlack' },
  }[form.type]
  const providerSiteUrl =
    form.type === 'github' ? `${(form.baseUrl || 'https://github.com').replace(/\/+$/, '')}/settings/developers`
    : form.type === 'gitlab' ? `${(form.baseUrl || 'https://gitlab.com').replace(/\/+$/, '')}/-/user_settings/applications`
    : 'https://api.slack.com/apps'
  // 앱 등록 시 올릴 IVE 아이콘 (slack은 권장 1024px 버전)
  const providerIcon = form.type === 'slack' ? '/slack-icon-1024.png' : '/icon-512.png'
  const editingHasSigningSecret = !!editing?.hasSigningSecret

  // slack은 id/baseUrl이 고정. type별 기본값 헬퍼.
  function defaultsFor(type: ProviderType) {
    if (type === 'slack') return { id: 'slack', name: 'Slack', baseUrl: 'https://slack.com' }
    if (type === 'github') return { id: '', name: '', baseUrl: 'https://github.com' }
    return { id: '', name: '', baseUrl: 'https://gitlab.com' }
  }

  function openCreate() {
    if (allRegistered) return
    setEditing(null)
    const defaultType: ProviderType = !hasGitlab ? 'gitlab' : !hasGithub ? 'github' : 'slack'
    const d = defaultsFor(defaultType)
    setForm({
      id: d.id,
      type: defaultType,
      name: d.name,
      baseUrl: d.baseUrl,
      clientId: '',
      clientSecret: '',
      signingSecret: '',
      enabled: true,
    })
    setShowForm(true)
  }

  function openEdit(p: OAuthProviderRow) {
    setEditing(p)
    setForm({
      id: p.id,
      type: p.type,
      name: p.name,
      baseUrl: p.baseUrl,
      clientId: p.clientId,
      clientSecret: '', // 공백 = 변경 없음
      signingSecret: '',
      enabled: p.enabled,
    })
    setShowForm(true)
  }

  async function save() {
    if (!form.id || !form.name || !form.baseUrl || !form.clientId) {
      toast(t('validationRequired'), 'error')
      return
    }
    if (!editing && !form.clientSecret) {
      toast(t('validationSecret'), 'error')
      return
    }
    setSaving(true)
    try {
      let res: Response
      if (editing) {
        const patch: any = {
          name: form.name,
          baseUrl: form.baseUrl,
          clientId: form.clientId,
          enabled: form.enabled,
        }
        if (form.clientSecret) patch.clientSecret = form.clientSecret
        if (form.type === 'slack' && form.signingSecret) patch.signingSecret = form.signingSecret
        res = await fetch(`/api/admin/oauth-providers/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      } else {
        res = await fetch('/api/admin/oauth-providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
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

  async function remove(p: OAuthProviderRow) {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteConfirm', { name: p.name, id: p.id }),
      variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`/api/admin/oauth-providers/${p.id}`, { method: 'DELETE' })
    if (res.ok) await load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-ive-text">
          <i className="fa-solid fa-key mr-1.5" />{t('title')}
        </h2>
        <button
          onClick={openCreate}
          disabled={allRegistered}
          title={allRegistered ? t('allRegistered') : undefined}
          className="bg-ive-green-dark text-white text-sm font-bold px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <i className="fa-solid fa-plus mr-1" />{t('addNew')}
        </button>
      </div>

      <details className="text-sm text-ive-text-muted mb-3 bg-ive-bg-card border border-ive-border-subtle rounded-lg">
        <summary className="cursor-pointer px-3 py-2 font-bold text-ive-text">
          <i className="fa-solid fa-circle-info mr-1.5 text-ive-cyan" />{t('howTo')}
        </summary>
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2.5">
          <div className="text-ive-text-dim">{t('howToIntro')}</div>

          <div className={`bg-ive-bg-deep border rounded-lg p-2.5 text-xs ${redirectBase ? 'border-ive-green/30' : 'border-ive-amber/30'}`}>
            <div className={`font-bold mb-1 ${redirectBase ? 'text-ive-green' : 'text-ive-amber'}`}>
              <i className={`fa-solid ${redirectBase ? 'fa-circle-check' : 'fa-triangle-exclamation'} mr-1`} />
              {t('redirectBaseBoxTitle')}
            </div>
            <div className="text-ive-text-dim leading-relaxed whitespace-pre-line">
              {t('redirectBaseDesc')}
              {redirectBase ? (
                <span className="block mt-1 text-ive-green">
                  {t('redirectBaseCurrent', { value: redirectBase })}
                </span>
              ) : (
                <span className="block mt-1 text-ive-amber">
                  {t('redirectBaseMissing', { value: browserOrigin })}
                </span>
              )}
            </div>
          </div>

          <div className="bg-ive-bg-deep border border-ive-border-subtle rounded-lg p-2.5">
            <div className="text-ive-text font-bold mb-1.5">{t('recommendedOrder')}</div>
            <ol className="list-decimal list-inside flex flex-col gap-1 text-xs">
              <li>{t('orderStep1')}</li>
              <li>{t('orderStep2')}</li>
              <li>{t('orderStep3')}</li>
              <li>
                {t('orderStep4Line')}
                <div className="mt-1 ml-4 text-ive-text-dim">
                  • {t('orderStep4Gitlab', { url: '<base-url>/-/user_settings/applications' })}<br/>
                  • {t('orderStep4Github', { url: 'https://github.com/settings/developers' })}<br/>
                  • {t('orderStep4Paste')}<br/>
                  • {t('orderStep4Scopes')}<br/>
                  • {t('orderStep4Save')}
                </div>
              </li>
              <li>{t('orderStep5')}</li>
              <li>{t('orderStep6')}</li>
            </ol>
          </div>

          {/* Slack 전용 설정 가이드 — 순서 + 스코프별 용도(이미지 읽기/그려보여주기 포함) */}
          <div className="bg-ive-bg-deep border border-ive-cyan/20 rounded-lg p-2.5 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-ive-cyan font-bold">
                <i className="fa-brands fa-slack mr-1" />{t('slackSetupTitle')}
              </span>
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20 px-2 py-0.5 rounded whitespace-nowrap"
              >
                api.slack.com/apps<i className="fa-solid fa-arrow-up-right-from-square ml-1 text-[9px]" />
              </a>
            </div>
            <div className="text-ive-text-dim whitespace-pre-line leading-relaxed">{t('slackSetupSteps')}</div>
            <div className="mt-2 text-ive-text font-bold">{t('slackScopePurposeTitle')}</div>
            <div className="text-ive-text-dim whitespace-pre-line leading-relaxed font-mono">{t('slackScopePurposes')}</div>
          </div>

          <div className="bg-ive-bg-deep border border-ive-amber/20 rounded-lg p-2.5 text-xs">
            <div className="text-ive-amber font-bold mb-1">
              <i className="fa-solid fa-triangle-exclamation mr-1" />{t('noteTitle')}
            </div>
            <ul className="list-disc list-inside flex flex-col gap-0.5 text-ive-text-dim">
              <li>{t('note1')}</li>
              <li>{t('note2')}</li>
              <li>{t('note3')}</li>
              <li>{t('note4')}</li>
            </ul>
          </div>

          <div className="text-xs">
            <span className="text-ive-text-dim">{t('callbackFormat')} </span>
            <span className="font-mono text-ive-text break-all">{origin}/api/auth/oauth/&lt;ID&gt;/callback</span>
          </div>
        </div>
      </details>

      {loading ? (
        <div className="text-center text-ive-text-dim py-8">
          <i className="fa-solid fa-spinner fa-spin mr-1" />{t('loading')}
        </div>
      ) : providers.length === 0 ? (
        <div className="text-center text-ive-text-dim py-8">{t('empty')}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map(p => (
            <div key={p.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <i className={`fa-brands ${p.type === 'github' ? 'fa-github' : p.type === 'slack' ? 'fa-slack' : 'fa-gitlab'} text-ive-cyan`} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ive-text truncate">{p.name}</div>
                    <div className="text-xs text-ive-text-dim font-mono truncate">{p.id} · {p.baseUrl}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${p.enabled ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-red/20 text-ive-red'}`}>
                    {p.enabled ? t('enabledBadge') : t('disabledBadge')}
                  </span>
                  <button onClick={() => openEdit(p)} className="text-ive-cyan text-sm px-2 font-bold">
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button onClick={() => remove(p)} className="text-ive-red text-sm px-2 font-bold">
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
              <div className="mt-2 text-xs text-ive-text-dim font-mono break-all">
                {t('callbackLabel')}: {origin}/api/auth/oauth/{p.id}/callback
              </div>
              {/* 봇(앱 추가)이 설정된 Slack이면(=Signing Secret 등록) 봇 콜백도 함께 표시 */}
              {p.type === 'slack' && p.hasSigningSecret && (
                <div className="mt-1 text-xs text-ive-text-dim font-mono break-all">
                  {t('slackUrlEvents')}: {origin}/api/slack/events<br />
                  {t('slackUrlInstall')}: {origin}/api/slack/install/callback
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t('editTitle') : t('createTitle')}
        closeOnBackdrop={false}
      >
        <div className="flex flex-col gap-3 px-4 py-4">
              {!editing && form.type !== 'slack' && (
                <div className="bg-ive-bg-deep border border-ive-cyan/20 rounded-lg p-2.5 text-xs text-ive-text-dim">
                  <div className="text-ive-cyan font-bold mb-1">
                    <i className="fa-solid fa-lightbulb mr-1" />{t('summaryTitle')}
                  </div>
                  <ol className="list-decimal list-inside flex flex-col gap-0.5">
                    <li>{t('summary1')}</li>
                    <li>{t('summary2')}</li>
                    <li>{t('summary3')}</li>
                  </ol>
                </div>
              )}
              {!editing && form.type === 'slack' && (
                <div className="bg-ive-bg-deep border border-ive-cyan/20 rounded-lg p-2.5 text-xs text-ive-text-dim">
                  <i className="fa-brands fa-slack mr-1 text-ive-cyan" />
                  {t.rich('slackCreateHint', {
                    link: (chunks) => (
                      <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-ive-cyan font-bold hover:underline">
                        {chunks}<i className="fa-solid fa-arrow-up-right-from-square ml-0.5 text-[9px]" />
                      </a>
                    ),
                  })}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('typeLabel')} *</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!!editing || (!editing && hasGitlab && form.type !== 'gitlab')}
                    onClick={() => setForm(f => ({ ...f, ...defaultsFor('gitlab'), type: 'gitlab', name: f.name }))}
                    title={!editing && hasGitlab ? t('alreadyGitlab') : undefined}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border ${form.type === 'gitlab' ? 'border-ive-green text-ive-green bg-ive-green/10' : 'border-ive-border text-ive-text-dim'} disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <i className="fa-brands fa-gitlab mr-1" />GitLab{!editing && hasGitlab ? ` ${t('alreadyTag')}` : ''}
                  </button>
                  <button
                    type="button"
                    disabled={!!editing || (!editing && hasGithub && form.type !== 'github')}
                    onClick={() => setForm(f => ({ ...f, ...defaultsFor('github'), type: 'github', name: f.name }))}
                    title={!editing && hasGithub ? t('alreadyGithub') : undefined}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border ${form.type === 'github' ? 'border-ive-green text-ive-green bg-ive-green/10' : 'border-ive-border text-ive-text-dim'} disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <i className="fa-brands fa-github mr-1" />GitHub{!editing && hasGithub ? ` ${t('alreadyTag')}` : ''}
                  </button>
                  <button
                    type="button"
                    disabled={!!editing || (!editing && hasSlack && form.type !== 'slack')}
                    onClick={() => setForm(f => ({ ...f, ...defaultsFor('slack'), type: 'slack' }))}
                    title={!editing && hasSlack ? t('alreadySlack') : undefined}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border ${form.type === 'slack' ? 'border-ive-green text-ive-green bg-ive-green/10' : 'border-ive-border text-ive-text-dim'} disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <i className="fa-brands fa-slack mr-1" />Slack{!editing && hasSlack ? ` ${t('alreadyTag')}` : ''}
                  </button>
                </div>
              </div>
              {/* id: github/gitlab만 사용자 지정. slack은 고정('slack')이라 입력칸 숨김 */}
              {form.type !== 'slack' && (
                <div>
                  <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('idLabel')} *</label>
                  <input
                    type="text"
                    value={form.id}
                    onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                    disabled={!!editing}
                    placeholder="gh-main, gitlab-com, gitlab-company"
                    className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono disabled:opacity-60"
                  />
                  <div className="text-xs text-ive-text-dim mt-1">{t('idDesc')}</div>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('nameLabel')} *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('namePlaceholder')}
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text"
                />
                {/* 앱 등록 단계: 이름은 자유, 아이콘은 IVE 아이콘 다운로드해 업로드 */}
                <div className="text-xs text-ive-text-dim mt-1.5 flex items-center gap-2 flex-wrap">
                  <span><i className="fa-solid fa-circle-info mr-1 text-ive-cyan" />{t('appNameHint')}</span>
                  <a
                    href={providerIcon}
                    download
                    className="inline-flex items-center gap-1 text-ive-cyan font-bold hover:underline"
                  >
                    <img src={providerIcon} alt="" className="w-4 h-4 rounded" />
                    {t('downloadIcon')}<i className="fa-solid fa-download text-[9px]" />
                  </a>
                </div>
              </div>
              {form.type !== 'slack' && (
                <div>
                  <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('baseUrlLabel')} *</label>
                  <input
                    type="url"
                    value={form.baseUrl}
                    onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://gitlab.com"
                    className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-ive-text-muted mb-1">{t('clientIdLabel')} *</label>
                <input
                  type="text"
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ive-text-muted mb-1">
                  {t('clientSecretLabel')} {editing ? t('onlyIfChanging') : '*'}
                </label>
                <input
                  type="password"
                  value={form.clientSecret}
                  onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                  placeholder={editing ? t('ifBlankNoChange') : ''}
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
                />
                {/* Client ID·Secret을 어느 화면에서 가져오는지 + 바로 가는 링크 */}
                <div className="text-xs text-ive-text-dim mt-1.5 leading-relaxed">
                  <i className="fa-solid fa-circle-info mr-1 text-ive-cyan" />{t(providerHelp.cred)}{' '}
                  <a href={providerSiteUrl} target="_blank" rel="noreferrer" className="text-ive-cyan font-bold hover:underline whitespace-nowrap">
                    {t('openSite')}<i className="fa-solid fa-arrow-up-right-from-square ml-0.5 text-[9px]" />
                  </a>
                </div>
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
                  {form.type === 'slack' ? t('slackEnabledCheckbox') : t('enabledCheckbox')}
                </button>
              </div>
              {/* 공통(모든 provider 동일): 로그인 Redirect URL — 앱에 등록 */}
              {form.id && (
                <div className="bg-ive-bg-deep border border-ive-border-subtle rounded-lg p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-ive-text-muted font-bold">
                      <i className="fa-solid fa-link mr-1" />{t('loginRedirectUrl')}
                    </div>
                    <button
                      type="button"
                      onClick={copyCallbackUrl}
                      className={`font-bold px-2 py-0.5 rounded transition-colors active:scale-95 ${
                        copied
                          ? 'text-ive-green bg-ive-green/15'
                          : 'text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20 active:bg-ive-cyan/30'
                      }`}
                    >
                      <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'} mr-1`} />
                      {copied ? t('copiedBtn') : t('copyBtn')}
                    </button>
                  </div>
                  <div className="font-mono text-ive-text break-all">
                    {origin}/api/auth/oauth/{form.id}/callback
                  </div>
                  {/* 이 URL을 provider 어느 화면에 등록하는지 */}
                  <div className="mt-1 text-ive-text-dim">{t(providerHelp.redirect)}</div>
                  {!redirectBase && (
                    <div className="mt-1 text-ive-amber">
                      <i className="fa-solid fa-circle-info mr-1" />
                      <span className="text-ive-text-dim">{t('missingRedirectHint')}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Slack 전용 · 봇 연동 — 로그인과 분리(기본 접힘). 봇(멘션 응답·워크스페이스 설치) 쓸 때만 설정 */}
              {form.type === 'slack' && (
                <details className="bg-ive-bg-deep border border-ive-cyan/20 rounded-lg text-xs">
                  <summary className="cursor-pointer px-2.5 py-2 font-bold text-ive-cyan">
                    <i className="fa-brands fa-slack mr-1" />{t('slackBotSectionTitle')}
                  </summary>
                  <div className="px-2.5 pb-2.5 pt-1 flex flex-col gap-2.5">
                    <div className="text-ive-text-dim">{t('slackBotSectionHint')}</div>
                    {/* 부여해야 하는 스코프 — 나중에 헤매지 않도록 정확히 명시 (코드의 SLACK_BOT_SCOPES와 일치) */}
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-ive-text-muted font-bold">{t('slackBotScopes')}</span>
                        <button
                          type="button"
                          onClick={() => copyText('botscopes', 'app_mentions:read,chat:write,channels:history,groups:history,channels:read,groups:read,files:read,files:write,users:read')}
                          className={`font-bold px-2 py-0.5 rounded transition-colors active:scale-95 ${copiedKey === 'botscopes' ? 'text-ive-green bg-ive-green/15' : 'text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20'}`}
                        >
                          <i className={`fa-solid ${copiedKey === 'botscopes' ? 'fa-check' : 'fa-copy'} mr-1`} />{copiedKey === 'botscopes' ? t('copiedBtn') : t('copyBtn')}
                        </button>
                      </div>
                      <div className="font-mono text-ive-text break-all">app_mentions:read, chat:write, channels:history, groups:history, channels:read, groups:read, files:read, files:write, users:read</div>
                    </div>
                    <div className="text-ive-text-dim"><i className="fa-solid fa-bolt mr-1 text-ive-amber" />{t('slackBotEvent')}</div>
                    <div className="text-ive-text-dim"><i className="fa-solid fa-right-to-bracket mr-1 text-ive-cyan" />{t('slackLoginScopes')}</div>
                    <div>
                      <label className="block text-ive-text-muted font-bold mb-1">
                        {t('signingSecretLabel')} {editing ? t('onlyIfChanging') : ''}
                        {editing && editingHasSigningSecret && <span className="text-ive-green ml-1">✓</span>}
                      </label>
                      <input
                        type="password"
                        value={form.signingSecret}
                        onChange={e => setForm(f => ({ ...f, signingSecret: e.target.value }))}
                        placeholder={editing && editingHasSigningSecret ? t('ifBlankNoChange') : ''}
                        className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono"
                      />
                    </div>
                    {[
                      { key: 'events', label: t('slackUrlEvents'), url: `${origin}/api/slack/events` },
                      { key: 'install', label: t('slackUrlInstall'), url: `${origin}/api/slack/install/callback` },
                    ].map(({ key, label, url }) => (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-ive-text-muted font-bold">{label}</span>
                          <button
                            type="button"
                            onClick={() => copyText(key, url)}
                            className={`font-bold px-2 py-0.5 rounded transition-colors active:scale-95 ${copiedKey === key ? 'text-ive-green bg-ive-green/15' : 'text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20'}`}
                          >
                            <i className={`fa-solid ${copiedKey === key ? 'fa-check' : 'fa-copy'} mr-1`} />{copiedKey === key ? t('copiedBtn') : t('copyBtn')}
                          </button>
                        </div>
                        <div className="font-mono text-ive-text break-all">{url}</div>
                      </div>
                    ))}
                    <div className="text-ive-amber">
                      <i className="fa-solid fa-triangle-exclamation mr-1" />{t('slackPublicDist')}{' '}
                      <a href={providerSiteUrl} target="_blank" rel="noreferrer" className="text-ive-cyan font-bold hover:underline whitespace-nowrap">
                        {t('openSite')}<i className="fa-solid fa-arrow-up-right-from-square ml-0.5 text-[9px]" />
                      </a>
                    </div>
                  </div>
                </details>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-bg-input border border-ive-border text-ive-text"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green-dark text-white disabled:opacity-50"
                >
                  {saving ? <><i className="fa-solid fa-spinner fa-spin mr-1" />{t('saving')}</> : t('save')}
                </button>
              </div>
            </div>
      </Modal>
    </div>
  )
}
