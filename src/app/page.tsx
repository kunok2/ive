'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import ProjectCard from '@/components/project/ProjectCard'
import ProjectForm from '@/components/project/ProjectForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'

export default function HomePage() {
  const router = useRouter()
  const { state, logout } = useStore()
  const [showNewProject, setShowNewProject] = useState(false)

  useEffect(() => {
    if (state.authChecked && !state.user) {
      router.push('/login')
    }
  }, [state.authChecked, state.user, router])

  if (!state.authChecked || !state.user) {
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted text-base">불러오는 중...</div>
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center justify-between px-4 py-3 max-w-lg mx-auto">
          <div>
            <h1 className="text-xl font-extrabold text-ive-green">Spring IVE</h1>
            <div className="flex items-center gap-2">
              <p className="text-sm text-ive-text-muted">{state.user.name}</p>
              <button
                onClick={async () => { await logout(); router.push('/login') }}
                className="text-sm text-ive-text-dim underline"
              >
                로그아웃
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowNewProject(true)}
            className="w-9 h-9 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep active:scale-95 transition-transform"
          >
            <i className="fa-solid fa-plus text-base" />
          </button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.loading ? (
          <div className="text-center py-20 text-ive-text-muted text-base">불러오는 중...</div>
        ) : state.projects.length === 0 ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-4">아직 프로젝트가 없습니다</p>
            <button
              onClick={() => setShowNewProject(true)}
              className="inline-block bg-ive-green-dark text-white font-bold px-6 py-2.5 rounded-lg text-base"
            >
              <i className="fa-solid fa-plus mr-1.5" />첫 프로젝트 만들기
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state.projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                roles={project.roles}
              />
            ))}
          </div>
        )}
      </main>

      <Modal open={showNewProject} onClose={() => setShowNewProject(false)} title="새 프로젝트">
        <ProjectForm onSuccess={() => setShowNewProject(false)} />
      </Modal>

      <MobileTabBar />
    </div>
  )
}
