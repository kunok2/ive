'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Project, PROJECT_COLORS, ProjectColor, detectProvider, ShareRole } from '@/types'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'

interface Props {
  existing?: Project
  onSuccess?: () => void
  onCancel?: () => void
}

export default function ProjectForm({ existing, onSuccess, onCancel }: Props) {
  const router = useRouter()
  const { addProject, updateProject } = useStore()
  const t = useTranslations('project')
  const tc = useTranslations('common')
  const ta = useTranslations('agent')

  const [color, setColor] = useState<ProjectColor>(existing?.color ?? '#4ade80')
  const [name, setName] = useState(existing?.name ?? '')
  const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')
  const [accessToken, setAccessToken] = useState('')

  // OAuth 토큰 재사용
  const [oauthInfo, setOauthInfo] = useState<{
    hasToken: boolean
    providerType?: 'github' | 'gitlab'
    providerName?: string
    baseUrl?: string
  }>({ hasToken: false })
  const [usesOAuthToken, setUsesOAuthToken] = useState(existing?.usesOAuthToken ?? oauthInfo.hasToken)

  // OAuth 프로젝트 선택기
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
    setName(repo.name)
    setRepoUrl(repo.cloneUrl || repo.repoUrl)
    if (repo.avatarUrl) setAvatarUrl(repo.avatarUrl)
    setUsesOAuthToken(true)
    setAccessToken('')
    setPickerOpen(false)
    setTestStatus('idle')
    setTestResult(null)
  }

  // 이슈 레이블 설정
  const [labelTarget, setLabelTarget] = useState(existing?.labelTarget ?? 'IVE')
  const [labelSchedule, setLabelSchedule] = useState(existing?.labelSchedule ?? 'IVE-S')
  const [labelDev, setLabelDev] = useState(existing?.labelDev ?? 'IVE-D')
  const [labelVerifyWait, setLabelVerifyWait] = useState(existing?.labelVerifyWait ?? 'IVE-W')
  const [labelVerify, setLabelVerify] = useState(existing?.labelVerify ?? 'IVE-V')
  const [labelEnd, setLabelEnd] = useState(existing?.labelEnd ?? 'IVE-E')
  const [labelStatus, setLabelStatus] = useState<{ label: string; exists: boolean }[] | null>(null)
  const [labelCreating, setLabelCreating] = useState(false)
  const [labelMessage, setLabelMessage] = useState<string | null>(null)

  // AI 가이드 설치 (CLAUDE.md, AGENTS.md)
  const [aiGuideStatus, setAiGuideStatus] = useState<{ path: string; hasIveSection: boolean }[] | null>(null)
  const [aiGuideInstalling, setAiGuideInstalling] = useState(false)
  const [aiGuideResult, setAiGuideResult] = useState<{ path: string; created: boolean; updated: boolean; unchanged: boolean; error?: string }[] | null>(null)

  // 작업 주기 설정 추가 (단위: 분)
  const [checkInterval, setCheckInterval] = useState(existing?.checkInterval ?? 1)

  const [snapshotInterval, setSnapshotInterval] = useState(existing?.snapshotInterval ?? 1)
  const [sparklinePoints, setSparklinePoints] = useState(existing?.sparklinePoints ?? 60)
  const [statsRetention, setStatsRetention] = useState(existing?.statsRetention ?? 7)
  const [showToolUsage, setShowToolUsage] = useState(existing?.showToolUsage ?? false)

  const [showMonitoring, setShowMonitoring] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(existing?.avatarUrl ?? '')
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testResult, setTestResult] = useState<{ name?: string; fullPath?: string; defaultBranch?: string; openIssuesCount?: number; avatarUrl?: string; error?: string } | null>(null)

  // 프로젝트 공유
  const [showSharing, setShowSharing] = useState(false)
  const [shares, setShares] = useState<{ id: string; userId: string; userName: string; userEmail: string; role: ShareRole; createdAt: string }[]>([])
  const [candidates, setCandidates] = useState<{ id: string; name: string; email: string }[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [shareRole, setShareRole] = useState<ShareRole>('viewer')
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [shareError, setShareError] = useState('')
  const [shareLoading, setShareLoading] = useState(false)

  const fetchShares = useCallback(async () => {
    if (!existing) return
    try {
      const res = await fetch(`/api/projects/${existing.id}/shares`)
      if (res.ok) {
        const data = await res.json()
        setShares(data.shares)
        setCandidates(data.candidates)
      }
    } catch { /* ignore */ }
  }, [existing])

  // 초기 진입 시 공유 수 로드
  useEffect(() => {
    if (existing) fetchShares()
  }, [existing, fetchShares])

  // 현재 유저의 OAuth 토큰 정보 로드 (있으면 체크박스 노출)
  useEffect(() => {
    fetch('/api/auth/oauth/my-token')
      .then(r => r.ok ? r.json() : { hasToken: false })
      .then(data => {
        setOauthInfo(data)
        if (!existing && data.hasToken) {
          setUsesOAuthToken(true)
        }
      })
      .catch(() => setOauthInfo({ hasToken: false }))
  }, [])

  // 패널 열릴 때 최신 데이터 갱신
  useEffect(() => {
    if (existing && showSharing) fetchShares()
  }, [existing, showSharing, fetchShares])

  // AI 가이드 설치 상태 로드
  useEffect(() => {
    if (!existing) return
    fetch(`/api/projects/${existing.id}/ai-guide`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAiGuideStatus(data.files || null) })
      .catch(() => { /* ignore */ })
  }, [existing])

  async function handleAddShare(userId?: string) {
    const targetId = userId || selectedUserId
    if (!existing || !targetId) return
    setShareError('')
    setShareLoading(true)
    try {
      const res = await fetch(`/api/projects/${existing.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetId, role: shareRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        setShareError(data.error || t('shareAddFailed'))
      } else {
        setSelectedUserId('')
        fetchShares()
      }
    } catch { setShareError(tc('serverError')) }
    finally { setShareLoading(false) }
  }

  async function handleRemoveShare(shareId: string) {
    if (!existing) return
    await fetch(`/api/projects/${existing.id}/shares`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId }),
    })
    fetchShares()
  }

  async function handleChangeShareRole(shareId: string, role: ShareRole) {
    if (!existing) return
    await fetch(`/api/projects/${existing.id}/shares`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId, role }),
    })
    fetchShares()
  }

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
        if (data.project.avatarUrl) setAvatarUrl(data.project.avatarUrl)
      }
    } catch {
      setTestStatus('error')
      setTestResult({ error: t('connectionFailedServer') })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !repoUrl.trim() || (!existing && !usesOAuthToken && !accessToken.trim())) return

    const projectData = {
      name: name.trim(),
      provider: detectProvider(repoUrl.trim()),
      color,
      repoUrl: repoUrl.trim(),
      authType: 'token' as const,
      gitUsername: '',
      accessToken: usesOAuthToken ? '' : accessToken.trim(),
      usesOAuthToken,
      labelTarget: labelTarget.trim(),
      labelSchedule: labelSchedule.trim() || 'IVE-S',
      labelDev: labelDev.trim() || 'IVE-D',
      labelVerifyWait: labelVerifyWait.trim() || 'IVE-W',
      labelVerify: labelVerify.trim() || 'IVE-V',
      labelEnd: labelEnd.trim() || 'IVE-E',
      showToolUsage,
      checkInterval: Number(checkInterval) || 1,
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastScannedIssueCount: existing?.lastScannedIssueCount ?? null,
      lastVerifyWaitingCount: existing?.lastVerifyWaitingCount ?? null,
      scannerActive: existing?.scannerActive ?? false,
      lastError: existing?.lastError ?? null,
      lastErrorAt: existing?.lastErrorAt ?? null,
      sortOrder: existing?.sortOrder ?? 0,
      avatarUrl,
      snapshotInterval,
      sparklinePoints,
      statsRetention,
      lastActivityAt: existing?.lastActivityAt ?? null,
    }

    if (existing) {
      await updateProject({
        ...existing,
        ...projectData,
      })
      onSuccess?.()
      if (!onSuccess) router.push(`/projects/${existing.id}`)
    } else {
      await addProject(projectData)
      onSuccess?.()
      if (!onSuccess) router.push('/')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* 프로젝트 색상 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('distinguishColor')}</label>
        <div className="grid grid-cols-5 gap-1.5">
          {PROJECT_COLORS.map(c => {
            const selected = color === c.value
            const isDark = !['#fbbf24', '#a3e635', '#e0e0e0'].includes(c.value)
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                  selected
                    ? 'ring-1 ring-offset-1 ring-offset-ive-bg-card'
                    : 'opacity-50 hover:opacity-80'
                }`}
                style={{
                  backgroundColor: selected ? c.value : `${c.value}18`,
                  color: selected ? (isDark ? '#fff' : '#1a1a2e') : c.value,
                  ...(selected ? { ringColor: c.value } : {}),
                }}
              >
                {c.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Git에서 프로젝트 가져오기 — OAuth 로그인 사용자 전용, 신규 생성 시에만 노출 */}
      {!existing && oauthInfo.hasToken && (
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
      )}

      {/* 프로젝트 이름 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('projectName')} <span className="text-ive-red">*</span></label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('projectNamePlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 저장소 URL */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('repoUrl')} <span className="text-ive-red">*</span></label>
        <input
          type="url"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder="https://gitlab.com/user/repo.git"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 액세스 토큰 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">
          {t('gitAccessToken')} <span className="text-ive-red">*</span> <span className="text-ive-text-dim font-normal">{t('personalAccessToken')}</span>
        </label>

        {/* OAuth 토큰 재사용 옵션 - 프리미엄 카드 스타일 */}
        {(oauthInfo.hasToken || (existing && existing.usesOAuthToken)) && (
          <div 
            onClick={() => setUsesOAuthToken(!usesOAuthToken)}
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
          onChange={e => setAccessToken(e.target.value)}
          disabled={usesOAuthToken}
          placeholder={usesOAuthToken ? t('oauthAutoManageMode') : (existing ? t('changeOnlyInput') : 'ghp_xxxxxxxxxxxx')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono disabled:opacity-30"
          style={usesOAuthToken ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)}
        />
        <p className="text-sm text-ive-text-dim mt-1">
          <i className="fa-solid fa-lock mr-1" />{t('tokenHint')}
        </p>
      </div>

      {/* 연결 테스트 */}
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

      {/* 작업 확인 주기 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">
          {t('checkInterval')} <span className="text-ive-text-dim font-normal">{t('checkIntervalUnit')}</span>
        </label>
        <div className="flex gap-1.5">
          {[1, 3, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setCheckInterval(n)}
              className={`flex-1 py-3 rounded-lg text-base font-bold border transition-all ${
                checkInterval === n
                  ? 'bg-ive-green/10 border-ive-green text-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'
              }`}
            >
              {`${n}m`}
            </button>
          ))}
        </div>
      </div>

      {/* IVE 레이블 설정 */}
      <div className="border-t border-ive-border-dark pt-3">
        <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">
          <i className="fa-solid fa-tags mr-1.5 text-xs" />
          {t('targetLabel')}
        </label>
        <p className="text-xs text-ive-text-dim mb-2 ml-1 leading-relaxed">
          {t('labelSystemHint')}
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-ive-cyan shrink-0" />
            <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-ive-text-dim shrink-0">{t('labelTarget')}</span>
              <span className="text-[10px] text-ive-text-dim/60 truncate">{t('labelTargetDesc')}</span>
            </span>
            <input
              type="text"
              value={labelTarget}
              onChange={e => setLabelTarget(e.target.value)}
              placeholder="IVE"
              className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-ive-cyan shrink-0" />
            <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-ive-text-dim shrink-0">{t('labelSchedule')}</span>
              <span className="text-[10px] text-ive-text-dim/60 truncate">{t('labelScheduleDesc')}</span>
            </span>
            <input
              type="text"
              value={labelSchedule}
              onChange={e => setLabelSchedule(e.target.value)}
              placeholder="IVE-S"
              className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-ive-amber shrink-0" />
            <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-ive-text-dim shrink-0">{t('labelDev')}</span>
              <span className="text-[10px] text-ive-text-dim/60 truncate">{t('labelDevDesc')}</span>
            </span>
            <input
              type="text"
              value={labelDev}
              onChange={e => setLabelDev(e.target.value)}
              placeholder="IVE-D"
              className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-ive-amber shrink-0" />
            <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-ive-text-dim shrink-0">{t('labelVerifyWait')}</span>
              <span className="text-[10px] text-ive-text-dim/60 truncate">{t('labelVerifyWaitDesc')}</span>
            </span>
            <input
              type="text"
              value={labelVerifyWait}
              onChange={e => setLabelVerifyWait(e.target.value)}
              placeholder="IVE-W"
              className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-ive-amber shrink-0" />
            <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-ive-text-dim shrink-0">{t('labelVerify')}</span>
              <span className="text-[10px] text-ive-text-dim/60 truncate">{t('labelVerifyDesc')}</span>
            </span>
            <input
              type="text"
              value={labelVerify}
              onChange={e => setLabelVerify(e.target.value)}
              placeholder="IVE-V"
              className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-ive-green shrink-0" />
            <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
              <span className="text-xs text-ive-text-dim shrink-0">{t('labelEnd')}</span>
              <span className="text-[10px] text-ive-text-dim/60 truncate">{t('labelEndDesc')}</span>
            </span>
            <input
              type="text"
              value={labelEnd}
              onChange={e => setLabelEnd(e.target.value)}
              placeholder="IVE-E"
              className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
          </div>
        </div>
        {/* 레이블 생성 버튼 — 기존 프로젝트에서만 표시 */}
        {existing && (
          <div className="mt-3">
            <button
              type="button"
              onClick={async () => {
                setLabelCreating(true)
                setLabelMessage(null)
                try {
                  const res = await fetch(`/api/projects/${existing.id}/labels`, { method: 'POST' })
                  const data = await res.json()
                  setLabelStatus(data.results || null)
                  setLabelMessage(data.message || null)
                } catch {
                  setLabelMessage(t('labelCreateFailed'))
                }
                setLabelCreating(false)
              }}
              disabled={labelCreating}
              className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40"
            >
              {labelCreating ? <i className="fa-solid fa-circle-notch fa-spin mr-1" /> : <i className="fa-solid fa-wand-magic-sparkles mr-1" />}
              {t('createLabels')}
            </button>
            {labelStatus && (
              <div className="mt-2 space-y-1">
                {labelStatus.map(s => (
                  <div key={s.label} className={`text-xs flex items-center gap-1.5 ${s.exists ? 'text-ive-green' : 'text-ive-red'}`}>
                    <i className={`fa-solid ${s.exists ? 'fa-circle-check' : 'fa-circle-xmark'}`} />
                    <span className="font-bold">{s.label}</span>
                    <span className="text-ive-text-dim">{s.exists ? t('labelExists') : t('labelMissing')}</span>
                  </div>
                ))}
              </div>
            )}
            {labelMessage && (
              <p className="text-xs text-ive-amber mt-1.5 ml-1">
                <i className="fa-solid fa-triangle-exclamation mr-1" />{labelMessage}
              </p>
            )}
          </div>
        )}
      </div>

      {/* AI 가이드 설치 (CLAUDE.md, AGENTS.md) — 기존 프로젝트에서만 */}
      {existing && (
        <div className="border-t border-ive-border-dark pt-3">
          <p className="text-sm font-bold text-ive-text-muted mb-1">
            <i className="fa-solid fa-robot mr-1.5 text-xs" />
            {t('aiGuide')}
          </p>
          <p className="text-xs text-ive-text-dim mb-3 ml-5">{t('aiGuideDescription')}</p>
          <div className="flex items-center gap-2 ml-5">
            <button
              type="button"
              onClick={async () => {
                setAiGuideInstalling(true)
                setAiGuideResult(null)
                try {
                  const res = await fetch(`/api/projects/${existing.id}/ai-guide`, { method: 'POST' })
                  const data = await res.json()
                  setAiGuideResult(data.results || null)
                  // 상태도 갱신
                  const statusRes = await fetch(`/api/projects/${existing.id}/ai-guide`)
                  if (statusRes.ok) {
                    const sData = await statusRes.json()
                    setAiGuideStatus(sData.files || null)
                  }
                } catch {
                  setAiGuideResult([{ path: 'CLAUDE.md', created: false, updated: false, unchanged: false, error: t('aiGuideInstallFailed') }])
                }
                setAiGuideInstalling(false)
              }}
              disabled={aiGuideInstalling}
              className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40"
            >
              {aiGuideInstalling ? <i className="fa-solid fa-circle-notch fa-spin mr-1" /> : <i className="fa-solid fa-wand-magic-sparkles mr-1" />}
              {t('aiGuideInstall')}
            </button>
            {/* 상태 표시 */}
            {aiGuideStatus && aiGuideStatus.map(f => (
              <span key={f.path} className={`text-xs flex items-center gap-1 ${f.hasIveSection ? 'text-ive-green' : 'text-ive-text-dim'}`}>
                <i className={`fa-solid ${f.hasIveSection ? 'fa-circle-check' : 'fa-circle-minus'}`} />
                {f.path}
              </span>
            ))}
          </div>
          {/* 설치 결과 */}
          {aiGuideResult && (
            <div className="mt-2 ml-5 space-y-1">
              {aiGuideResult.map(r => (
                <div key={r.path} className={`text-xs flex items-center gap-1.5 ${r.error ? 'text-ive-red' : r.unchanged ? 'text-ive-text-dim' : 'text-ive-green'}`}>
                  <i className={`fa-solid ${r.error ? 'fa-circle-xmark' : r.unchanged ? 'fa-circle-minus' : 'fa-circle-check'}`} />
                  <span className="font-bold">{r.path}</span>
                  <span>{r.error ? r.error : r.unchanged ? t('aiGuideUnchanged') : r.created ? t('aiGuideCreated') : t('aiGuideUpdated')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 트레이스 설정 */}
      <div className="border-t border-ive-border-dark pt-3">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-base font-bold text-ive-text-muted">
            <i className="fa-solid fa-wrench mr-1.5 text-sm" />
            {t('showToolUsage')}
          </span>
          <button
            type="button"
            onClick={() => setShowToolUsage(!showToolUsage)}
            className={`w-11 h-6 rounded-full transition-all relative ${showToolUsage ? 'bg-ive-green' : 'bg-ive-bg-deep border border-ive-border'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${showToolUsage ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </button>
        </label>
        <p className="text-xs text-ive-text-dim mt-1 ml-6">{t('showToolUsageHint')}</p>
      </div>

      {/* 모니터링 설정 */}
      <div className="border-t border-ive-border-dark pt-2">
        <button
          type="button"
          onClick={() => setShowMonitoring(!showMonitoring)}
          className="flex items-center gap-1.5 text-base font-bold text-ive-cyan mb-3"
        >
          <i className={`fa-solid ${showMonitoring ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
          {ta('monitoring')}
        </button>

        {showMonitoring && (
          <div className="space-y-4 pb-2 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {ta('snapshotInterval')} <span className="text-ive-text-dim font-normal">({tc('minutes')})</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{snapshotInterval}</span>
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.min(60, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[1, 5, 10].map(v => (
                    <button key={v} type="button" onClick={() => setSnapshotInterval(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${snapshotInterval === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}m</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {ta('sparklinePoints')}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setSparklinePoints(v => Math.max(10, v - 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{sparklinePoints}</span>
                  <button type="button" onClick={() => setSparklinePoints(v => Math.min(200, v + 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[30, 60, 120].map(v => (
                    <button key={v} type="button" onClick={() => setSparklinePoints(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${sparklinePoints === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {ta('dataRetention')} <span className="text-ive-text-dim font-normal">({tc('days')})</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setStatsRetention(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{statsRetention}</span>
                  <button type="button" onClick={() => setStatsRetention(v => Math.min(90, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[7, 14, 30].map(v => (
                    <button key={v} type="button" onClick={() => setStatsRetention(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${statsRetention === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}d</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 프로젝트 공유 (기존 프로젝트 소유자만) */}
      {existing && !(existing as any).shareRole && (
        <div className="border-t border-ive-border-dark pt-2">
          <button
            type="button"
            onClick={() => setShowSharing(!showSharing)}
            className="flex items-center gap-1.5 text-base font-bold text-ive-cyan mb-3"
          >
            <i className={`fa-solid ${showSharing ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
            <i className="fa-solid fa-share-nodes mr-0.5" />
            {t('shareProject')}
            {shares.length > 0 && <span className="text-xs font-bold bg-ive-cyan/20 text-ive-cyan px-1.5 py-0.5 rounded-full">{shares.length}</span>}
          </button>

          {showSharing && (
            <div className="space-y-3 pb-2 animate-in fade-in slide-in-from-top-2">
              {/* 공유 사용자 목록 */}
              {shares.length > 0 && (
                <div className="space-y-2">
                  {shares.map(s => (
                    <div key={s.id} className="flex items-center gap-2 bg-ive-bg-deep rounded-lg px-3 py-2 border border-ive-border-dark">
                      <i className="fa-solid fa-user-circle text-lg text-ive-text-dim" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-ive-text truncate">{s.userName}</div>
                        <div className="text-xs text-ive-text-dim truncate">{s.userEmail}</div>
                      </div>
                      <div className="flex bg-ive-bg-input rounded-lg overflow-hidden border border-ive-border">
                        <button
                          type="button"
                          onClick={() => handleChangeShareRole(s.id, 'viewer')}
                          className={`px-2 py-1 text-xs font-bold transition-all ${s.role === 'viewer' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
                        >{t('viewer')}</button>
                        <button
                          type="button"
                          onClick={() => handleChangeShareRole(s.id, 'editor')}
                          className={`px-2 py-1 text-xs font-bold transition-all border-l border-ive-border ${s.role === 'editor' ? 'bg-ive-amber/15 text-ive-amber' : 'text-ive-text-dim hover:text-ive-text'}`}
                        >{t('editor')}</button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveShare(s.id)}
                        className="text-ive-red/60 hover:text-ive-red transition-colors p-1"
                        title={t('unshare')}
                      >
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 새 사용자 추가 */}
              {candidates.length > 0 ? (
                <div className="space-y-2">
                  {/* 역할 선택 */}
                  <div className="flex bg-ive-bg-input rounded-lg overflow-hidden border border-ive-border">
                    <button
                      type="button"
                      onClick={() => setShareRole('viewer')}
                      className={`flex-1 py-2 text-sm font-bold transition-all ${shareRole === 'viewer' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
                    >{t('viewer')}</button>
                    <button
                      type="button"
                      onClick={() => setShareRole('editor')}
                      className={`flex-1 py-2 text-sm font-bold transition-all border-l border-ive-border ${shareRole === 'editor' ? 'bg-ive-amber/15 text-ive-amber' : 'text-ive-text-dim hover:text-ive-text'}`}
                    >{t('editor')}</button>
                  </div>
                  {/* 사용자 목록 — 클릭하면 바로 추가 */}
                  <div className="space-y-1">
                    {candidates.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        disabled={shareLoading}
                        onClick={() => { setShareError(''); handleAddShare(u.id) }}
                        className="w-full text-left px-3 py-2.5 text-sm bg-ive-bg-deep rounded-lg border border-ive-border-dark hover:border-ive-cyan/40 hover:bg-ive-cyan/5 transition-all flex items-center gap-2 disabled:opacity-40"
                      >
                        <i className="fa-solid fa-user-circle text-lg text-ive-text-dim" />
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-ive-text">{u.name}</span>
                          <span className="text-ive-text-dim text-xs ml-1.5">{u.email}</span>
                        </div>
                        <i className="fa-solid fa-plus text-xs text-ive-cyan/60" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ive-text-dim">
                  <i className="fa-solid fa-users-slash mr-1" />{t('noUsersToAdd')}
                </p>
              )}
              {shareError && (
                <p className="text-xs text-ive-red font-bold"><i className="fa-solid fa-circle-exclamation mr-1" />{shareError}</p>
              )}
              <p className="text-xs text-ive-text-dim">
                <i className="fa-solid fa-info-circle mr-1" />
                {t('shareRoleHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 버튼 — 스크롤해도 항상 하단에 고정 */}
      <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-1 mt-2 border-t border-ive-border-dark bg-ive-bg-solid flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-white/5 border border-ive-border-subtle text-ive-text-muted font-bold py-4 rounded-lg text-sm active:opacity-80 transition-all"
          >
            {tc('cancel')}
          </button>
        )}
        <button
          type="submit"
          className="flex-[2] bg-ive-green-dark text-white font-bold py-4 rounded-lg text-sm active:opacity-90 transition-all"
        >
          <i className={`fa-solid ${existing ? 'fa-check' : 'fa-plus'} mr-2`} />
          {existing ? t('settingsUpdated') : t('createProject')}
        </button>
      </div>

      {/* OAuth 프로젝트 선택 모달 */}
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
    </form>
  )
}
