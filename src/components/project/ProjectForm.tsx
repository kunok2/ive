'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Provider, Project } from '@/types'
import { useStore } from '@/lib/store'

interface Props {
  existing?: Project
  onSuccess?: () => void
}

export default function ProjectForm({ existing, onSuccess }: Props) {
  const router = useRouter()
  const { addProject, updateProject } = useStore()

  const [provider, setProvider] = useState<Provider>(existing?.provider ?? 'gitlab')
  const [name, setName] = useState(existing?.name ?? '')
  const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')
  const [accessToken, setAccessToken] = useState(existing?.accessToken ?? '')
  
  // 이슈 레이블 설정 추가
  const [labelTarget, setLabelTarget] = useState(existing?.labelTarget ?? 'IVE')
  const [labelInProgress, setLabelInProgress] = useState(existing?.labelInProgress ?? 'IVE(D)')
  const [labelFailDev, setLabelFailDev] = useState(existing?.labelFailDev ?? 'IVE(DF)')
  const [labelValidation, setLabelValidation] = useState(existing?.labelValidation ?? 'IVE(V)')
  const [labelFailVal, setLabelFailVal] = useState(existing?.labelFailVal ?? 'IVE(VF)')
  const [labelDone, setLabelDone] = useState(existing?.labelDone ?? 'IVE(E)')
  
  // 작업 주기 설정 추가 (단위: 분)
  const [checkInterval, setCheckInterval] = useState(existing?.checkInterval ?? 10)

  const [showAdvanced, setShowAdvanced] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !repoUrl.trim() || !accessToken.trim()) return

    const projectData = {
      name: name.trim(),
      provider,
      repoUrl: repoUrl.trim(),
      accessToken: accessToken.trim(),
      labelTarget: labelTarget.trim(),
      labelInProgress: labelInProgress.trim(),
      labelFailDev: labelFailDev.trim(),
      labelValidation: labelValidation.trim(),
      labelFailVal: labelFailVal.trim(),
      labelDone: labelDone.trim(),
      checkInterval: Number(checkInterval) || 10,
      lastCheckedAt: null,
      lastScannedIssueCount: null,
      scannerActive: false,
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
      {/* Provider 선택 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">플랫폼</label>
        <div className="flex gap-2">
          {(['github', 'gitlab'] as Provider[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`flex-1 py-3 rounded-lg text-base font-bold border transition-colors ${
                provider === p
                  ? 'bg-ive-green/10 border-ive-green text-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'
              }`}
            >
              <i className={`fa-brands ${p === 'github' ? 'fa-github' : 'fa-gitlab'} mr-1.5`} />
              {p === 'github' ? 'GitHub' : 'GitLab'}
            </button>
          ))}
        </div>
      </div>

      {/* 프로젝트 이름 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">프로젝트 이름</label>
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">저장소 URL</label>
        <input
          type="url"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder={`https://${provider === 'github' ? 'github.com' : 'gitlab.com'}/user/repo.git`}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 액세스 토큰 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          Git 액세스 토큰 <span className="text-ive-text-dim font-normal">(Personal Access Token)</span>
        </label>
        <input
          type="password"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxx"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
        />
        <p className="text-sm text-ive-text-dim mt-1">
          <i className="fa-solid fa-lock mr-1" />이슈 목록 조회 및 작업 완료 보고를 위해 필요합니다. 암호화되어 저장됩니다.
        </p>
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

      {/* 이슈 레이블 설정 (고급 설정 형식) */}
      <div className="border-t border-ive-border-dark pt-2">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-base font-bold text-ive-green mb-3"
        >
          <i className={`fa-solid ${showAdvanced ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
          이슈 수명 주기 및 실패 레이블 설정
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 pb-2 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">대상 식별</label>
              <input
                type="text"
                value={labelTarget}
                onChange={e => setLabelTarget(e.target.value)}
                placeholder="IVE"
                className="w-full bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green font-bold"
              />
            </div>
            <div className="opacity-0" /> {/* Spacer */}
            
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">개발 단계 (D)</label>
              <input
                type="text"
                value={labelInProgress}
                onChange={e => setLabelInProgress(e.target.value)}
                placeholder="IVE(D)"
                className="w-full bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green font-bold"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-ive-red/70 mb-1.5 uppercase ml-1">개발 실패 (DF)</label>
              <input
                type="text"
                value={labelFailDev}
                onChange={e => setLabelFailDev(e.target.value)}
                placeholder="IVE(DF)"
                className="w-full bg-ive-bg-deep border border-ive-red/20 rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-red/50 font-bold"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">검증 단계 (V)</label>
              <input
                type="text"
                value={labelValidation}
                onChange={e => setLabelValidation(e.target.value)}
                placeholder="IVE(V)"
                className="w-full bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green font-bold"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-ive-red/70 mb-1.5 uppercase ml-1">검증 실패 (VF)</label>
              <input
                type="text"
                value={labelFailVal}
                onChange={e => setLabelFailVal(e.target.value)}
                placeholder="IVE(VF)"
                className="w-full bg-ive-bg-deep border border-ive-red/20 rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-red/50 font-bold"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">최종 완료 (E)</label>
              <input
                type="text"
                value={labelDone}
                onChange={e => setLabelDone(e.target.value)}
                placeholder="IVE(E)"
                className="w-full bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-2 text-base text-ive-text focus:outline-none focus:border-ive-green font-bold"
              />
            </div>
          </div>
        )}
      </div>

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
