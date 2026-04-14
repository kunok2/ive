'use client'

import { useState } from 'react'
import { Project } from '@/types'
import { useTranslations } from 'next-intl'
import type { OAuthInfo } from './OAuthImportSection'

export interface ConnectionSectionProps {
  existing?: Project
  name: string
  onNameChange: (v: string) => void
  repoUrl: string
  onRepoUrlChange: (v: string) => void
  accessToken: string
  onAccessTokenChange: (v: string) => void
  usesOAuthToken: boolean
  onUsesOAuthTokenChange: (v: boolean) => void
  oauthInfo: OAuthInfo
  avatarUrl: string
  onAvatarUrlChange: (v: string) => void
}

export default function ConnectionSection({
  existing,
  name,
  onNameChange,
  repoUrl,
  onRepoUrlChange,
  accessToken,
  onAccessTokenChange,
  usesOAuthToken,
  onUsesOAuthTokenChange,
  oauthInfo,
  avatarUrl,
  onAvatarUrlChange,
}: ConnectionSectionProps) {
  const t = useTranslations('project')
  const tc = useTranslations('common')

  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testResult, setTestResult] = useState<{
    name?: string
    fullPath?: string
    defaultBranch?: string
    openIssuesCount?: number
    avatarUrl?: string
    error?: string
  } | null>(null)

  async function handleTestConnection() {
    if (!repoUrl.trim()) return
    if (!usesOAuthToken && !accessToken.trim() && !existing) return

    setTestStatus('loading')
    setTestResult(null)
    try {
      const res = await fetch('/api/projects/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          authType: 'token',
          gitUsername: '',
          accessToken: usesOAuthToken ? '' : accessToken.trim(),
          useOAuthToken: usesOAuthToken,
          ...(existing ? { projectId: existing.id } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestStatus('error')
        setTestResult({ error: data.error })
      } else {
        setTestStatus('success')
        setTestResult(data.project)
        if (data.project.avatarUrl) onAvatarUrlChange(data.project.avatarUrl)
      }
    } catch {
      setTestStatus('error')
      setTestResult({ error: t('connectionFailedServer') })
    }
  }

  return (
    <>
      {/* Project name */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('projectName')} <span className="text-ive-red">*</span></label>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          placeholder={t('projectNamePlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* Repository URL */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('repoUrl')} <span className="text-ive-red">*</span></label>
        <input
          type="url"
          value={repoUrl}
          onChange={e => onRepoUrlChange(e.target.value)}
          placeholder="https://gitlab.com/user/repo.git"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* Access token */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">
          {t('gitAccessToken')} <span className="text-ive-red">*</span> <span className="text-ive-text-dim font-normal">{t('personalAccessToken')}</span>
        </label>

        {/* OAuth token reuse option */}
        {(oauthInfo.hasToken || (existing && existing.usesOAuthToken)) && (
          <div
            onClick={() => onUsesOAuthTokenChange(!usesOAuthToken)}
            className={`mb-3 p-4 rounded-xl border-2 transition-all cursor-pointer group ${
              usesOAuthToken
                ? 'border-ive-cyan bg-ive-cyan/10 shadow-[0_0_15px_rgba(34,211,238,0.2)]'
                : 'border-ive-border-subtle bg-ive-bg-deep/50 hover:border-ive-text-dim/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                  usesOAuthToken ? 'bg-ive-cyan text-ive-bg-card' : 'bg-ive-bg-card text-ive-text-dim'
                }`}>
                  <i className={`fa-brands ${oauthInfo.providerType === 'github' ? 'fa-github' : 'fa-gitlab'}`} />
                </div>
                <div>
                  <div className={`text-sm font-bold transition-all ${usesOAuthToken ? 'text-ive-cyan' : 'text-ive-text'}`}>
                    {t('useOAuthAccount')}
                  </div>
                  <div className="text-xs text-ive-text-dim mt-0.5">
                    {t('oauthAccountHint', { provider: oauthInfo.providerName || 'GitLab' })}
                  </div>
                </div>
              </div>
              <div className={`w-12 h-6 rounded-full relative transition-all ${usesOAuthToken ? 'bg-ive-cyan' : 'bg-ive-bg-card border border-ive-border'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                  usesOAuthToken ? 'left-[1.625rem]' : 'left-1'
                }`} />
              </div>
            </div>
          </div>
        )}

        <input
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={accessToken}
          onChange={e => onAccessTokenChange(e.target.value)}
          disabled={usesOAuthToken}
          placeholder={usesOAuthToken ? t('oauthAutoManageMode') : (existing ? t('changeOnlyInput') : 'ghp_xxxxxxxxxxxx')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono disabled:opacity-30"
          style={usesOAuthToken ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)}
        />
        <p className="text-sm text-ive-text-dim mt-1">
          <i className="fa-solid fa-lock mr-1" />{t('tokenHint')}
        </p>
      </div>

      {/* Connection test */}
      <div>
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testStatus === 'loading' || !repoUrl.trim() || (!usesOAuthToken && !accessToken.trim() && !existing)}
          className="w-full py-2.5 rounded-lg text-sm font-bold border transition-all disabled:opacity-40 bg-ive-bg-card border-ive-border-subtle text-ive-text-muted hover:border-ive-green hover:text-ive-green"
        >
          {testStatus === 'loading' ? (
            <><i className="fa-solid fa-circle-notch fa-spin mr-1.5" />{t('testingConnection')}</>
          ) : (
            <><i className="fa-solid fa-plug mr-1.5" />{t('testConnection')}</>
          )}
        </button>

        {testStatus === 'success' && testResult && (
          <div className="mt-2 bg-ive-green/10 border border-ive-green/30 rounded-lg px-3 py-2.5 text-sm animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center gap-1.5 text-ive-green font-bold mb-1.5">
              {testResult.avatarUrl ? (
                <img src={testResult.avatarUrl} alt="" className="w-5 h-5 rounded object-cover" />
              ) : (
                <i className="fa-solid fa-circle-check" />
              )}
              {t('connectionSuccess')}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-ive-text-muted">
              <span className="text-ive-text-dim">{t('project')}</span>
              <span className="font-bold text-ive-text">{testResult.name}</span>
              <span className="text-ive-text-dim">{t('path')}</span>
              <span className="font-mono text-xs text-ive-text">{testResult.fullPath}</span>
              <span className="text-ive-text-dim">{t('defaultBranch')}</span>
              <span className="font-bold text-ive-text">{testResult.defaultBranch}</span>
              <span className="text-ive-text-dim">{t('openIssues')}</span>
              <span className="font-bold text-ive-text">{testResult.openIssuesCount}{tc('items')}</span>
            </div>
          </div>
        )}

        {testStatus === 'error' && testResult && (
          <div className="mt-2 bg-ive-red/10 border border-ive-red/30 rounded-lg px-3 py-2.5 text-sm animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center gap-1.5 text-ive-red font-bold">
              <i className="fa-solid fa-circle-xmark" />{testResult.error}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
