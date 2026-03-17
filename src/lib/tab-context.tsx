'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

export type TabKey = 'projects' | 'issues' | 'agents' | 'terminal'

const TabContext = createContext<{
  activeTab: TabKey
  setActiveTab: (tab: TabKey) => void
  issuesProjectId: string | null
  setIssuesProjectId: (id: string) => void
  issuesFilter: string
  setIssuesFilter: (filter: string) => void
  navigateToIssues: (projectId: string) => void
}>({
  activeTab: 'projects',
  setActiveTab: () => {},
  issuesProjectId: null,
  setIssuesProjectId: () => {},
  issuesFilter: 'all',
  setIssuesFilter: () => {},
  navigateToIssues: () => {},
})

export function TabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTabState] = useState<TabKey>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-active-tab')
      if (saved && ['projects', 'issues', 'agents', 'terminal'].includes(saved)) return saved as TabKey
    }
    return 'projects'
  })
  const setActiveTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab)
    localStorage.setItem('ive-active-tab', tab)
  }, [])
  const [issuesProjectId, setIssuesProjectIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ive-issues-project') || null
    }
    return null
  })
  const setIssuesProjectId = useCallback((id: string) => {
    setIssuesProjectIdState(id)
    localStorage.setItem('ive-issues-project', id)
  }, [])
  const [issuesFilter, setIssuesFilter] = useState('all')

  const navigateToIssues = useCallback((projectId: string) => {
    setIssuesProjectId(projectId)
    setActiveTab('issues')
  }, [])

  return (
    <TabContext.Provider value={{
      activeTab, setActiveTab,
      issuesProjectId, setIssuesProjectId,
      issuesFilter, setIssuesFilter,
      navigateToIssues,
    }}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab() {
  return useContext(TabContext)
}
