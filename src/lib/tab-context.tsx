'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { useStore } from '@/lib/store'

export type TabKey = 'projects' | 'issues' | 'agents' | 'reports' | 'admin'

const TabContext = createContext<{
  activeTab: TabKey
  setActiveTab: (tab: TabKey) => void
  issuesProjectId: string | null
  setIssuesProjectId: (id: string) => void
  issuesFilter: string
  setIssuesFilter: (filter: string) => void
  issuesSort: string
  setIssuesSort: (sort: string) => void
  navigateToIssues: (projectId: string) => void
  issueAddTrigger: number
  navigateToAddIssue: (projectId: string) => void
}>({
  activeTab: 'projects',
  setActiveTab: () => {},
  issuesProjectId: null,
  setIssuesProjectId: () => {},
  issuesFilter: 'all',
  setIssuesFilter: () => {},
  issuesSort: 'newest',
  setIssuesSort: () => {},
  navigateToIssues: () => {},
  issueAddTrigger: 0,
  navigateToAddIssue: () => {},
})

export function TabProvider({ children }: { children: ReactNode }) {
  const { state: { user } } = useStore()
  const userIdRef = useRef<string | null>(null)

  const [activeTab, setActiveTabState] = useState<TabKey>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-active-tab')
      if (saved && ['projects', 'issues', 'agents', 'reports', 'admin'].includes(saved)) return saved as TabKey
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

  const [issuesFilter, setIssuesFilterState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ive-issues-filter') || 'all'
    }
    return 'all'
  })

  const [issuesSort, setIssuesSortState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ive-issues-sort') || 'newest'
    }
    return 'newest'
  })

  // 사용자 변경 시 해당 사용자의 마지막 선택값 복원 (프로젝트, 필터, 정렬)
  useEffect(() => {
    if (user && user.id !== userIdRef.current) {
      userIdRef.current = user.id
      const savedProject = localStorage.getItem(`ive-issues-project-${user.id}`)
      if (savedProject) {
        setIssuesProjectIdState(savedProject)
      }
      const savedFilter = localStorage.getItem(`ive-issues-filter-${user.id}`)
      if (savedFilter) {
        setIssuesFilterState(savedFilter)
      }
      const savedSort = localStorage.getItem(`ive-issues-sort-${user.id}`)
      if (savedSort) {
        setIssuesSortState(savedSort)
      }
    } else if (!user) {
      userIdRef.current = null
    }
  }, [user])

  const setIssuesProjectId = useCallback((id: string) => {
    setIssuesProjectIdState(id)
    localStorage.setItem('ive-issues-project', id)
    if (userIdRef.current) {
      localStorage.setItem(`ive-issues-project-${userIdRef.current}`, id)
    }
  }, [])

  const setIssuesFilter = useCallback((filter: string) => {
    setIssuesFilterState(filter)
    localStorage.setItem('ive-issues-filter', filter)
    if (userIdRef.current) {
      localStorage.setItem(`ive-issues-filter-${userIdRef.current}`, filter)
    }
  }, [])

  const setIssuesSort = useCallback((sort: string) => {
    setIssuesSortState(sort)
    localStorage.setItem('ive-issues-sort', sort)
    if (userIdRef.current) {
      localStorage.setItem(`ive-issues-sort-${userIdRef.current}`, sort)
    }
  }, [])

  const navigateToIssues = useCallback((projectId: string) => {
    setIssuesProjectId(projectId)
    setActiveTab('issues')
  }, [setIssuesProjectId, setActiveTab])

  const [issueAddTrigger, setIssueAddTrigger] = useState(0)

  const navigateToAddIssue = useCallback((projectId: string) => {
    setIssuesProjectId(projectId)
    setActiveTab('issues')
    setIssueAddTrigger(t => t + 1)
  }, [setIssuesProjectId, setActiveTab])

  return (
    <TabContext.Provider value={{
      activeTab, setActiveTab,
      issuesProjectId, setIssuesProjectId,
      issuesFilter, setIssuesFilter,
      issuesSort, setIssuesSort,
      navigateToIssues,
      issueAddTrigger, navigateToAddIssue,
    }}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab() {
  return useContext(TabContext)
}
