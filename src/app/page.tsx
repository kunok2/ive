'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import ProjectsTab from '@/components/tabs/ProjectsTab'
import IssuesTab from '@/components/tabs/IssuesTab'
import AgentsTab from '@/components/tabs/AgentsTab'
import TerminalTab from '@/components/tabs/TerminalTab'
import MobileTabBar from '@/components/layout/MobileTabBar'
import ProjectForm from '@/components/project/ProjectForm'
import AgentForm from '@/components/agent/AgentForm'
import Modal from '@/components/ui/Modal'

const subtitle: Record<string, string> = {
  projects: '프로젝트',
  agents: '개발자',
  issues: '작업',
  terminal: 'CLI',
}

export default function HomePage() {
  const router = useRouter()
  const { state, logout } = useStore()
  const { activeTab } = useTab()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [editMode, setEditMode] = useState(false)

  useEffect(() => {
    if (state.authChecked && !state.user) {
      router.push('/login')
    }
  }, [state.authChecked, state.user, router])

  if (!state.authChecked || !state.user) {
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted text-base">불러오는 중...</div>
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="px-4 py-3 max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-extrabold leading-none">
                <span className="text-ive-green">Spring</span>{' '}
                <span className="text-orange-400">IVE</span>

              </h1>
              <p className="text-xs text-ive-text-dim mt-0.5">{subtitle[activeTab]}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-ive-text-muted mr-1">{state.user.name}</span>

            {activeTab === 'projects' && (
              <>
                <button
                  onClick={() => setShowNewProject(true)}
                  className="w-8 h-8 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep active:scale-95 transition-transform"
                >
                  <i className="fa-solid fa-plus text-sm" />
                </button>
                {state.projects.length > 1 && (
                  <button
                    onClick={() => setEditMode(v => !v)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center active:scale-95 transition-all ${
                      editMode ? 'bg-ive-amber text-ive-bg-deep' : 'bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim hover:text-ive-text'
                    }`}
                  >
                    <i className={`fa-solid ${editMode ? 'fa-check' : 'fa-sort'} text-sm`} />
                  </button>
                )}
              </>
            )}

            {activeTab === 'agents' && (
              <button
                onClick={() => setShowNewAgent(true)}
                className="w-8 h-8 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-plus text-sm" />
              </button>
            )}

            <button
              onClick={async () => { await logout(); router.push('/login') }}
              className="w-8 h-8 rounded-full bg-ive-bg-card border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text active:scale-95 transition-all"
            >
              <i className="fa-solid fa-right-from-bracket text-sm" />
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: activeTab === 'projects' ? 'block' : 'none' }}>
        <ProjectsTab editMode={editMode} />
      </div>
      <div style={{ display: activeTab === 'agents' ? 'block' : 'none' }}>
        <AgentsTab />
      </div>
      <div style={{ display: activeTab === 'issues' ? 'block' : 'none' }}>
        <IssuesTab />
      </div>
      <div style={{ display: activeTab === 'terminal' ? 'block' : 'none' }}>
        <TerminalTab />
      </div>
      <MobileTabBar />

      <Modal open={showNewProject} onClose={() => setShowNewProject(false)} title="새 프로젝트">
        <ProjectForm onSuccess={() => setShowNewProject(false)} />
      </Modal>
      <Modal open={showNewAgent} onClose={() => setShowNewAgent(false)} title="개발자 추가">
        <AgentForm onSuccess={() => setShowNewAgent(false)} />
      </Modal>
    </>
  )
}
