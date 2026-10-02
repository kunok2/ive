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

/** 메일 링크 매개변수 — 메인 화면(/)에서만 쓰고 지운다(다른 화면의 ?tab= 은 건드리지 않는다) */
const LINK_PARAMS = ['tab', 'mine', 'rtype', 'rdate']
const isMainPage = () => typeof window !== 'undefined' && window.location.pathname === '/'

/**
 * 메일 등 바깥에서 여는 링크: ?tab=reports&rtype=weekly&rdate=YYYY-MM-DD(그 기간 보고서), ?tab=reports&mine=1(내 손에 있는 일)
 * 탭은 바로 정하고, 보고서 기간·"내 손에 있는 일" 강조는 보고서 탭이 처음 그릴 때 읽도록 sessionStorage 에 넘긴다(한 번만).
 */
function linkedTab(): TabKey | null {
  if (!isMainPage()) return null
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('tab')
  if (!tab || !['projects', 'issues', 'agents', 'reports', 'admin'].includes(tab)) return null
  try {
    const rtype = q.get('rtype'), rdate = q.get('rdate'), mine = q.get('mine') === '1'
    const typeOk = !!rtype && /^(weekly|monthly|yearly)$/.test(rtype)
    if (tab === 'reports' && (typeOk || mine)) {
      sessionStorage.setItem('ive-report-link', JSON.stringify({
        type: typeOk ? rtype : 'weekly', date: !mine && rdate && /^\d{4}-\d{2}-\d{2}$/.test(rdate) ? rdate : null, mine,
      }))
    }
  } catch { /* 저장소를 못 쓰면 탭만 연다 */ }
  return tab as TabKey
}

export function TabProvider({ children }: { children: ReactNode }) {
  const { state: { user } } = useStore()
  const userIdRef = useRef<string | null>(null)

  const [activeTab, setActiveTabState] = useState<TabKey>(() => {
    const linked = linkedTab()
    if (linked) { try { localStorage.setItem('ive-active-tab', linked) } catch { /* 무시 */ } return linked }
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-active-tab')
      if (saved && ['projects', 'issues', 'agents', 'reports', 'admin'].includes(saved)) return saved as TabKey
    }
    return 'projects'
  })
  // 링크 매개변수는 한 번 쓰고 주소창에서 지운다(새로고침해도 다시 적용되지 않게)
  useEffect(() => {
    if (!isMainPage()) return
    const u = new URL(window.location.href)
    if (LINK_PARAMS.some(k => u.searchParams.has(k))) {
      LINK_PARAMS.forEach(k => u.searchParams.delete(k))
      window.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash)
    }
  }, [])
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
      // 관리자가 아닌데 admin 탭이 선택되어 있으면 projects로 전환
      if (!user.isAdmin && activeTab === 'admin') {
        setActiveTab('projects')
      }
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
