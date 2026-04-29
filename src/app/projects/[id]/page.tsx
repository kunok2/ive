'use client'

import { use, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import ProjectForm from '@/components/project/ProjectForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { useTranslations } from 'next-intl'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state, deleteProject } = useStore()

  const [showEditProject, setShowEditProject] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)
  const tc = useTranslations('common')
  const tp = useTranslations('project')

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

  async function handleDeleteProject() {
    await deleteProject(id)
    router.push('/')
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <Link href="/" className="text-ive-green text-base font-bold p-1 hover:bg-ive-green/5 rounded">
            <i className="fa-solid fa-arrow-left mr-1" />{tc('back')}
          </Link>
          <h1 className="text-lg font-bold text-ive-green-pale flex-1 truncate">{project.name}</h1>
        </div>
      </header>

      <main className="px-4 pt-4 pb-20 max-w-lg mx-auto">
        {/* 프로젝트 정보 헤더 */}
        <div
          className="bg-ive-bg-card rounded-lg p-5 border border-ive-border-subtle mb-6 relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-6xl`} />
          </div>

          <div className="flex items-center gap-3 mb-4 relative z-10">
            {project.avatarUrl ? (
              <img src={project.avatarUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-ive-border shrink-0" />
            ) : (
              <div
                className="w-12 h-12 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0"
              >
                <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-3xl text-ive-green`} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold truncate leading-tight">{project.name}</div>
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

          <div className="flex items-center justify-end mt-4 pt-4 border-t border-ive-border-dark relative z-10 gap-2">
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
