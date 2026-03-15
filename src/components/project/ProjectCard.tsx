'use client'

import Link from 'next/link'
import { Project, ProjectRole, RoleAssignment, Agent } from '@/types'

interface RoleWithAgents extends ProjectRole {
  assignedAgents: (RoleAssignment & { agent: Agent })[]
}
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import ExecutionTrace from '@/components/project/ExecutionTrace'

interface Props {
  project: Project
  roles: RoleWithAgents[]
}

export default function ProjectCard({ project, roles }: Props) {
  const { updateProject, scanProjectNow } = useStore()
  const [scanning, setScanning] = useState(false)
  const [showTrace, setShowTrace] = useState(false)
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issueDesc, setIssueDesc] = useState('')
  const [issueAsDev, setIssueAsDev] = useState(true)
  const [issueSubmitting, setIssueSubmitting] = useState(false)
  const [issueError, setIssueError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const [runningCount, setRunningCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fetchRunning = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/executions`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setRunningCount(data.filter((e: any) => e.status === 'running').length)
        }
      } catch { /* ignore */ }
    }
    fetchRunning()
    const timer = setInterval(fetchRunning, 10000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [project.id])
  const [timeLeft, setTimeLeft] = useState<{ text: string; percent: number; displayValue: string; unit: string }>({
    text: '대기 중', percent: 0, displayValue: '-', unit: ''
  })

  useEffect(() => {
    function calculateStatus() {
      if (!project.scannerActive) {
        setTimeLeft({ text: '일시정지', percent: 0, displayValue: 'PAUSE', unit: '' })
        return
      }

      if (!project.lastCheckedAt) {
        setTimeLeft({ text: '대기 중', percent: 0, displayValue: '-', unit: '' })
        return
      }

      const now = new Date()
      const last = new Date(project.lastCheckedAt)
      const intervalMs = project.checkInterval * 60 * 1000
      const elapsedMs = now.getTime() - last.getTime()

      if (elapsedMs >= intervalMs) {
        setTimeLeft({ text: '곧 실행', percent: 100, displayValue: '0', unit: 's' })
        return
      }

      const remainingMs = Math.max(0, intervalMs - elapsedMs)
      const percent = Math.min(100, Math.max(0, (elapsedMs / intervalMs) * 100))

      let displayValue = ''
      let unit = ''
      let bottomText = ''

      if (remainingMs < 60 * 1000) {
        displayValue = Math.ceil(remainingMs / 1000).toString()
        unit = 's'
        bottomText = `${displayValue}초 남음`
      } else if (remainingMs < 60 * 60 * 1000) {
        displayValue = Math.ceil(remainingMs / (60 * 1000)).toString()
        unit = 'm'
        bottomText = `${displayValue}분 남음`
      } else {
        displayValue = Math.ceil(remainingMs / (60 * 60 * 1000)).toString()
        unit = 'h'
        bottomText = `${displayValue}시간 남음`
      }

      setTimeLeft({ text: bottomText, percent, displayValue, unit })
    }

    calculateStatus()
    const timer = setInterval(calculateStatus, 1000)
    return () => clearInterval(timer)
  }, [project.lastCheckedAt, project.checkInterval, project.scannerActive])

  const toggleScanner = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const nextActive = !project.scannerActive
    await updateProject({
      ...project,
      scannerActive: nextActive,
      lastCheckedAt: nextActive ? new Date().toISOString() : project.lastCheckedAt
    })
  }

  const handleManualScan = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (scanning) return

    setScanning(true)
    try {
      await scanProjectNow(project.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : '스캔 실행 중 오류가 발생했습니다.')
    } finally {
      setScanning(false)
    }
  }

  const openIssueModal = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIssueTitle('')
    setIssueDesc('')
    setIssueAsDev(true)
    setIssueError('')
    setShowIssueModal(true)
    setTimeout(() => titleRef.current?.focus(), 50)
  }

  const handleIssueSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    // IME 조합 중인 마지막 글자까지 포함하기 위해 DOM 값을 직접 읽음
    const currentTitle = titleRef.current?.value ?? issueTitle
    const currentDesc = descRef.current?.value ?? issueDesc
    if (!currentTitle.trim() || issueSubmitting) return
    setIssueSubmitting(true)
    setIssueError('')
    try {
      const res = await fetch(`/api/projects/${project.id}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: currentTitle, description: currentDesc, asDev: issueAsDev }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '이슈 생성 실패')
      setShowIssueModal(false)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : '이슈 생성 중 오류가 발생했습니다.')
    } finally {
      setIssueSubmitting(false)
    }
  }

  return (
    <div className={`bg-ive-bg-card rounded-xl border shadow-sm overflow-hidden transition-colors duration-200 ${showTrace ? 'border-ive-cyan/30' : 'border-ive-border-subtle hover:border-ive-green/30'}`}>
      <Link
        href={`/projects/${project.id}`}
        className="block p-4 active:bg-white/[0.03] transition-colors group"
      >
        <div className="flex items-start gap-3">
          {/* 플랫폼 아이콘 */}
          <div className="w-10 h-10 rounded-lg bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center shrink-0 mt-0.5">
            <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl text-ive-green`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-bold text-base text-ive-green-pale truncate leading-none mb-1">
              {project.name}
            </div>
            <a
              href={project.repoUrl.replace(/\.git$/, '')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-sm text-ive-text-muted font-mono opacity-60 mb-1 break-all leading-tight hover:text-ive-green hover:opacity-100 transition-colors inline-block"
            >
              {project.repoUrl}
              <i className="fa-solid fa-arrow-up-right-from-square text-xs ml-1 opacity-50" />
            </a>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                {project.lastCheckedAt ? (
                  <>
                    <span className="text-sm text-ive-green/50 font-medium whitespace-nowrap flex items-center gap-1">
                      <i className="fa-solid fa-bolt-lightning opacity-70" />
                      {new Date(project.lastCheckedAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')}
                    </span>
                    <span className="px-1 py-0.5 rounded bg-ive-green/10 text-sm text-ive-green/60 border border-ive-green/20 whitespace-nowrap shrink-0">
                      {project.lastScannedIssueCount ?? 0} 이슈
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-ive-text-dim italic font-medium opacity-50 whitespace-nowrap">No scan history</span>
                )}
              </div>
            </div>
          </div>

          {/* 스캐너 파이 차트 + 버튼 */}
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="relative w-9 h-9">
              <div
                className={`absolute inset-0 rounded-full border flex items-center justify-center overflow-hidden transition-all duration-500 shadow-inner ${
                  project.scannerActive ? 'bg-ive-bg-deep border-ive-border-dark' : 'bg-ive-bg-deep/50 border-ive-red/20 opacity-60'
                }`}
                style={{
                  background: project.scannerActive
                    ? `conic-gradient(#34d399 ${timeLeft.percent}%, transparent ${timeLeft.percent}%)`
                    : 'none'
                }}
              >
                <div className="absolute inset-[1px] rounded-full bg-ive-bg-card flex items-center justify-center shadow-lg">
                  {!project.scannerActive ? (
                    <i className="fa-solid fa-circle-stop text-sm text-ive-red/60" />
                  ) : timeLeft.text === '곧 실행' ? (
                    <i className="fa-solid fa-circle-notch fa-spin text-base text-ive-green" />
                  ) : (
                    <span className="text-sm font-black text-ive-green/90 flex items-baseline tracking-tight">
                      {timeLeft.displayValue}
                      {timeLeft.unit && <span className="text-xs ml-0.5 opacity-60 font-black">{timeLeft.unit}</span>}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex">
              <button
                onClick={toggleScanner}
                className="p-2 flex items-center justify-center transition-all"
                title={project.scannerActive ? '일시정지' : '다시 시작'}
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  project.scannerActive
                    ? 'bg-ive-bg-deep text-ive-green/60 hover:text-ive-green hover:bg-ive-green/10 border border-ive-border-dark'
                    : 'bg-ive-red/10 text-ive-red border border-ive-red/30 hover:bg-ive-red/20 scale-105'
                }`}>
                  {project.scannerActive ? <i className="fa-solid fa-pause text-sm" /> : <i className="fa-solid fa-play text-sm ml-px" />}
                </span>
              </button>
              <button
                onClick={handleManualScan}
                disabled={scanning || !project.scannerActive}
                className="p-2 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                title="지금 스캔 수행"
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                  scanning
                    ? 'bg-ive-green/20 text-ive-green border border-ive-green/30'
                    : 'bg-ive-bg-deep text-ive-green/60 hover:text-ive-green hover:bg-ive-green/10 border border-ive-border-dark'
                }`}>
                  {scanning
                    ? <i className="fa-solid fa-circle-notch fa-spin text-sm" />
                    : <i className="fa-solid fa-rocket text-sm" />}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-4 mt-3 pt-3 border-t border-ive-border-dark">
          <div className="text-center">
            <div className="text-lg font-black text-ive-green-light leading-none">{roles.length}</div>
            <div className="text-sm text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">역할</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-black leading-none ${runningCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>{runningCount}</div>
            <div className="text-sm text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">작업중</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-black leading-none ${(project.lastScannedIssueCount ?? 0) > 0 ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>{project.lastScannedIssueCount ?? 0}</div>
            <div className="text-sm text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">대기</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 self-end pb-0.5">
            <div className="flex gap-0.5">
              {[1, 2, 3].map(i => (
                <div key={i} className={`w-1 h-3 rounded-full ${i <= (roles.length > 3 ? 3 : roles.length) ? 'bg-ive-green/30' : 'bg-ive-border-dark'}`} />
              ))}
            </div>
            <span className="text-sm text-ive-text-dim italic font-medium">Details</span>
          </div>
        </div>
      </Link>

      {/* 이슈 등록 버튼 */}
      <button
        onClick={openIssueModal}
        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-ive-border-dark bg-ive-bg-deep/70 text-sm font-bold uppercase tracking-widest text-ive-text-dim hover:text-ive-green hover:bg-ive-green/5 transition-all"
      >
        <i className="fa-solid fa-plus text-sm" />
        이슈 등록
      </button>

      {/* 실행 기록 토글 */}
      <button
        onClick={() => setShowTrace(prev => !prev)}
        className={`w-full flex items-center justify-between px-4 py-2.5 border-t text-sm font-bold uppercase tracking-widest transition-all ${
          showTrace
            ? 'border-ive-cyan/20 bg-ive-cyan/5 text-ive-cyan'
            : 'border-ive-border-dark bg-ive-bg-deep/70 text-ive-text-dim hover:text-ive-cyan hover:bg-ive-cyan/5'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <i className="fa-solid fa-terminal text-sm" />
          실행 기록
        </span>
        <i className={`fa-solid fa-chevron-${showTrace ? 'up' : 'down'} text-sm`} />
      </button>

      {showTrace && (
        <div className="border-t border-ive-cyan/20">
          <ExecutionTrace projectId={project.id} className="h-[400px]" />
        </div>
      )}

      {/* 이슈 등록 모달 */}
      {showIssueModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowIssueModal(false)}
        >
          <div
            className="w-full h-full bg-ive-bg-card shadow-2xl pt-6 px-6 pb-[calc(1.5rem+56px)] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black text-ive-green-pale flex items-center gap-2">
                <i className="fa-solid fa-circle-plus text-ive-green" />
                이슈 등록 — {project.name}
              </h3>
              <button onClick={() => setShowIssueModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-ive-text-muted hover:text-ive-text hover:bg-white/5 transition-colors">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <form onSubmit={handleIssueSubmit} className="flex flex-col gap-4 flex-1 min-h-0">
              <input
                ref={titleRef}
                type="text"
                value={issueTitle}
                onChange={e => setIssueTitle(e.target.value)}
                placeholder="이슈 제목"
                className="w-full bg-ive-bg-input border border-ive-border rounded-xl px-4 py-4 text-lg text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
              />
              <textarea
                ref={descRef}
                value={issueDesc}
                onChange={e => setIssueDesc(e.target.value)}
                placeholder="설명 (선택)"
                className="flex-1 min-h-0 w-full bg-ive-bg-input border border-ive-border rounded-xl px-4 py-4 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none"
              />
              <label className="flex items-center gap-3 cursor-pointer select-none py-1">
                <div
                  onClick={() => setIssueAsDev(v => !v)}
                  className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${issueAsDev ? 'bg-ive-green' : 'bg-ive-border'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${issueAsDev ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-base text-ive-text-muted">
                  바로 개발 의뢰로 처리
                  <span className="ml-1.5 text-ive-green/60 font-mono text-base">({project.labelTarget})</span>
                </span>
              </label>

              {issueError && (
                <div className="text-base text-ive-red bg-ive-red/10 border border-ive-red/20 rounded-xl px-4 py-3">
                  <i className="fa-solid fa-circle-exclamation mr-1.5" />{issueError}
                </div>
              )}

              <button
                type="submit"
                disabled={!issueTitle.trim() || issueSubmitting}
                className="w-full bg-ive-green-dark text-white font-black py-4 rounded-xl text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {issueSubmitting
                  ? <><i className="fa-solid fa-circle-notch fa-spin mr-2" />등록 중...</>
                  : <><i className="fa-solid fa-plus mr-2" />이슈 등록</>}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
