'use client'

import Link from 'next/link'
import { Project, ProjectRole } from '@/types'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'

interface Props {
  project: Project
  roles: ProjectRole[]
}

export default function ProjectCard({ project, roles }: Props) {
  const { updateProject } = useStore()
  const activeRoles = roles.filter(r => r.status === 'active').length
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
      // 다시 시작할 때 마지막 확인 시간을 현재로 리셋하여 카운트를 처음부터 시작
      lastCheckedAt: nextActive ? new Date().toISOString() : project.lastCheckedAt
    })
  }

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block bg-ive-bg-card rounded-xl p-4 border border-ive-border-subtle active:scale-[0.98] transition-all hover:border-ive-green/30 shadow-sm relative overflow-hidden group"
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
          <div className="text-[10px] text-ive-text-muted truncate font-mono opacity-60 mb-1">
            {project.repoUrl}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {project.lastCheckedAt ? (
              <div className="text-[9px] text-ive-green/50 font-medium flex items-center gap-1.5">
                <span>
                  <i className="fa-solid fa-bolt-lightning mr-1 opacity-70" />
                  최근: {new Date(project.lastCheckedAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '')}
                </span>
                <span className="px-1 py-0.5 rounded bg-ive-green/10 text-ive-green/60 border border-ive-green/20">
                  {project.lastScannedIssueCount ?? 0} 이슈
                </span>
              </div>
            ) : (
              <div className="text-[9px] text-ive-text-dim italic font-medium opacity-50">No scan history</div>
            )}
            
            <button
              onClick={toggleScanner}
              className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ml-1 ${
                project.scannerActive 
                  ? 'bg-ive-bg-deep text-ive-green/60 hover:text-ive-green hover:bg-ive-green/10 border border-ive-border-dark' 
                  : 'bg-ive-red/10 text-ive-red border border-ive-red/30 hover:bg-ive-red/20 scale-105'
              }`}
              title={project.scannerActive ? '일시정지' : '다시 시작'}
            >
              {project.scannerActive ? <i className="fa-solid fa-pause text-[8px]" /> : <i className="fa-solid fa-play text-[8px] ml-0.5" />}
            </button>
          </div>
        </div>

        {/* 스캐너 파이 차트 */}
        <div className="flex flex-col items-center justify-center w-14">
          <div className="relative w-11 h-11 shrink-0">
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
              <div className="absolute inset-[3.5px] rounded-full bg-ive-bg-card flex items-center justify-center shadow-lg">
                {!project.scannerActive ? (
                  <i className="fa-solid fa-circle-stop text-[12px] text-ive-red/60" />
                ) : timeLeft.text === '곧 실행' ? (
                  <i className="fa-solid fa-cog text-[14px] text-ive-green animate-spin-slow" />
                ) : (
                  <span className="text-[12px] font-black text-ive-green/90 flex items-baseline tracking-tight">
                    {timeLeft.displayValue}
                    {timeLeft.unit && <span className="text-[7.5px] ml-0.5 opacity-60 font-black">{timeLeft.unit}</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-4 mt-3 pt-3 border-t border-ive-border-dark">
        <div className="text-center">
          <div className="text-base font-black text-ive-green-light leading-none">{roles.length}</div>
          <div className="text-[8px] text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">역할</div>
        </div>
        <div className="text-center">
          <div className="text-base font-black text-ive-amber leading-none">{activeRoles}</div>
          <div className="text-[8px] text-ive-text-muted uppercase tracking-tighter mt-1 font-bold">활성</div>
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
  )
}
