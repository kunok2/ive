'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import SlotCard from '@/components/slot/SlotCard'
import SlotForm from '@/components/slot/SlotForm'
import ProjectForm from '@/components/project/ProjectForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state, deleteProject, deleteSlot } = useStore()
  const [showNewSlot, setShowNewSlot] = useState(false)
  const [showEditProject, setShowEditProject] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)
  const [deleteSlotId, setDeleteSlotId] = useState<string | null>(null)

  const project = state.projects.find(p => p.id === id)

  if (state.loading) {
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted text-sm">불러오는 중...</div>
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-ive-text-muted mb-4">프로젝트를 찾을 수 없습니다</p>
          <Link href="/" className="text-ive-green text-sm font-semibold">
            <i className="fa-solid fa-arrow-left mr-1" />홈으로
          </Link>
        </div>
      </div>
    )
  }

  const slots = project.slots

  async function handleDeleteProject() {
    await deleteProject(id)
    router.push('/')
  }

  async function handleDeleteSlot(slotId: string) {
    await deleteSlot(id, slotId)
    setDeleteSlotId(null)
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <Link href="/" className="text-ive-green text-sm font-semibold">
            <i className="fa-solid fa-arrow-left mr-1" />뒤로
          </Link>
          <h1 className="text-base font-bold text-ive-green-pale flex-1 truncate">{project.name}</h1>
        </div>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto">
        <div className="bg-ive-bg-card rounded-xl p-4 border-l-[3px] border-ive-green mb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-ive-bg flex items-center justify-center shrink-0">
              <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-lg text-ive-text-secondary`} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-ive-green-pale truncate">{project.name}</div>
              <div className="text-[10px] text-ive-text-muted truncate">{project.repoUrl}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-ive-border-dark">
            <div className="text-center">
              <div className="text-lg font-extrabold text-ive-green">{slots.length}</div>
              <div className="text-[9px] text-ive-text-muted">슬롯</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-extrabold text-ive-amber">
                {slots.filter(s => s.status === 'active').length}
              </div>
              <div className="text-[9px] text-ive-text-muted">활성</div>
            </div>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => setShowEditProject(true)}
                className="text-[11px] text-ive-text-muted border border-ive-border px-3 py-1.5 rounded-lg active:bg-ive-bg-deep transition-colors"
              >
                <i className="fa-solid fa-pen-to-square mr-1" />수정
              </button>
              <button
                onClick={() => setShowDeleteProject(true)}
                className="text-[11px] text-ive-red/60 border border-ive-red/20 px-3 py-1.5 rounded-lg active:bg-ive-red/10 transition-colors"
              >
                <i className="fa-solid fa-trash-can mr-1" />삭제
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-ive-text">슬롯 ({slots.length})</h2>
          <button
            onClick={() => setShowNewSlot(true)}
            className="text-xs font-bold text-ive-green bg-ive-green/10 px-3 py-1.5 rounded-lg active:bg-ive-green/20 transition-colors"
          >
            <i className="fa-solid fa-plus mr-1" />슬롯 추가
          </button>
        </div>

        {slots.length === 0 ? (
          <div className="text-center py-12 bg-ive-bg-card rounded-xl border border-ive-border-subtle">
            <i className="fa-solid fa-layer-group text-3xl text-ive-text-dim mb-3 block" />
            <p className="text-xs text-ive-text-muted mb-3">슬롯이 없습니다</p>
            <button
              onClick={() => setShowNewSlot(true)}
              className="inline-block bg-ive-green-dark text-white font-bold px-5 py-2 rounded-lg text-xs"
            >
              <i className="fa-solid fa-plus mr-1" />첫 슬롯 만들기
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {slots.map(slot => (
              <SlotCard key={slot.id} slot={slot} onDelete={(slotId) => setDeleteSlotId(slotId)} />
            ))}
          </div>
        )}
      </main>

      <Modal open={showNewSlot} onClose={() => setShowNewSlot(false)} title="슬롯 추가">
        <SlotForm projectId={id} onSuccess={() => setShowNewSlot(false)} />
      </Modal>

      <Modal open={showEditProject} onClose={() => setShowEditProject(false)} title="프로젝트 수정">
        <ProjectForm existing={project} onSuccess={() => setShowEditProject(false)} />
      </Modal>

      <ConfirmModal
        open={showDeleteProject}
        onClose={() => setShowDeleteProject(false)}
        onConfirm={handleDeleteProject}
        title="프로젝트 삭제"
        message="모든 슬롯도 함께 삭제됩니다. 정말 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
      />

      <ConfirmModal
        open={deleteSlotId !== null}
        onClose={() => setDeleteSlotId(null)}
        onConfirm={() => deleteSlotId && handleDeleteSlot(deleteSlotId)}
        title="슬롯 삭제"
        message="이 슬롯을 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
      />

      <MobileTabBar />
    </div>
  )
}
