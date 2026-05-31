'use client'

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from 'react'
import { User, Project, Agent } from '@/types'

interface ProjectWithAgents extends Project {
  runningCount?: number       // 현재 실행 중인 작업 수
  shareRole?: string | null  // null=소유자, 'viewer', 'editor'
}

interface State {
  user: User | null
  projects: ProjectWithAgents[]
  agents: Agent[]
  loading: boolean
  authChecked: boolean
}

type Action =
  | { type: 'SET_USER'; user: User | null }
  | { type: 'SET_PROJECTS'; projects: ProjectWithAgents[] }
  | { type: 'SET_AGENTS'; agents: Agent[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'AUTH_CHECKED' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_USER':
      // 비로그인이면 loading도 해제, 로그인 시(null→user) loading 활성화
      if (action.user && !state.user) {
        return { ...state, user: action.user, authChecked: true, loading: true }
      }
      return { ...state, user: action.user, authChecked: true, loading: action.user ? state.loading : false }
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects }
    case 'SET_AGENTS':
      return { ...state, agents: action.agents }
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'AUTH_CHECKED':
      return { ...state, authChecked: true }
    default:
      return state
  }
}

const StoreContext = createContext<{
  state: State
  refreshUser: () => Promise<User | null>
  refresh: () => Promise<void>
  logout: () => Promise<void>
  addProject: (p: Omit<Project, 'id' | 'userId' | 'createdAt' | 'conflictCount'> & { useOAuthToken?: boolean }) => Promise<void>
  updateProject: (p: Project) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  refreshAgents: () => Promise<void>
  addAgent: (a: Omit<Agent, 'id' | 'userId' | 'createdAt'>) => Promise<void>
  updateAgent: (a: Agent) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  scanProjectNow: (id: string) => Promise<void>
}>({
  state: { user: null, projects: [], agents: [], loading: true, authChecked: false },
  refreshUser: async () => null,
  refresh: async () => {},
  logout: async () => {},
  addProject: async () => {},
  updateProject: async () => {},
  deleteProject: async () => {},
  refreshAgents: async () => {},
  addAgent: async () => {},
  updateAgent: async () => {},
  deleteAgent: async () => {},
  scanProjectNow: async () => {},
})

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    user: null,
    projects: [],
    agents: [],
    loading: true,
    authChecked: false,
  })

  const refreshUser = useCallback(async (): Promise<User | null> => {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const data = await res.json()
      const user = data.user === null ? null : (data.id ? data : null)
      dispatch({ type: 'SET_USER', user })
      return user
    } else {
      dispatch({ type: 'SET_USER', user: null })
      return null
    }
  }, [])

  // 10초 폴링이 매번 새 배열 reference를 dispatch하면 모든 자식이 리렌더되며
  // 화면이 깜빡인다. 직렬화 결과가 같으면 dispatch를 건너뛰어 reference를 유지한다.
  const lastProjectsJsonRef = useRef<string>('')
  const lastAgentsJsonRef = useRef<string>('')

  const refresh = useCallback(async () => {
    const res = await fetch('/api/projects')
    if (res.ok) {
      const data = await res.json()
      // 작업 중인 프로젝트를 최상단으로. 나머지는 서버의 last_activity_at DESC 순서 유지.
      const sorted = [...data].sort((a: any, b: any) => {
        const aRunning = a.runningCount ?? 0
        const bRunning = b.runningCount ?? 0
        if (aRunning > 0 && bRunning === 0) return -1
        if (aRunning === 0 && bRunning > 0) return 1
        return 0
      })
      const json = JSON.stringify(sorted)
      if (json !== lastProjectsJsonRef.current) {
        lastProjectsJsonRef.current = json
        dispatch({ type: 'SET_PROJECTS', projects: sorted })
      }
    } else if (res.status === 401) {
      // 세션 만료: 사용자 상태 초기화 → 로그인 페이지로 리다이렉트
      sessionStorage.setItem('ive-session-expired', '1')
      dispatch({ type: 'SET_USER', user: null })
    } else {
      if (lastProjectsJsonRef.current !== '[]') {
        lastProjectsJsonRef.current = '[]'
        dispatch({ type: 'SET_PROJECTS', projects: [] })
      }
    }
  }, [])

  const refreshAgents = useCallback(async () => {
    const res = await fetch('/api/agents')
    if (res.ok) {
      const data = await res.json()
      // busy 에이전트를 위로 정렬
      data.sort((a: any, b: any) => {
        if (a.status === 'busy' && b.status !== 'busy') return -1
        if (a.status !== 'busy' && b.status === 'busy') return 1
        return 0
      })
      const json = JSON.stringify(data)
      if (json !== lastAgentsJsonRef.current) {
        lastAgentsJsonRef.current = json
        dispatch({ type: 'SET_AGENTS', agents: data })
      }
    } else if (res.status === 401) {
      sessionStorage.setItem('ive-session-expired', '1')
      dispatch({ type: 'SET_USER', user: null })
    } else {
      if (lastAgentsJsonRef.current !== '[]') {
        lastAgentsJsonRef.current = '[]'
        dispatch({ type: 'SET_AGENTS', agents: [] })
      }
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    dispatch({ type: 'SET_USER', user: null })
    dispatch({ type: 'SET_PROJECTS', projects: [] })
    dispatch({ type: 'SET_AGENTS', agents: [] })
    // 세션 캐시 제거
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('issues-cache')
      sessionStorage.removeItem('issues-scroll')
    }
  }, [])

  const userRef = useRef(state.user)
  useEffect(() => {
    userRef.current = state.user
  }, [state.user])

  // 로그인 상태 변화 감지: user가 null→non-null 로 바뀌면 데이터 로딩
  const dataLoadedForUser = useRef<string | null>(null)
  useEffect(() => {
    if (state.user && dataLoadedForUser.current !== state.user.id) {
      dataLoadedForUser.current = state.user.id
      dispatch({ type: 'SET_LOADING', loading: true })
      Promise.all([refresh(), refreshAgents()]).then(() => {
        dispatch({ type: 'SET_LOADING', loading: false })
      })
    } else if (!state.user) {
      dataLoadedForUser.current = null
    }
  }, [state.user, refresh, refreshAgents])

  useEffect(() => {
    refreshUser()

    // 10초마다 데이터 자동 갱신 (스캐너 상태 등 반영)
    const interval = setInterval(() => {
      if (userRef.current) {
        refresh()
        refreshAgents()
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [refreshUser, refresh, refreshAgents])

  const addProject = useCallback(async (p: Omit<Project, 'id' | 'userId' | 'createdAt' | 'conflictCount'> & { useOAuthToken?: boolean }) => {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: generateId(),
        ...p,
        createdAt: new Date().toISOString(),
      }),
    })
    await refresh()
  }, [refresh])

  const updateProject = useCallback(async (p: Project) => {
    await fetch(`/api/projects/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    })
    await refresh()
  }, [refresh])

  const deleteProject = useCallback(async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    await refresh()
  }, [refresh])

  const addAgent = useCallback(async (a: Omit<Agent, 'id' | 'userId' | 'createdAt'>) => {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: generateId(),
        ...a,
        createdAt: new Date().toISOString(),
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Agent 생성 실패')
    }
    await refreshAgents()
  }, [refreshAgents])

  const updateAgent = useCallback(async (a: Agent) => {
    await fetch(`/api/agents/${a.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    })
    await refreshAgents()
  }, [refreshAgents])

  const deleteAgent = useCallback(async (id: string) => {
    await fetch(`/api/agents/${id}`, { method: 'DELETE' })
    await refreshAgents()
    await refresh()
  }, [refreshAgents, refresh])

  const scanProjectNow = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}/scan`, { method: 'POST' })
    if (res.ok) {
      await refresh()
      // 스캔은 서버에서 비동기(fire-and-forget)로 실행돼 응답 시점엔 아직 끝나지 않는다.
      // 완료 후 lastCheckedAt 등이 반영되도록 잠시 뒤 한 번 더 새로고침해 체감 반응을 준다.
      // (refresh는 변경분이 있을 때만 dispatch하므로 변화 없으면 사실상 no-op)
      setTimeout(() => { refresh() }, 2000)
      setTimeout(() => { refresh() }, 5000)
    } else {
      const data = await res.json()
      throw new Error(data.error || '스캔 실행 실패')
    }
  }, [refresh])

  return (
    <StoreContext.Provider value={{
      state, refreshUser, refresh, logout,
      addProject, updateProject, deleteProject,
      refreshAgents, addAgent, updateAgent, deleteAgent,
      scanProjectNow,
    }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  return useContext(StoreContext)
}

export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function maskToken(token: string) {
  if (token.length <= 8) return '****'
  return token.slice(0, 4) + '****' + token.slice(-4)
}
