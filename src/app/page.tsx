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
import { useTranslations } from 'next-intl'

export default function HomePage() {
  const router = useRouter()
  const { state } = useStore()
  const { activeTab, issueAddTrigger: contextAddTrigger } = useTab()
  const tc = useTranslations('common')
  const [issueAddTrigger, setIssueAddTrigger] = useState(0)

  useEffect(() => {
    if (state.authChecked && !state.user) {
      router.push('/login')
    }
  }, [state.authChecked, state.user, router])

  useEffect(() => {
    const handleIssueAdd = () => {
      setIssueAddTrigger(t => t + 1)
    }
    window.addEventListener('issue-add-trigger', handleIssueAdd)
    return () => window.removeEventListener('issue-add-trigger', handleIssueAdd)
  }, [])

  if (!state.authChecked || !state.user) {
    return <div className="h-full flex items-center justify-center text-ive-text-muted text-base">{tc('loading')}</div>
  }

  return (
    <div className="h-full relative">
      <div className="absolute inset-0 overflow-hidden" style={{ display: activeTab === 'projects' ? 'flex' : 'none' }}>
        <ProjectsTab onAdd={() => {}} />
      </div>
      <div className="absolute inset-0 overflow-hidden" style={{ display: activeTab === 'agents' ? 'flex' : 'none' }}>
        <AgentsTab onAdd={() => {}} />
      </div>
      <div className="absolute inset-0 overflow-hidden" style={{ display: activeTab === 'issues' ? 'flex' : 'none' }}>
        <IssuesTab addTrigger={issueAddTrigger + contextAddTrigger} />
      </div>
      <div className="absolute inset-0 overflow-hidden" style={{ display: activeTab === 'reports' ? 'flex' : 'none' }}>
        <ReportsTab />
      </div>
      {state.user.isAdmin && (
        <div className="absolute inset-0 overflow-hidden" style={{ display: activeTab === 'admin' ? 'flex' : 'none' }}>
          <AdminTab />
        </div>
      )}
      <MobileTabBar />
    </div>
  )
}
