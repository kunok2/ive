'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import RoleCard from '@/components/role/RoleCard'
import RoleForm from '@/components/role/RoleForm'
import ProjectForm from '@/components/project/ProjectForm'
import AgentAssignList from '@/components/agent/AgentAssignList'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state, deleteProject, deleteRole, assignAgent, unassignAgent } = useStore()

  const [showNewRole, setShowNewRole] = useState(false)
  const [showEditProject, setShowEditProject] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)

  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<any | null>(null)
  const [manageAgentsRoleId, setManageAgentsRoleId] = useState<string | null>(null)
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

  const roles = project.roles || []
  const managingRole = roles.find(r => r.id === manageAgentsRoleId)

  async function handleDeleteProject() {
    await deleteProject(id)
    router.push('/')
  }

  async function handleDeleteRole(roleId: string) {
    await deleteRole(id, roleId)
    setDeleteRoleId(null)
  }

  async function handleAssignAgent(agentId: string) {
    if (!manageAgentsRoleId) return
    setAssignError('')
    try {
      await assignAgent(id, manageAgentsRoleId, agentId)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Agent 배정 실패')
    }
  }

  async function handleUnassignAgent(agentId: string) {
    if (!manageAgentsRoleId) return
    setAssignError('')
    try {
      await unassignAgent(id, manageAgentsRoleId, agentId)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Agent 해제 실패')
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
              <div className="text-base text-ive-text-muted truncate mt-0.5">{project.repoUrl}</div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-ive-border-dark relative z-10 gap-2">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-xl font-black text-ive-green-light leading-none">{roles.length}</div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">역할</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black text-ive-amber leading-none">
                  {roles.filter(r => r.status === 'active').length}
                </div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">활성</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black text-ive-cyan leading-none">
                  {roles.reduce((sum, r) => sum + (r.assignedAgents?.length || 0), 0)}
                </div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">Agent</div>
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

        {/* 역할 섹션 */}
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-base font-black text-ive-text uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ive-green" />
            역할 목록 ({roles.length})
          </h2>
          <button
            onClick={() => setShowNewRole(true)}
            className="text-base font-bold text-ive-green bg-ive-green/10 px-4 py-2 rounded-xl active:scale-95 transition-all hover:bg-ive-green/15"
          >
            <i className="fa-solid fa-plus mr-1.5" />역할 추가
          </button>
        </div>

        {roles.length === 0 ? (
          <div className="text-center py-16 bg-ive-bg-card rounded-2xl border border-dashed border-ive-border-subtle group hover:border-ive-green/30 transition-all">
            <i className="fa-solid fa-id-card-clip text-4xl text-ive-text-dim mb-4 block group-hover:scale-110 transition-transform" />
            <p className="text-base text-ive-text-muted mb-4 font-medium">프로젝트 내 수행할 역할을 정의해주세요</p>
            <button
              onClick={() => setShowNewRole(true)}
              className="inline-flex items-center gap-2 bg-ive-green-dark text-white font-black px-6 py-2.5 rounded-xl text-base shadow-lg shadow-ive-green/10"
            >
              <i className="fa-solid fa-plus" />첫 역할 만들기
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {roles.map(role => (
              <RoleCard
                key={role.id}
                role={role}
                onDelete={(roleId) => setDeleteRoleId(roleId)}
                onManageAgents={(roleId) => {
                  setManageAgentsRoleId(roleId)
                  setAssignError('')
                }}
                onEdit={(role) => setEditRole(role)}
              />
            ))}
          </div>
        )}
      </main>

      {/* 모달들 */}
      <Modal open={showNewRole} onClose={() => setShowNewRole(false)} title="역할 정의">
        <RoleForm projectId={id} onSuccess={() => setShowNewRole(false)} />
      </Modal>

      <Modal open={editRole !== null} onClose={() => setEditRole(null)} title="역할 수정">
        {editRole && (
          <RoleForm
            projectId={id}
            existing={editRole}
            onSuccess={() => setEditRole(null)}
          />
        )}
      </Modal>

      <Modal open={showEditProject} onClose={() => setShowEditProject(false)} title="프로젝트 설정">
        <ProjectForm existing={project} onSuccess={() => setShowEditProject(false)} />
      </Modal>

      <Modal
        open={manageAgentsRoleId !== null}
        onClose={() => setManageAgentsRoleId(null)}
        title={managingRole ? `AI Agent 배정 — ${managingRole.name}` : 'Agent 배정'}
      >
        {managingRole && (
          <div className="space-y-4">
            <AgentAssignList
              agents={state.agents}
              assignedAgentIds={managingRole.assignedAgents?.map(ra => ra.agentId) || []}
              onAssign={handleAssignAgent}
              onUnassign={handleUnassignAgent}
              maxAgents={managingRole.maxAgents}
              currentCount={managingRole.assignedAgents?.length || 0}
            />
            {assignError && (
              <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-4 py-3 border border-ive-red/20 animate-shake">
                <i className="fa-solid fa-circle-exclamation mr-1.5" />{assignError}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={showDeleteProject}
        onClose={() => setShowDeleteProject(false)}
        onConfirm={handleDeleteProject}
        title="프로젝트 삭제"
        message="정말 이 프로젝트를 삭제하시겠습니까? 관련 역할과 배정 정보가 모두 사라집니다."
        confirmLabel="영구 삭제"
        danger
      />

      <ConfirmModal
        open={deleteRoleId !== null}
        onClose={() => setDeleteRoleId(null)}
        onConfirm={() => deleteRoleId && handleDeleteRole(deleteRoleId)}
        title="역할 삭제"
        message="이 역할을 삭제하면 배정된 Agent들이 해제됩니다. 정말 삭제하시겠습니까?"
        confirmLabel="역할 삭제"
        danger
      />


<MobileTabBar />
    </div>
  )
}
