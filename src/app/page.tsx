'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import ProjectsTab from '@/components/tabs/ProjectsTab'
import IssuesTab from '@/components/tabs/IssuesTab'
import AgentsTab from '@/components/tabs/AgentsTab'
import TerminalTab from '@/components/tabs/TerminalTab'
import MobileTabBar from '@/components/layout/MobileTabBar'

export default function HomePage() {
  const router = useRouter()
  const { state } = useStore()
  const { activeTab } = useTab()

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
      <div style={{ display: activeTab === 'projects' ? 'block' : 'none' }}>
        <ProjectsTab />
      </div>
      <div style={{ display: activeTab === 'issues' ? 'block' : 'none' }}>
        <IssuesTab />
      </div>
      <div style={{ display: activeTab === 'agents' ? 'block' : 'none' }}>
        <AgentsTab />
      </div>
      <div style={{ display: activeTab === 'terminal' ? 'block' : 'none' }}>
        <TerminalTab />
      </div>
      <MobileTabBar />
    </>
  )
}
