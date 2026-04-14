'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

interface OAuthRepo {
  id: string
  name: string
  fullPath: string
  description: string
  repoUrl: string
  cloneUrl: string
  avatarUrl: string
  defaultBranch: string
  visibility: string
  openIssuesCount: number
  lastActivityAt: string | null
}

export interface OAuthInfo {
  hasToken: boolean
  providerType?: 'github' | 'gitlab'
  providerName?: string
  baseUrl?: string
}

export interface OAuthImportSectionProps {
  oauthInfo: OAuthInfo
  onSelectProject: (data: { name: string; repoUrl: string; avatarUrl?: string }) => void
}

export default function OAuthImportSection({ oauthInfo, onSelectProject }: OAuthImportSectionProps) {
  const t = useTranslations('project')
  const tc = useTranslations('common')

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerRepos, setPickerRepos] = useState<OAuthRepo[]>([])

  const loadOAuthProjects = useCallback(async (q: string) => {
    setPickerLoading(true)
    setPickerError(null)
    try {
      const url = `/api/auth/oauth/my-projects${q ? `?q=${encodeURIComponent(q)}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        setPickerError(data.error || t('projectListLoadFailed'))
        setPickerRepos([])
      } else {
        setPickerRepos(data.projects || [])
      }
    } catch {
      setPickerError(tc('serverError'))
      setPickerRepos([])
    } finally {
      setPickerLoading(false)
    }
  }, [t, tc])

  function openProjectPicker() {
    setPickerOpen(true)
    if (pickerRepos.length === 0) {
      loadOAuthProjects('')
    }
  }

  function handleSelectOAuthProject(repo: OAuthRepo) {
    onSelectProject({
      name: repo.name,
      repoUrl: repo.cloneUrl || repo.repoUrl,
      avatarUrl: repo.avatarUrl || undefined,
    })
    setPickerOpen(false)
  }

  return (
    <>
      {/* Import button */}
      <div>
        <button
          type="button"
          onClick={openProjectPicker}
          className="w-full py-3 rounded-lg text-sm font-bold border border-ive-cyan/40 bg-ive-cyan/10 text-ive-cyan hover:bg-ive-cyan/20 transition-all"
        >
          <i className={`fa-brands ${oauthInfo.providerType === 'github' ? 'fa-github' : 'fa-gitlab'} mr-1.5`} />
          {t('importFromProvider', { provider: oauthInfo.providerType === 'github' ? 'GitHub' : 'GitLab' })}
          <span className="text-ive-text-dim font-normal ml-1">({oauthInfo.providerName})</span>
        </button>
        <p className="text-sm text-ive-text-dim mt-1">
          <i className="fa-solid fa-circle-info mr-1" />
          {t('importFromProviderHint')}
        </p>
      </div>

      {/* OAuth project picker modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-ive-bg-solid border border-ive-border rounded-2xl w-full max-w-md max-h-[75vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-subtle">
              <div className="text-sm font-bold text-ive-text">
                <i className={`fa-brands ${oauthInfo.providerType === 'github' ? 'fa-github' : 'fa-gitlab'} mr-1.5 text-ive-cyan`} />
                {t('selectProject')}
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-ive-text-dim hover:text-ive-text"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="px-3 pt-3 pb-2">
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-ive-text-dim text-xs" />
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={e => setPickerQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      loadOAuthProjects(pickerQuery.trim())
                    }
                  }}
                  placeholder={t('searchRepoPlaceholder')}
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg pl-8 pr-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {pickerLoading && (
                <div className="flex items-center justify-center py-10 text-ive-text-dim text-sm font-bold">
                  <i className="fa-solid fa-circle-notch fa-spin mr-2" />
                  {tc('loading')}
                </div>
              )}
              {!pickerLoading && pickerError && (
                <div className="m-1 bg-ive-red/10 border border-ive-red/30 rounded-lg px-3 py-2 text-xs text-ive-red font-bold">
                  <i className="fa-solid fa-circle-xmark mr-1.5" />
                  {pickerError}
                </div>
              )}
              {!pickerLoading && !pickerError && pickerRepos.length === 0 && (
                <div className="text-center py-10 text-ive-text-dim text-sm font-bold">
                  {t('noRepos')}
                </div>
              )}
              {!pickerLoading && pickerRepos.map(repo => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => handleSelectOAuthProject(repo)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-ive-bg-input transition-colors text-left"
                >
                  {repo.avatarUrl ? (
                    <img
                      src={repo.avatarUrl}
                      alt=""
                      className="w-7 h-7 rounded object-cover flex-shrink-0"
                      onError={e => {
                        const img = e.currentTarget
                        const fallback = img.nextElementSibling as HTMLElement | null
                        img.style.display = 'none'
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                  ) : null}
                  <div
                    className="w-7 h-7 rounded bg-ive-bg-input border border-ive-border-subtle items-center justify-center flex-shrink-0"
                    style={{ display: repo.avatarUrl ? 'none' : 'flex' }}
                  >
                    <i className="fa-solid fa-folder text-ive-text-dim text-xs" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-ive-text truncate">{repo.name}</span>
                      {repo.visibility !== 'public' && (
                        <i className="fa-solid fa-lock text-xs text-ive-text-dim" />
                      )}
                    </div>
                    <div className="text-xs font-mono font-bold text-ive-text-dim truncate">{repo.fullPath}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ive-text-dim font-bold flex-shrink-0">
                    <span><i className="fa-solid fa-circle-exclamation mr-0.5" />{repo.openIssuesCount}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
