'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Project, PROJECT_COLORS, ProjectColor, detectProvider, ShareRole } from '@/types'
import { useStore } from '@/lib/store'

interface Props {
  existing?: Project
  onSuccess?: () => void
}

export default function ProjectForm({ existing, onSuccess }: Props) {
  const router = useRouter()
  const { addProject, updateProject } = useStore()

  const [color, setColor] = useState<ProjectColor>(existing?.color ?? '#4ade80')
  const [name, setName] = useState(existing?.name ?? '')
  const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')
  const [accessToken, setAccessToken] = useState('')

  // 이슈 레이블 설정 (대상 식별 레이블 1개만 사용자 입력, 나머지는 자동 파생)
  const [labelTarget, setLabelTarget] = useState(existing?.labelTarget ?? 'IVE')
  
  // 작업 주기 설정 추가 (단위: 분)
  const [checkInterval, setCheckInterval] = useState(existing?.checkInterval ?? 10)

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

  // 패널 열릴 때 최신 데이터 갱신
  useEffect(() => {
    if (existing && showSharing) fetchShares()
  }, [existing, showSharing, fetchShares])

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
        setShareError(data.error || '공유 추가 실패')
      } else {
        setSelectedUserId('')
        fetchShares()
      }
    } catch { setShareError('서버 오류') }
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
    if (!accessToken.trim() && !existing) return

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
          accessToken: accessToken.trim(),
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
      setTestResult({ error: '서버 연결에 실패했습니다' })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !repoUrl.trim() || (!existing && !accessToken.trim())) return

    const projectData = {
      name: name.trim(),
      provider: detectProvider(repoUrl.trim()),
      color,
      repoUrl: repoUrl.trim(),
      authType: 'token' as const,
      gitUsername: '',
      accessToken: accessToken.trim() || (existing?.accessToken ?? ''),
      labelTarget: labelTarget.trim(),
      labelInProgress: '',
      labelFailDev: '',
      labelDone: '',
      showToolUsage,
      checkInterval: Number(checkInterval) || 10,
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastScannedIssueCount: existing?.lastScannedIssueCount ?? null,
      scannerActive: existing?.scannerActive ?? false,
      lastError: existing?.lastError ?? null,
      lastErrorAt: existing?.lastErrorAt ?? null,
      sortOrder: existing?.sortOrder ?? 0,
      avatarUrl,
      snapshotInterval,
      sparklinePoints,
      statsRetention,
    }

    if (existing) {
      await updateProject({
        ...existing,
        ...projectData
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">구분 색상</label>
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

      {/* 프로젝트 이름 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">프로젝트 이름 <span className="text-ive-red">*</span></label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="나의 AI 프로젝트"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 저장소 URL */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">저장소 URL <span className="text-ive-red">*</span></label>
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          Git 액세스 토큰 <span className="text-ive-red">*</span> <span className="text-ive-text-dim font-normal">(Personal Access Token)</span>
        </label>
        <input
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          placeholder={existing ? '변경 시에만 입력' : 'ghp_xxxxxxxxxxxx'}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
          style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
        />
        <p className="text-sm text-ive-text-dim mt-1">
          <i className="fa-solid fa-lock mr-1" />이슈 목록 조회 및 작업 완료 보고를 위해 필요합니다. 암호화되어 저장됩니다.
        </p>
      </div>

      {/* 연결 테스트 */}
      <div>
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={testStatus === 'loading' || !repoUrl.trim() || (!accessToken.trim() && !existing)}
          className="w-full py-2.5 rounded-lg text-sm font-bold border transition-all disabled:opacity-40 bg-ive-bg-card border-ive-border-subtle text-ive-text-muted hover:border-ive-green hover:text-ive-green"
        >
          {testStatus === 'loading' ? (
            <><i className="fa-solid fa-circle-notch fa-spin mr-1.5" />연결 확인 중...</>
          ) : (
            <><i className="fa-solid fa-plug mr-1.5" />연결 테스트</>
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
              연결 성공
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-ive-text-muted">
              <span className="text-ive-text-dim">프로젝트</span>
              <span className="font-bold text-ive-text">{testResult.name}</span>
              <span className="text-ive-text-dim">경로</span>
              <span className="font-mono text-xs text-ive-text">{testResult.fullPath}</span>
              <span className="text-ive-text-dim">기본 브랜치</span>
              <span className="font-bold text-ive-text">{testResult.defaultBranch}</span>
              <span className="text-ive-text-dim">열린 이슈</span>
              <span className="font-bold text-ive-text">{testResult.openIssuesCount}개</span>
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          작업 확인 주기 <span className="text-ive-text-dim font-normal">(단위: 분)</span>
        </label>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setCheckInterval(v => Math.max(1, v - 1))}
                className="px-3 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-black"
              >−</button>
              <span className="w-16 py-3 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{checkInterval}</span>
              <button
                type="button"
                onClick={() => setCheckInterval(v => Math.min(1440, v + 1))}
                className="px-3 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-black"
              >+</button>
            </div>
            <div className="flex gap-1 flex-1 min-w-0">
              {[5, 10, 30].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCheckInterval(n)}
                  className={`flex-1 py-3 rounded-lg text-base font-black border transition-all ${
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
        </div>
      </div>

      {/* IVE 대상 레이블 설정 */}
      <div className="border-t border-ive-border-dark pt-3">
        <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">
          <i className="fa-solid fa-tag mr-1.5 text-xs" />
          IVE 대상 레이블
        </label>
        <input
          type="text"
          value={labelTarget}
          onChange={e => setLabelTarget(e.target.value)}
          placeholder="IVE"
          className="w-full bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green font-bold"
        />
        <p className="text-xs text-ive-text-dim mt-1.5 ml-1 leading-relaxed">
          이 레이블이 붙은 이슈만 IVE에서 관리됩니다. 이슈 생성 시 자동으로 부여되며,
          원격 저장소에 레이블 쓰기 권한이 없어도 로컬 DB에서 상태를 추적합니다.
        </p>
      </div>

      {/* 트레이스 설정 */}
      <div className="border-t border-ive-border-dark pt-3">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-base font-bold text-ive-text-muted">
            <i className="fa-solid fa-wrench mr-1.5 text-sm" />
            트레이스에 툴 사용 표시
          </span>
          <button
            type="button"
            onClick={() => setShowToolUsage(!showToolUsage)}
            className={`w-11 h-6 rounded-full transition-all relative ${showToolUsage ? 'bg-ive-green' : 'bg-ive-bg-deep border border-ive-border'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${showToolUsage ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </button>
        </label>
        <p className="text-xs text-ive-text-dim mt-1 ml-6">에이전트 실행 로그에 Read, Edit, Bash 등 툴 호출 내역을 포함합니다</p>
      </div>

      {/* 모니터링 설정 */}
      <div className="border-t border-ive-border-dark pt-2">
        <button
          type="button"
          onClick={() => setShowMonitoring(!showMonitoring)}
          className="flex items-center gap-1.5 text-base font-bold text-ive-cyan mb-3"
        >
          <i className={`fa-solid ${showMonitoring ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
          모니터링 설정
        </button>

        {showMonitoring && (
          <div className="space-y-4 pb-2 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                스냅샷 수집 간격 <span className="text-ive-text-dim font-normal">(분)</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{snapshotInterval}</span>
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.min(60, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[1, 5, 10].map(v => (
                    <button key={v} type="button" onClick={() => setSnapshotInterval(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-black border transition-all ${snapshotInterval === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}m</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                스파크라인 표시 건수
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setSparklinePoints(v => Math.max(10, v - 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{sparklinePoints}</span>
                  <button type="button" onClick={() => setSparklinePoints(v => Math.min(200, v + 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[30, 60, 120].map(v => (
                    <button key={v} type="button" onClick={() => setSparklinePoints(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-black border transition-all ${sparklinePoints === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                데이터 보관 기간 <span className="text-ive-text-dim font-normal">(일)</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setStatsRetention(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{statsRetention}</span>
                  <button type="button" onClick={() => setStatsRetention(v => Math.min(90, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[7, 14, 30].map(v => (
                    <button key={v} type="button" onClick={() => setStatsRetention(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-black border transition-all ${statsRetention === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}d</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 프로젝트 공유 (기존 프로젝트만) */}
      {existing && (
        <div className="border-t border-ive-border-dark pt-2">
          <button
            type="button"
            onClick={() => setShowSharing(!showSharing)}
            className="flex items-center gap-1.5 text-base font-bold text-ive-purple mb-3"
          >
            <i className={`fa-solid ${showSharing ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
            <i className="fa-solid fa-share-nodes mr-0.5" />
            프로젝트 공유
            {shares.length > 0 && <span className="text-xs font-black bg-ive-purple/20 text-ive-purple px-1.5 py-0.5 rounded-full">{shares.length}</span>}
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
                          className={`px-2 py-1 text-xs font-black transition-all ${s.role === 'viewer' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
                        >뷰어</button>
                        <button
                          type="button"
                          onClick={() => handleChangeShareRole(s.id, 'editor')}
                          className={`px-2 py-1 text-xs font-black transition-all border-l border-ive-border ${s.role === 'editor' ? 'bg-ive-amber/15 text-ive-amber' : 'text-ive-text-dim hover:text-ive-text'}`}
                        >편집자</button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveShare(s.id)}
                        className="text-ive-red/60 hover:text-ive-red transition-colors p-1"
                        title="공유 해제"
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
                      className={`flex-1 py-2 text-sm font-black transition-all ${shareRole === 'viewer' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
                    >뷰어</button>
                    <button
                      type="button"
                      onClick={() => setShareRole('editor')}
                      className={`flex-1 py-2 text-sm font-black transition-all border-l border-ive-border ${shareRole === 'editor' ? 'bg-ive-amber/15 text-ive-amber' : 'text-ive-text-dim hover:text-ive-text'}`}
                    >편집자</button>
                  </div>
                  {/* 사용자 목록 — 클릭하면 바로 추가 */}
                  <div className="space-y-1">
                    {candidates.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        disabled={shareLoading}
                        onClick={() => { setShareError(''); handleAddShare(u.id) }}
                        className="w-full text-left px-3 py-2.5 text-sm bg-ive-bg-deep rounded-lg border border-ive-border-dark hover:border-ive-purple/40 hover:bg-ive-purple/5 transition-all flex items-center gap-2 disabled:opacity-40"
                      >
                        <i className="fa-solid fa-user-circle text-lg text-ive-text-dim" />
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-ive-text">{u.name}</span>
                          <span className="text-ive-text-dim text-xs ml-1.5">{u.email}</span>
                        </div>
                        <i className="fa-solid fa-plus text-xs text-ive-purple/60" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-ive-text-dim">
                  <i className="fa-solid fa-users-slash mr-1" />추가할 수 있는 사용자가 없습니다
                </p>
              )}
              {shareError && (
                <p className="text-xs text-ive-red font-bold"><i className="fa-solid fa-circle-exclamation mr-1" />{shareError}</p>
              )}
              <p className="text-xs text-ive-text-dim">
                <i className="fa-solid fa-info-circle mr-1" />
                <b>뷰어</b>: 프로젝트 현황·보고서 조회만 가능 / <b>편집자</b>: 작업 생성도 가능
              </p>
            </div>
          )}
        </div>
      )}

      {/* 버튼 */}
      <button
        type="submit"
        className="w-full bg-ive-green-dark text-white font-black py-4 rounded-xl text-base active:shadow-inner active:opacity-90 transition-all mt-2 shadow-lg shadow-ive-green/10"
      >
        <i className={`fa-solid ${existing ? 'fa-check' : 'fa-plus'} mr-2`} />
        {existing ? '설정 변경 완료' : '프로젝트 생성하기'}
      </button>
    </form>
  )
}
