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
  const [activeTab, setActiveTab] = useState<TabKey>('projects')
  const [issuesProjectId, setIssuesProjectId] = useState<string | null>(null)
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
