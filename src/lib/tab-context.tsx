'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
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
  /** PC 폭 작업 탭의 오른쪽 칸에 열린 이슈 */
  issuesOpened: { projectId: string; iid: number } | null
  setIssuesOpened: (v: { projectId: string; iid: number } | null) => void
  /** 작업 탭으로 가서 그 이슈를 오른쪽 칸에 연다(PC 폭) */
  openIssueInTab: (projectId: string, iid: number) => void
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
  issuesOpened: null,
  setIssuesOpened: () => {},
  openIssueInTab: () => {},
})

/**
 * 메인(/)이 아닌 화면이 어느 메뉴에 속하는가 — 세로 메뉴·상단바 제목이 마지막으로 연 탭 대신 이것을 보인다.
 * 프로젝트 설정·실행 화면은 프로젝트, 이슈·MR 화면은 작업. 해당 없으면 null(마지막 탭 그대로).
 */
export function tabForPath(pathname: string | null | undefined): TabKey | null {
  if (!pathname) return null
  if (pathname.startsWith('/projects') || pathname.startsWith('/executions')) return 'projects'
  if (pathname.startsWith('/issues')) return 'issues'
  if (pathname.startsWith('/agents')) return 'agents'
  return null
}

/**
 * 메인 화면(/)의 주소 — 지금 보는 화면을 주소창에 담아 북마크·공유·새로고침·뒤로가기가 되게 한다.
 *   ?tab=<탭>  &project=<프로젝트>&issue=<번호>(작업 탭)  &sub=<관리 하위 탭>(관리)  &rtype=&rdate=(보고서)
 * 메일 링크(?tab=reports&rtype=&rdate=)도 같은 형식이라 그대로 열린다. mine=1 만 한 번 쓰고 지운다.
 */
const isMainPage = () => typeof window !== 'undefined' && window.location.pathname === '/'

/** 메인 화면 주소의 매개변수를 고친다(null 이면 지움). 같으면 건드리지 않고, push 면 뒤로가기 기록을 남긴다 */
export function updateMainUrl(patch: Record<string, string | null>, push = false) {
  if (!isMainPage()) return
  const u = new URL(window.location.href)
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') u.searchParams.delete(k)
    else u.searchParams.set(k, v)
  }
  const next = u.pathname + u.search + u.hash
  if (next === window.location.pathname + window.location.search + window.location.hash) return
  try { window.history[push ? 'pushState' : 'replaceState'](window.history.state, '', next) } catch { /* 주소를 못 바꿔도 화면은 그대로 */ }
}

const TAB_KEYS = ['projects', 'issues', 'agents', 'reports', 'admin']

/** 주소에서 작업 탭의 프로젝트·열린 이슈를 읽는다 */
function linkedIssues(): { projectId: string | null; opened: { projectId: string; iid: number } | null } {
  if (!isMainPage()) return { projectId: null, opened: null }
  const q = new URLSearchParams(window.location.search)
  const projectId = q.get('tab') === 'issues' ? q.get('project') || null : null
  const iid = Number(q.get('issue'))
  return { projectId, opened: projectId && Number.isInteger(iid) && iid > 0 ? { projectId, iid } : null }
}

/**
 * 메일 등 바깥에서 여는 링크: ?tab=reports&rtype=weekly&rdate=YYYY-MM-DD(그 기간 보고서), ?tab=reports&mine=1(내 손에 있는 일)
 * 탭은 바로 정하고, 보고서 기간·"내 손에 있는 일" 강조는 보고서 탭이 처음 그릴 때 읽도록 sessionStorage 에 넘긴다(한 번만).
 */
function linkedTab(): TabKey | null {
  if (!isMainPage()) return null
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('tab')
  if (!tab || !TAB_KEYS.includes(tab)) return null
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
      if (saved && TAB_KEYS.includes(saved)) return saved as TabKey
    }
    return 'projects'
  })
  // ?mine=1 은 한 번 쓰고 지운다(새로고침해도 다시 강조되지 않게). 나머지는 주소에 남겨 북마크가 된다
  useEffect(() => { updateMainUrl({ mine: null }) }, [])
  const setActiveTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab)
    localStorage.setItem('ive-active-tab', tab)
  }, [])
  const urlProjectRef = useRef<string | null>(null)
  const [issuesProjectId, setIssuesProjectIdState] = useState<string | null>(() => {
    const fromUrl = linkedIssues().projectId
    if (fromUrl) { urlProjectRef.current = fromUrl; return fromUrl }
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
      // 주소로 연 프로젝트가 있으면 마지막 선택보다 우선
      if (savedProject && !urlProjectRef.current) {
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

  const [issuesOpened, setIssuesOpened] = useState<{ projectId: string; iid: number } | null>(() => linkedIssues().opened)
  const openIssueInTab = useCallback((projectId: string, iid: number) => {
    setIssuesProjectId(projectId)
    setIssuesOpened({ projectId, iid })
    setActiveTab('issues')
  }, [setIssuesProjectId, setActiveTab])

  // 화면 → 주소. 탭·열린 이슈가 바뀌면 뒤로가기 기록을 남기고, 프로젝트만 바뀌면 덮어쓴다
  const pathname = usePathname()
  const lastUrlStateRef = useRef<string | null>(null)
  useEffect(() => {
    if (pathname !== '/') { lastUrlStateRef.current = null; return }
    const issuesView = activeTab === 'issues'
    const opened = issuesView && issuesOpened && issuesOpened.projectId === issuesProjectId ? issuesOpened.iid : null
    const key = `${activeTab}|${opened ?? ''}`
    updateMainUrl({
      tab: activeTab,
      project: issuesView ? issuesProjectId : null,
      issue: opened ? String(opened) : null,
    }, lastUrlStateRef.current !== null && lastUrlStateRef.current !== key)
    lastUrlStateRef.current = key
  }, [pathname, activeTab, issuesProjectId, issuesOpened])

  // 뒤로/앞으로 — 주소의 탭·프로젝트·이슈를 화면에 되돌린다
  useEffect(() => {
    const onPop = () => {
      if (!isMainPage()) return
      const q = new URLSearchParams(window.location.search)
      const tab = q.get('tab')
      if (tab && TAB_KEYS.includes(tab)) setActiveTabState(tab as TabKey)
      const { projectId, opened } = linkedIssues()
      if (projectId) setIssuesProjectIdState(projectId)
      setIssuesOpened(opened)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <TabContext.Provider value={{
      activeTab, setActiveTab,
      issuesProjectId, setIssuesProjectId,
      issuesFilter, setIssuesFilter,
      issuesSort, setIssuesSort,
      navigateToIssues,
      issueAddTrigger, navigateToAddIssue,
      issuesOpened, setIssuesOpened, openIssueInTab,
    }}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab() {
  return useContext(TabContext)
}
