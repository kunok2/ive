'use client'

import { use, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import AgentForm from '@/components/agent/AgentForm'
import ProjectForm from '@/components/project/ProjectForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { useTranslations } from 'next-intl'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state, deleteProject, assignAgentToProject, unassignAgentFromProject, updateAgentToken } = useStore()

  const [showEditProject, setShowEditProject] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)
  const [showAssignAgent, setShowAssignAgent] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignToken, setAssignToken] = useState('')
  // 토큰 편집 중인 에이전트
  const [editingTokenAgentId, setEditingTokenAgentId] = useState<string | null>(null)
  const [editTokenValue, setEditTokenValue] = useState('')
  const tc = useTranslations('common')
  const tp = useTranslations('project')
  const ts = useTranslations('stage')
  const ta = useTranslations('agent')

  const [gitMembers, setGitMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [gitMembersLoading, setGitMembersLoading] = useState(false)

  const fetchGitMembers = useCallback(async () => {
    setGitMembersLoading(true)
    try {
      const res = await fetch(`/api/projects/${id}/members`)
      if (res.ok) {
        const data = await res.json()
        setGitMembers(data)
      }
    } catch { /* ignore */ }
    finally { setGitMembersLoading(false) }
  }, [id])

  useEffect(() => { fetchGitMembers() }, [fetchGitMembers])

  const project = state.projects.find(p => p.id === id)

  if (state.loading) {
    return <div className="h-full flex items-center justify-center text-ive-text-muted text-base">{tc('loading')}</div>
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-ive-text-muted mb-4">{tp('notFound')}</p>
          <Link href="/" className="text-ive-green text-base font-bold">
            <i className="fa-solid fa-arrow-left mr-1" />{tc('home')}
          </Link>
        </div>
      </div>
    )
  }

  const isOwner = !project.shareRole
  const canEdit = isOwner || project.shareRole === 'editor'
  const assignedAgents = project.assignedAgents || []
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
      await assignAgentToProject(id, agentId, assignToken.trim() || undefined)
      setAssignToken('')
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : tp('assignFailed'))
    }
  }

  async function handleUnassignAgent(agentId: string) {
    setAssignError('')
    try {
      await unassignAgentFromProject(id, agentId)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : tp('unassignFailed'))
    }
  }

  async function handleSaveToken(agentId: string) {
    await updateAgentToken(id, agentId, editTokenValue.trim())
    setEditingTokenAgentId(null)
    setEditTokenValue('')
  }

  return (
    <div className="h-full overflow-y-auto pb-20">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <Link href="/" className="text-ive-green text-base font-bold p-1 hover:bg-ive-green/5 rounded">
            <i className="fa-solid fa-arrow-left mr-1" />{tc('back')}
          </Link>
          <h1 className="text-lg font-bold text-ive-green-pale flex-1 truncate">{project.name}</h1>
        </div>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto">
        {/* 프로젝트 정보 헤더 */}
        <div
          className="bg-ive-bg-card rounded-lg p-5 border border-ive-border-subtle mb-6 relative overflow-hidden group"
          style={{ borderLeftWidth: '3px', borderLeftColor: project.color || '#4ade80' }}
        >
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-6xl`} />
          </div>

          <div className="flex items-center gap-3 mb-4 relative z-10">
            {project.avatarUrl ? (
              <img src={project.avatarUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-ive-border shrink-0" style={{ borderColor: `${project.color || '#4ade80'}40` }} />
            ) : (
              <div
                className="w-12 h-12 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0"
                style={{ borderColor: `${project.color || '#4ade80'}40` }}
              >
                <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-3xl`} style={{ color: project.color || '#4ade80' }} />
              </div>
            )}
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
                <div className={`text-xl font-bold leading-none ${assignedAgents.length > 0 ? 'text-ive-green-light' : 'text-ive-text-dim'}`}>{assignedAgents.length}</div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">{tp('developers')}</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold leading-none ${(project.lastScannedIssueCount ?? 0) > 0 ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>
                  {project.lastScannedIssueCount ?? 0}
                </div>
                <div className="text-sm text-ive-text-muted mt-1 uppercase tracking-wider font-bold">{ts('waiting')}</div>
              </div>
            </div>
            {canEdit ? (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowEditProject(true)}
                  className="text-base font-bold text-ive-text-muted border border-ive-border px-3 py-2 rounded-lg hover:border-ive-green/30 hover:text-ive-green transition-all bg-ive-bg/50"
                >
                  <i className="fa-solid fa-pen-to-square mr-1" />{tc('edit')}
                </button>
                {isOwner && (
                  <button
                    onClick={() => setShowDeleteProject(true)}
                    className="text-base font-bold text-ive-red/60 border border-ive-red/20 px-3 py-2 rounded-lg hover:bg-ive-red/10 transition-all"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                )}
              </div>
            ) : (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full leading-none bg-ive-cyan/15 text-ive-cyan border border-ive-cyan/30`}>
                <i className="fa-solid fa-share-nodes mr-1" />
                {tp('viewerPermission')}
              </span>
            )}
          </div>
        </div>

        {/* 배정된 개발자 섹션 */}
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="text-base font-bold text-ive-text uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ive-green" />
            {tp('assignedAgents', { count: assignedAgents.length })}
          </h2>
          {canEdit && (
            <button
              onClick={() => { setShowAssignAgent(true); setAssignError(''); setAssignToken('') }}
              className="text-base font-bold text-ive-green bg-ive-green/10 px-4 py-2 rounded-lg active:scale-95 transition-all hover:bg-ive-green/15"
            >
              <i className="fa-solid fa-plus mr-1.5" />{tp('assignAgent')}
            </button>
          )}
        </div>

        {assignedAgents.length === 0 ? (
          <div className="text-center py-16 bg-ive-bg-card rounded-2xl border border-dashed border-ive-border-subtle">
            <i className="fa-solid fa-robot text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted font-bold">{tp('noAssignedAgents')}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {assignedAgents.map(pa => (
              <div key={pa.id} className="bg-ive-bg-card rounded-lg border border-ive-border-subtle overflow-hidden">
                <div className="flex items-center gap-2 p-1">
                  <div className="flex-1 min-w-0">
                    <AgentCard agent={pa.agent} compact onRemove={canEdit ? () => handleUnassignAgent(pa.agentId) : undefined} />
                  </div>
                </div>
                {/* 하단 액션 바 — 소유자 및 editor 토큰 편집 가능 */}
                {canEdit && (
                  <div className="flex items-center gap-1 px-3 pb-2.5 pt-0">
                    {editingTokenAgentId === pa.agentId ? (
                      <div className="flex-1 flex items-center gap-1.5">
                        <input
                          type="text"
                          autoComplete="off"
                          data-1p-ignore
                          value={editTokenValue}
                          onChange={e => setEditTokenValue(e.target.value)}
                          placeholder="Personal Access Token"
                          className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded px-2 py-1 text-xs text-ive-text font-mono focus:outline-none focus:border-ive-green"
                          style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                          autoFocus
                        />
                        <button onClick={() => handleSaveToken(pa.agentId)} className="text-xs font-bold text-ive-green px-2 py-1 rounded hover:bg-ive-green/10">
                          <i className="fa-solid fa-check" />
                        </button>
                        <button onClick={() => setEditingTokenAgentId(null)} className="text-xs font-bold text-ive-text-dim px-2 py-1 rounded hover:bg-ive-bg-deep">
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingTokenAgentId(pa.agentId); setEditTokenValue('') }}
                        className={`text-xs font-bold px-2 py-1 rounded transition-colors ${
                          pa.accessToken
                            ? 'text-ive-cyan bg-ive-cyan/10 hover:bg-ive-cyan/20'
                            : 'text-ive-text-dim hover:bg-ive-bg-deep hover:text-ive-text-muted'
                        }`}
                        title={pa.accessToken ? tp('individualTokenInUse') : tp('projectTokenInUse')}
                      >
                        <i className={`fa-solid fa-key mr-1 ${pa.accessToken ? '' : 'opacity-40'}`} />
                        {pa.accessToken ? tp('individualTokenLabel') : tp('projectTokenLabel')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {assignError && (
          <div className="mt-3 text-base text-ive-red bg-ive-red/10 rounded-lg px-4 py-3 border border-ive-red/20 animate-shake">
            <i className="fa-solid fa-circle-exclamation mr-1.5" />{assignError}
          </div>
        )}

        {/* Git 프로젝트 멤버 섹션 */}
        <div className="flex items-center justify-between mt-6 mb-3 px-1">
          <h2 className="text-base font-bold text-ive-text uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ive-cyan" />
            {tp('gitMembers', { count: gitMembers.length })}
          </h2>
          <button
            onClick={fetchGitMembers}
            disabled={gitMembersLoading}
            className="text-xs font-bold text-ive-text-dim hover:text-ive-green px-2 py-1 rounded-lg hover:bg-white/5 transition-all disabled:opacity-40"
          >
            <i className={`fa-solid fa-arrows-rotate ${gitMembersLoading ? 'fa-spin' : ''}`} />
          </button>
        </div>
        {gitMembers.length === 0 ? (
          <div className="text-center py-8 bg-ive-bg-card rounded-lg border border-dashed border-ive-border-subtle">
            <i className="fa-solid fa-users text-2xl text-ive-text-dim mb-2 block" />
            <p className="text-sm text-ive-text-muted">{gitMembersLoading ? tc('loading') : tp('noGitMembers')}</p>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {gitMembers.map(m => (
              <div key={m.id} className="flex items-center gap-3 bg-ive-bg-card rounded-lg border border-ive-border-subtle px-3 py-2.5">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} className="w-8 h-8 rounded-lg object-cover bg-ive-bg-deep border border-ive-border shrink-0" alt="" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-user text-ive-text-dim" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-ive-text truncate">{m.name || m.username}</div>
                  {m.name && m.name !== m.username && (
                    <div className="text-xs text-ive-text-dim truncate">@{m.username}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 모달들 */}
      <Modal
        open={showEditProject}
        onClose={() => setShowEditProject(false)}
        title={tp('projectSettings')}
        closeOnBackdrop={false}
      >
        <ProjectForm
          existing={project}
          onSuccess={() => setShowEditProject(false)}
          onCancel={() => setShowEditProject(false)}
        />
      </Modal>

      <Modal open={showAssignAgent} onClose={() => setShowAssignAgent(false)} title={tp('assignAgent')}>
        <div className="space-y-3">
          {availableAgents.length === 0 ? (
            <div className="text-center py-8 text-ive-text-muted">
              <i className="fa-solid fa-robot text-3xl text-ive-text-dim mb-3 block" />
              <p className="text-base font-bold">{tp('noAvailableAgents')}</p>
              <p className="text-sm font-bold text-ive-text-dim mt-1">{tp('noAvailableAgentsHint')}</p>
              <button
                type="button"
                onClick={() => { setShowAssignAgent(false); setShowNewAgent(true) }}
                className="mt-4 inline-flex items-center gap-2 bg-ive-green-dark text-white font-bold text-sm px-4 py-3 rounded-lg active:opacity-90 transition-all"
              >
                <i className="fa-solid fa-plus" />
                {ta('addAgent')}
              </button>
            </div>
          ) : (
            <>
              {/* 개별 토큰 입력 (선택사항) */}
              <div className="bg-ive-bg rounded-lg p-3 border border-ive-border-subtle">
                <label className="block text-xs font-bold text-ive-text-muted mb-1.5">
                  <i className="fa-solid fa-key mr-1 text-ive-cyan" />{tp('individualToken')}
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  data-1p-ignore
                  value={assignToken}
                  onChange={e => setAssignToken(e.target.value)}
                  placeholder={tp('individualTokenPlaceholder')}
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono placeholder:text-ive-text-dim focus:outline-none focus:border-ive-cyan"
                  style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                />
                <p className="text-xs text-ive-text-dim mt-1">{tp('individualTokenHint')}</p>
              </div>

              {availableAgents.map(agent => (
                <div key={agent.id} className="flex items-center gap-3 bg-ive-bg rounded-lg p-3 border border-ive-border-subtle">
                  <div className="flex-1 min-w-0">
                    <AgentCard agent={agent} compact />
                  </div>
                  <button
                    onClick={() => handleAssignAgent(agent.id)}
                    className="shrink-0 text-base font-bold text-ive-green bg-ive-green/10 px-3 py-1.5 rounded-lg hover:bg-ive-green/20 transition-colors"
                  >
                    <i className="fa-solid fa-plus mr-1" />{tp('assign')}
                  </button>
                </div>
              ))}
            </>
          )}
          {assignError && (
            <div className="text-sm font-bold text-ive-red bg-ive-red/10 rounded-lg px-4 py-3 border border-ive-red/20">
              <i className="fa-solid fa-circle-exclamation mr-1.5" />{assignError}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={showNewAgent}
        onClose={() => setShowNewAgent(false)}
        title={ta('addAgent')}
        closeOnBackdrop={false}
      >
        <AgentForm
          onSuccess={() => {
            setShowNewAgent(false)
            setShowAssignAgent(true)
          }}
          onCancel={() => setShowNewAgent(false)}
        />
      </Modal>

      <ConfirmModal
        open={showDeleteProject}
        onClose={() => setShowDeleteProject(false)}
        onConfirm={handleDeleteProject}
        title={tp('deleteProject')}
        message={tp('deleteProjectConfirm')}
        confirmLabel={tp('permanentDelete')}
        danger
      />

      <MobileTabBar />
    </div>
  )
}
