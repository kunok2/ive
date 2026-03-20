'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import ProjectsTab from '@/components/tabs/ProjectsTab'
import IssuesTab from '@/components/tabs/IssuesTab'
import AgentsTab from '@/components/tabs/AgentsTab'
import AdminTab from '@/components/tabs/AdminTab'
import ReportsTab from '@/components/tabs/ReportsTab'
import MobileTabBar from '@/components/layout/MobileTabBar'
import ProjectForm from '@/components/project/ProjectForm'
import AgentForm from '@/components/agent/AgentForm'
import Modal from '@/components/ui/Modal'
import { useDialog } from '@/components/ui/ConfirmDialog'
import UserProfileForm from '@/components/auth/UserProfileForm'
import { DEFAULT_AVATARS } from '@/types'

const subtitle: Record<string, string> = {
  projects: '프로젝트',
  agents: '개발자',
  issues: '작업',
  reports: '보고서',
  admin: '관리',
}

export default function HomePage() {
  const router = useRouter()
  const { state, logout, refreshUser } = useStore()
  const { activeTab, issuesProjectId } = useTab()
  const { alert: showAlert, confirm: showConfirm } = useDialog()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [issueAddTrigger, setIssueAddTrigger] = useState(0)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [avatarTs, setAvatarTs] = useState(() => Date.now())

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
            {/* 탭별 추가 버튼 */}
            {activeTab === 'projects' && (
              <button
                onClick={() => setShowNewProject(true)}
                className="w-8 h-8 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep hover:brightness-110 active:scale-95 transition-all"
              >
                <i className="fa-solid fa-plus text-sm" />
              </button>
            )}

            {activeTab === 'agents' && (
              <button
                onClick={async () => {
                  const maxAgents = state.user?.maxAgents || 0
                  if (maxAgents > 0 && state.agents.length >= maxAgents) {
                    await showAlert({ title: '제한 초과', message: `최대 ${maxAgents}개의 개발자만 생성할 수 있습니다.\n관리자에게 문의하세요.`, variant: 'error' })
                    return
                  }
                  setShowNewAgent(true)
                }}
                className="w-8 h-8 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep hover:brightness-110 active:scale-95 transition-all"
              >
                <i className="fa-solid fa-plus text-sm" />
              </button>
            )}

            {activeTab === 'issues' && issuesProjectId && (() => {
              const proj = state.projects.find(p => p.id === issuesProjectId)
              const canEdit = proj ? !proj.shareRole || proj.shareRole === 'editor' : false
              return canEdit ? (
                <button
                  onClick={() => setIssueAddTrigger(t => t + 1)}
                  className="w-8 h-8 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep hover:brightness-110 active:scale-95 transition-all"
                >
                  <i className="fa-solid fa-plus text-sm" />
                </button>
              ) : null
            })()}

            {/* 구분자 - 탭별 버튼이 있을 때만 표시 */}
            {(activeTab === 'projects' || activeTab === 'agents' || (activeTab === 'issues' && issuesProjectId && (() => {
              const proj = state.projects.find(p => p.id === issuesProjectId)
              return proj ? !proj.shareRole || proj.shareRole === 'editor' : false
            })())) && (
              <span className="text-ive-border-subtle mx-0.5">|</span>
            )}

            {/* 아바타 + 이름 + 로그아웃 */}
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden transition-all hover:scale-110 active:scale-95"
              style={state.user!.avatar !== 'photo' ? { backgroundColor: (() => { const av = DEFAULT_AVATARS.find(a => a.id === state.user!.avatar); return av ? `${av.color}20` : '#4ade8020' })() } : undefined}
              title={state.user!.name}
            >
              {state.user!.avatar === 'photo' ? (
                <img src={`/api/auth/avatar/image?id=${state.user!.id}&t=${avatarTs}`} alt="" className="w-full h-full object-cover" />
              ) : (() => {
                const av = DEFAULT_AVATARS.find(a => a.id === state.user!.avatar)
                return av ? <i className={`${av.icon} text-sm`} style={{ color: av.color }} /> : <i className="fa-solid fa-user text-sm text-ive-green" />
              })()}
            </button>
            <button
              onClick={async () => {
                const ok = await showConfirm({ title: '로그아웃', message: '로그아웃 하시겠습니까?', confirmText: '로그아웃', cancelText: '취소', variant: 'warning' })
                if (ok) { await logout(); router.push('/login') }
              }}
              className="w-8 h-8 rounded-full bg-ive-bg-card border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text active:scale-95 transition-all"
              aria-label="로그아웃"
            >
              <i className="fa-solid fa-right-from-bracket text-sm" />
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: activeTab === 'projects' ? 'block' : 'none' }}>
        <ProjectsTab onAdd={() => setShowNewProject(true)} />
      </div>
      <div style={{ display: activeTab === 'agents' ? 'block' : 'none' }}>
        <AgentsTab onAdd={() => setShowNewAgent(true)} />
      </div>
      <div style={{ display: activeTab === 'issues' ? 'block' : 'none' }}>
        <IssuesTab addTrigger={issueAddTrigger} />
      </div>
      <div style={{ display: activeTab === 'reports' ? 'block' : 'none' }}>
        <ReportsTab />
      </div>
      {state.user.isAdmin && (
        <div style={{ display: activeTab === 'admin' ? 'block' : 'none' }}>
          <AdminTab />
        </div>
      )}
      <MobileTabBar />

      <Modal open={showNewProject} onClose={() => setShowNewProject(false)} title="새 프로젝트">
        <ProjectForm onSuccess={() => setShowNewProject(false)} />
      </Modal>
      <Modal open={showNewAgent} onClose={() => setShowNewAgent(false)} title="개발자 추가">
        <AgentForm onSuccess={() => setShowNewAgent(false)} />
      </Modal>
      <Modal open={showChangePassword} onClose={() => setShowChangePassword(false)} title="내 정보">
        <UserProfileForm userId={state.user.id} email={state.user.email} name={state.user.name} avatar={state.user.avatar} onSuccess={() => setShowChangePassword(false)} onCancel={() => setShowChangePassword(false)} onEmailChanged={() => refreshUser()} onAvatarChanged={() => { setAvatarTs(Date.now()); refreshUser() }} />
      </Modal>
    </>
  )
}
