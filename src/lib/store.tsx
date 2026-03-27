'use client'

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from 'react'
import { User, Project, Agent, ProjectAssignment } from '@/types'

interface ProjectWithAgents extends Project {
  assignedAgents: (ProjectAssignment & { agent: Agent })[]
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
      // 비로그인이면 loading도 해제
      return { ...state, user: action.user, authChecked: true, loading: action.user ? state.loading : false }
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects, loading: false }
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
  addProject: (p: Omit<Project, 'id' | 'userId' | 'createdAt'>) => Promise<void>
  updateProject: (p: Project) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  refreshAgents: () => Promise<void>
  addAgent: (a: Omit<Agent, 'id' | 'userId' | 'createdAt'>) => Promise<void>
  updateAgent: (a: Agent) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  assignAgentToProject: (projectId: string, agentId: string, accessToken?: string) => Promise<void>
  unassignAgentFromProject: (projectId: string, agentId: string) => Promise<void>
  updateAgentToken: (projectId: string, agentId: string, accessToken: string) => Promise<void>
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
  assignAgentToProject: async () => {},
  unassignAgentFromProject: async () => {},
  updateAgentToken: async () => {},
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

  const refresh = useCallback(async () => {
    const res = await fetch('/api/projects')
    if (res.ok) {
      const data = await res.json()
      // 작업 중인 프로젝트를 위로 정렬 (running > 0 우선, 그 다음 sortOrder)
      data.sort((a: any, b: any) => {
        const aRunning = a.runningCount ?? 0
        const bRunning = b.runningCount ?? 0
        if (aRunning > 0 && bRunning === 0) return -1
        if (aRunning === 0 && bRunning > 0) return 1
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      })
      dispatch({ type: 'SET_PROJECTS', projects: data })
    } else if (res.status === 401) {
      // 세션 만료: 사용자 상태 초기화 → 로그인 페이지로 리다이렉트
      sessionStorage.setItem('ive-session-expired', '1')
      dispatch({ type: 'SET_USER', user: null })
    } else {
      dispatch({ type: 'SET_PROJECTS', projects: [] })
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
      dispatch({ type: 'SET_AGENTS', agents: data })
    } else if (res.status === 401) {
      sessionStorage.setItem('ive-session-expired', '1')
      dispatch({ type: 'SET_USER', user: null })
    } else {
      dispatch({ type: 'SET_AGENTS', agents: [] })
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

  useEffect(() => {
    refreshUser().then((user) => {
      if (user) {
        dispatch({ type: 'SET_LOADING', loading: true })
        refresh()
        refreshAgents()
      }
    })

    // 10초마다 데이터 자동 갱신 (스캐너 상태 등 반영)
    const interval = setInterval(() => {
      if (userRef.current) {
        refresh()
        refreshAgents()
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [refreshUser, refresh, refreshAgents])

  const addProject = useCallback(async (p: Omit<Project, 'id' | 'userId' | 'createdAt'>) => {
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

  const assignAgentToProject = useCallback(async (projectId: string, agentId: string, accessToken?: string) => {
    const res = await fetch(`/api/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, accessToken: accessToken || '' }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Agent 배정 실패')
    }
    await refresh()
  }, [refresh])

  const updateAgentToken = useCallback(async (projectId: string, agentId: string, accessToken: string) => {
    await fetch(`/api/projects/${projectId}/agents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, accessToken }),
    })
    await refresh()
  }, [refresh])

  const unassignAgentFromProject = useCallback(async (projectId: string, agentId: string) => {
    await fetch(`/api/projects/${projectId}/agents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    await refresh()
  }, [refresh])

  const scanProjectNow = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}/scan`, { method: 'POST' })
    if (res.ok) {
      await refresh()
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
      assignAgentToProject, unassignAgentFromProject, updateAgentToken,
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
