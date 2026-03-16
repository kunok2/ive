'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import ProjectForm from '@/components/project/ProjectForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state, deleteProject, assignAgentToProject, unassignAgentFromProject } = useStore()

  const [showEditProject, setShowEditProject] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)
  const [showAssignAgent, setShowAssignAgent] = useState(false)
  const [assignError, setAssignError] = useState('')

  const project = state.projects.find(p => p.id === id)

  if (state.loading) {
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted text-base">불러오는 중...</div>
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-ive-text-muted mb-4">프로젝트를 찾을 수 없습니다</p>
          <Link href="/" className="text-ive-green text-base font-semibold">
            <i className="fa-solid fa-arrow-left mr-1" />홈으로
          </Link>
        </div>
      </div>
    )
  }

  const assignedAgents = project.assignedAgents || []
  // 모든 프로젝트에 배정된 에이전트 ID 수집 (한 에이전트는 한 프로젝트에만 배정 가능)
  const allAssignedAgentIds = new Set<string>()
  for (const p of state.projects) {
    for (const pa of (p.assignedAgents || [])) {
      allAssignedAgentIds.add(pa.agentId)
    }
  }
  const availableAgents = state.agents.filter(a => !allAssignedAgentIds.has(a.id))

  async function handleDeleteProject() {
    await deleteProject(id)
    router.push('/')
  }

  async function handleAssignAgent(agentId: string) {
    setAssignError('')
    try {
      await assignAgentToProject(id, agentId)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : '개발자 배정 실패')
    }
  }

  async function handleUnassignAgent(agentId: string) {
    setAssignError('')
    try {
      await unassignAgentFromProject(id, agentId)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : '개발자 해제 실패')
    }
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <Link href="/" className="text-ive-green text-base font-semibold p-1 hover:bg-ive-green/5 rounded">
            <i className="fa-solid fa-arrow-left mr-1" />뒤로
          </Link>
          <h1 className="text-lg font-bold text-ive-green-pale flex-1 truncate">{project.name}</h1>
        </div>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto">
        {/* 프로젝트 정보 헤더 */}
        <div
          className="bg-ive-bg-card rounded-xl p-5 border border-ive-border-subtle mb-6 relative overflow-hidden group"
          style={{ borderLeftWidth: '3px', borderLeftColor: project.color || '#4ade80' }}
        >
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-6xl`} />
          </div>

          <div className="flex items-center gap-3 mb-4 relative z-10">
            <div
              className="w-12 h-12 rounded-xl bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0 shadow-lg"
              style={{ borderColor: `${project.color || '#4ade80'}40` }}
            >
              <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-3xl`} style={{ color: project.color || '#4ade80' }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold truncate leading-tight" style={{ color: project.color || '#4ade80' }}>{project.name}</div>
              <a
                href={project.repoUrl.replace(/\.git$/, '')}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-ive-text-muted truncate mt-0.5 hover:text-ive-green transition-colors inline-flex items-center gap-1"
              >
                {project.repoUrl}
                <i className="fa-solid fa-arrow-up-right-from-square text-xs opacity-50 shrink-0" />
              </a>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-ive-border-dark relative z-10 gap-2">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className={`text-xl font-black leading-none ${assignedAgents.length > 0 ? 'text-ive-green-light' : 'text-ive-text-dim'}`}>{assignedAgents.length}</div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">개발자</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-black leading-none ${(project.lastScannedIssueCount ?? 0) > 0 ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>
                  {project.lastScannedIssueCount ?? 0}
                </div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">대기</div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setShowEditProject(true)}
                className="text-base font-black text-ive-text-muted border border-ive-border px-3 py-2 rounded-xl hover:border-ive-green/30 hover:text-ive-green transition-all bg-ive-bg/50"
              >
                <i className="fa-solid fa-pen-to-square mr-1" />수정
              </button>
              <button
                onClick={() => setShowDeleteProject(true)}
                className="text-base font-black text-ive-red/60 border border-ive-red/20 px-3 py-2 rounded-xl hover:bg-ive-red/10 transition-all"
              >
                <i className="fa-solid fa-trash-can" />
              </button>
            </div>
          </div>
        </div>

        {/* 배정된 개발자 섹션 */}
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-base font-black text-ive-text uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ive-green" />
            배정된 개발자 ({assignedAgents.length})
          </h2>
          <button
            onClick={() => { setShowAssignAgent(true); setAssignError('') }}
            className="text-base font-bold text-ive-green bg-ive-green/10 px-4 py-2 rounded-xl active:scale-95 transition-all hover:bg-ive-green/15"
          >
            <i className="fa-solid fa-plus mr-1.5" />개발자 배정
          </button>
        </div>

        {assignedAgents.length === 0 ? (
          <div className="text-center py-16 bg-ive-bg-card rounded-2xl border border-dashed border-ive-border-subtle group hover:border-ive-green/30 transition-all">
            <i className="fa-solid fa-robot text-4xl text-ive-text-dim mb-4 block group-hover:scale-110 transition-transform" />
            <p className="text-base text-ive-text-muted mb-4 font-medium">이 프로젝트에 배정된 개발자가 없습니다</p>
            <button
              onClick={() => { setShowAssignAgent(true); setAssignError('') }}
              className="inline-flex items-center gap-2 bg-ive-green-dark text-white font-black px-6 py-2.5 rounded-xl text-base shadow-lg shadow-ive-green/10"
            >
              <i className="fa-solid fa-plus" />개발자 배정하기
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {assignedAgents.map(pa => (
              <AgentCard key={pa.id} agent={pa.agent} compact onRemove={() => handleUnassignAgent(pa.agentId)} />
            ))}
          </div>
        )}

        {assignError && (
          <div className="mt-3 text-base text-ive-red bg-ive-red/10 rounded-lg px-4 py-3 border border-ive-red/20 animate-shake">
            <i className="fa-solid fa-circle-exclamation mr-1.5" />{assignError}
          </div>
        )}
      </main>

      {/* 모달들 */}
      <Modal open={showEditProject} onClose={() => setShowEditProject(false)} title="프로젝트 설정">
        <ProjectForm existing={project} onSuccess={() => setShowEditProject(false)} />
      </Modal>

      <Modal open={showAssignAgent} onClose={() => setShowAssignAgent(false)} title="개발자 배정">
        <div className="space-y-3">
          {availableAgents.length === 0 ? (
            <div className="text-center py-8 text-ive-text-muted">
              <i className="fa-solid fa-robot text-3xl text-ive-text-dim mb-3 block" />
              <p className="text-base">배정 가능한 개발자가 없습니다</p>
              <p className="text-sm text-ive-text-dim mt-1">새 개발자를 등록하거나, 다른 프로젝트에서 해제하세요</p>
            </div>
          ) : (
            availableAgents.map(agent => (
              <div key={agent.id} className="flex items-center gap-3 bg-ive-bg rounded-xl p-3 border border-ive-border-subtle">
                <div className="flex-1 min-w-0">
                  <AgentCard agent={agent} compact />
                </div>
                <button
                  onClick={() => handleAssignAgent(agent.id)}
                  className="shrink-0 text-base font-bold text-ive-green bg-ive-green/10 px-3 py-1.5 rounded-lg hover:bg-ive-green/20 transition-colors"
                >
                  <i className="fa-solid fa-plus mr-1" />배정
                </button>
              </div>
            ))
          )}
          {assignError && (
            <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-4 py-3 border border-ive-red/20">
              <i className="fa-solid fa-circle-exclamation mr-1.5" />{assignError}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={showDeleteProject}
        onClose={() => setShowDeleteProject(false)}
        onConfirm={handleDeleteProject}
        title="프로젝트 삭제"
        message="정말 이 프로젝트를 삭제하시겠습니까? 배정된 개발자와 실행 기록이 모두 사라집니다."
        confirmLabel="영구 삭제"
        danger
      />

      <MobileTabBar />
    </div>
  )
}
