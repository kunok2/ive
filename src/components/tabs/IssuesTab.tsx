'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'

interface IveIssue {
  iid: number
  title: string
  stage: string
  state: string
  labels: string[]
  createdAt: string
  updatedAt: string
  author: string
}

const STAGE_INFO: Record<string, { label: string; color: string; icon: string }> = {
  waiting:    { label: '대기',     color: 'bg-ive-green/20 text-ive-green border-ive-green/30', icon: 'fa-clock' },
  dev:        { label: '개발 중',  color: 'bg-ive-cyan/20 text-ive-cyan border-ive-cyan/30', icon: 'fa-code' },
  dev_fail:   { label: '개발 실패', color: 'bg-ive-red/20 text-ive-red border-ive-red/30', icon: 'fa-circle-xmark' },
  validation: { label: '검증 대기', color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30', icon: 'fa-flask' },
  val_fail:   { label: '검증 실패', color: 'bg-ive-red/20 text-ive-red border-ive-red/30', icon: 'fa-triangle-exclamation' },
  done:       { label: '완료',     color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: 'fa-circle-check' },
  unknown:    { label: '알 수 없음', color: 'bg-white/10 text-ive-text-dim border-white/20', icon: 'fa-question' },
}

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '진행' },
  { key: 'failed', label: '실패' },
  { key: 'done', label: '완료' },
]

export default function IssuesTab() {
  const router = useRouter()
  const { state } = useStore()
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [issues, setIssues] = useState<IveIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')

  // 프로젝트가 1개면 자동 선택
  useEffect(() => {
    if (state.projects.length === 1 && !selectedProjectId) {
      setSelectedProjectId(state.projects[0].id)
    }
  }, [state.projects, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId) return
    setLoading(true)
    fetch(`/api/projects/${selectedProjectId}/issues`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setIssues(data))
      .finally(() => setLoading(false))
  }, [selectedProjectId])

  const filtered = issues.filter(issue => {
    if (filter === 'all') return true
    if (filter === 'active') return ['waiting', 'dev', 'validation'].includes(issue.stage)
    if (filter === 'failed') return ['dev_fail', 'val_fail'].includes(issue.stage)
    if (filter === 'done') return issue.stage === 'done'
    return true
  })

  const selectedProject = state.projects.find(p => p.id === selectedProjectId)

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="px-4 py-3 max-w-lg mx-auto">
          <h1 className="text-lg font-extrabold text-ive-green-pale">이슈 관리</h1>
        </div>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.projects.length > 1 && (
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="w-full mb-4 bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3 text-ive-text font-bold text-base focus:outline-none focus:border-ive-green/50"
          >
            <option value="">프로젝트 선택</option>
            {state.projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {!selectedProjectId ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted">프로젝트를 선택하세요</p>
          </div>
        ) : (
          <>
            {selectedProject && (
              <div className="flex items-center gap-3 mb-4 bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3"
                   style={{ borderLeftWidth: '3px', borderLeftColor: selectedProject.color || '#4ade80' }}>
                <i className={`fa-brands ${selectedProject.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl`}
                   style={{ color: selectedProject.color || '#4ade80' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold text-ive-text truncate">{selectedProject.name}</div>
                  <div className="text-xs text-ive-text-dim truncate">{selectedProject.repoUrl}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-black text-ive-green-light">{issues.length}</div>
                  <div className="text-xs text-ive-text-dim">이슈</div>
                </div>
              </div>
            )}

            <div className="flex gap-1 mb-4 bg-ive-bg-card rounded-xl p-1 border border-ive-border-subtle">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                    filter === tab.key
                      ? 'bg-ive-green/20 text-ive-green'
                      : 'text-ive-text-dim hover:text-ive-text-muted'
                  }`}
                >
                  {tab.label}
                  {tab.key === 'all' && issues.length > 0 && (
                    <span className="ml-1 text-xs opacity-60">{issues.length}</span>
                  )}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="text-center py-20 text-ive-text-muted">이슈 불러오는 중...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
                <i className="fa-solid fa-inbox text-4xl text-ive-text-dim mb-4 block" />
                <p className="text-base text-ive-text-muted">
                  {issues.length === 0 ? 'IVE 이슈가 없습니다' : '해당 필터에 맞는 이슈가 없습니다'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filtered.map(issue => {
                  const stageInfo = STAGE_INFO[issue.stage] || STAGE_INFO.unknown
                  return (
                    <div
                      key={issue.iid}
                      onClick={() => router.push(`/issues/${selectedProjectId}/${issue.iid}`)}
                      className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-4 hover:border-ive-green/40 transition-all cursor-pointer active:scale-[0.98]"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-black text-ive-green">#{issue.iid}</span>
                          <h3 className="text-base font-bold text-ive-text leading-snug mt-0.5 line-clamp-2">{issue.title}</h3>
                        </div>
                        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg border ${stageInfo.color}`}>
                          <i className={`fa-solid ${stageInfo.icon} mr-1`} />
                          {stageInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-ive-text-dim">
                        <span>
                          <i className="fa-solid fa-user mr-1" />
                          {issue.author}
                        </span>
                        <span>
                          <i className="fa-solid fa-calendar-day mr-1" />
                          {new Date(issue.updatedAt).toLocaleString('ko-KR', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                          })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
