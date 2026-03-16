'use client'

import { createContext, useContext, useReducer, useEffect, useCallback, useRef, ReactNode } from 'react'
import { User, Project, Agent, ProjectAssignment } from '@/types'

interface ProjectWithAgents extends Project {
  assignedAgents: (ProjectAssignment & { agent: Agent })[]
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
      return { ...state, user: action.user, authChecked: true }
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
  refreshUser: () => Promise<void>
  refresh: () => Promise<void>
  logout: () => Promise<void>
  addProject: (p: Omit<Project, 'id' | 'userId' | 'createdAt'>) => Promise<void>
  updateProject: (p: Project) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  refreshAgents: () => Promise<void>
  addAgent: (a: Omit<Agent, 'id' | 'userId' | 'createdAt'>) => Promise<void>
  updateAgent: (a: Agent) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  assignAgentToProject: (projectId: string, agentId: string) => Promise<void>
  unassignAgentFromProject: (projectId: string, agentId: string) => Promise<void>
  reorderProject: (projectId: string, direction: 'up' | 'down') => Promise<void>
  scanProjectNow: (id: string) => Promise<void>
}>({
  state: { user: null, projects: [], agents: [], loading: true, authChecked: false },
  refreshUser: async () => {},
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
  reorderProject: async () => {},
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

  const refreshUser = useCallback(async () => {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const user = await res.json()
      dispatch({ type: 'SET_USER', user })
    } else {
      dispatch({ type: 'SET_USER', user: null })
    }
  }, [])

  const refresh = useCallback(async () => {
    const res = await fetch('/api/projects')
    if (res.ok) {
      const data = await res.json()
      dispatch({ type: 'SET_PROJECTS', projects: data })
    } else {
      dispatch({ type: 'SET_PROJECTS', projects: [] })
    }
  }, [])

  const refreshAgents = useCallback(async () => {
    const res = await fetch('/api/agents')
    if (res.ok) {
      const data = await res.json()
      dispatch({ type: 'SET_AGENTS', agents: data })
    } else {
      dispatch({ type: 'SET_AGENTS', agents: [] })
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    dispatch({ type: 'SET_USER', user: null })
    dispatch({ type: 'SET_PROJECTS', projects: [] })
    dispatch({ type: 'SET_AGENTS', agents: [] })
  }, [])

  const userRef = useRef(state.user)
  useEffect(() => {
    userRef.current = state.user
  }, [state.user])

  useEffect(() => {
    refreshUser().then(() => {
      refresh()
      refreshAgents()
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

  const assignAgentToProject = useCallback(async (projectId: string, agentId: string) => {
    const res = await fetch(`/api/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Agent 배정 실패')
    }
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

  const reorderProject = useCallback(async (projectId: string, direction: 'up' | 'down') => {
    const projects = [...state.projects].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const idx = projects.findIndex(p => p.id === projectId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= projects.length) return

    const orders = projects.map((p, i) => {
      if (i === idx) return { id: p.id, sortOrder: swapIdx }
      if (i === swapIdx) return { id: p.id, sortOrder: idx }
      return { id: p.id, sortOrder: i }
    })

    await fetch('/api/projects/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    })
    await refresh()
  }, [state.projects, refresh])

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
      assignAgentToProject, unassignAgentFromProject,
      reorderProject, scanProjectNow,
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
