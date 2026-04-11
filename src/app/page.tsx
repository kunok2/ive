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
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted text-base">{tc('loading')}</div>
  }

  return (
    <>
      <div style={{ display: activeTab === 'projects' ? 'block' : 'none' }}>
        <ProjectsTab onAdd={() => {}} />
      </div>
      <div style={{ display: activeTab === 'agents' ? 'block' : 'none' }}>
        <AgentsTab onAdd={() => {}} />
      </div>
      <div style={{ display: activeTab === 'issues' ? 'block' : 'none' }}>
        <IssuesTab addTrigger={issueAddTrigger + contextAddTrigger} />
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
    </>
  )
}
