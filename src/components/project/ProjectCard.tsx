'use client'

import Link from 'next/link'
import { Project, ProjectRole, RoleAssignment, Agent } from '@/types'

interface RoleWithAgents extends ProjectRole {
  assignedAgents: (RoleAssignment & { agent: Agent })[]
}
import { useEffect, useState } from 'react'
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
  const busyAgents = roles.reduce((sum, r) =>
    sum + (r.assignedAgents?.filter(a => a.agent.status === 'busy').length ?? 0), 0
  )
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

  return (
    <div className={`bg-ive-bg-card rounded-xl border shadow-sm overflow-hidden transition-colors duration-200 ${showTrace ? 'border-ive-cyan/30' : 'border-ive-border-subtle hover:border-ive-green/30'}`}>
      <Link
        href={`/projects/${project.id}`}
        className="block p-4 active:bg-white/[0.03] transition-colors group"
      >
        <div className="flex items-start gap-3">
          {/* 플랫폼 아이콘 */}
          <div className="w-10 h-10 rounded-lg bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center shrink-0 mt-0.5">
            <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-lg text-ive-green`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm text-ive-green-pale truncate leading-none mb-1">
              {project.name}
            </div>
            <div className="text-[10px] text-ive-text-muted font-mono opacity-60 mb-1 break-all leading-tight">
              {project.repoUrl}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                {project.lastCheckedAt ? (
                  <>
                    <span className="text-[9px] text-ive-green/50 font-medium whitespace-nowrap flex items-center gap-1">
                      <i className="fa-solid fa-bolt-lightning opacity-70" />
                      {new Date(project.lastCheckedAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')}
                    </span>
                    <span className="px-1 py-0.5 rounded bg-ive-green/10 text-[9px] text-ive-green/60 border border-ive-green/20 whitespace-nowrap shrink-0">
                      {project.lastScannedIssueCount ?? 0} 이슈
                    </span>
                  </>
                ) : (
                  <span className="text-[9px] text-ive-text-dim italic font-medium opacity-50 whitespace-nowrap">No scan history</span>
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
                    <i className="fa-solid fa-circle-stop text-[10px] text-ive-red/60" />
                  ) : timeLeft.text === '곧 실행' ? (
                    <i className="fa-solid fa-circle-notch fa-spin text-[11px] text-ive-green" />
                  ) : (
                    <span className="text-[10px] font-black text-ive-green/90 flex items-baseline tracking-tight">
                      {timeLeft.displayValue}
                      {timeLeft.unit && <span className="text-[6px] ml-0.5 opacity-60 font-black">{timeLeft.unit}</span>}
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
                  {project.scannerActive ? <i className="fa-solid fa-pause text-[9px]" /> : <i className="fa-solid fa-play text-[9px] ml-px" />}
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
                    ? <i className="fa-solid fa-circle-notch fa-spin text-[9px]" />
                    : <i className="fa-solid fa-rocket text-[9px]" />}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-4 mt-3 pt-3 border-t border-ive-border-dark">
          <div className="text-center">
            <div className="text-base font-black text-ive-green-light leading-none">{roles.length}</div>
            <div className="text-[8px] text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">역할</div>
          </div>
          <div className="text-center">
            <div className={`text-base font-black leading-none ${busyAgents > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>{busyAgents}</div>
            <div className="text-[8px] text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">작업중</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 self-end pb-0.5">
            <div className="flex gap-0.5">
              {[1, 2, 3].map(i => (
                <div key={i} className={`w-1 h-3 rounded-full ${i <= (roles.length > 3 ? 3 : roles.length) ? 'bg-ive-green/30' : 'bg-ive-border-dark'}`} />
              ))}
            </div>
            <span className="text-[9px] text-ive-text-dim italic font-medium">Details</span>
          </div>
        </div>
      </Link>

      {/* 실행 기록 토글 */}
      <button
        onClick={() => setShowTrace(prev => !prev)}
        className={`w-full flex items-center justify-between px-4 py-2.5 border-t text-[10px] font-bold uppercase tracking-widest transition-all ${
          showTrace
            ? 'border-ive-cyan/20 bg-ive-cyan/5 text-ive-cyan'
            : 'border-ive-border-dark bg-ive-bg-deep/70 text-ive-text-dim hover:text-ive-cyan hover:bg-ive-cyan/5'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <i className="fa-solid fa-terminal text-[9px]" />
          실행 기록
        </span>
        <i className={`fa-solid fa-chevron-${showTrace ? 'up' : 'down'} text-[8px]`} />
      </button>

      {showTrace && (
        <div className="border-t border-ive-cyan/20">
          <ExecutionTrace projectId={project.id} className="h-[400px]" />
        </div>
      )}
    </div>
  )
}
