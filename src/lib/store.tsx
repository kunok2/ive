'use client'

import { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react'
import { User, Project, Slot } from '@/types'

interface ProjectWithSlots extends Project {
  slots: Slot[]
}

interface State {
  user: User | null
  projects: ProjectWithSlots[]
  loading: boolean
  authChecked: boolean
}

type Action =
  | { type: 'SET_USER'; user: User | null }
  | { type: 'SET_PROJECTS'; projects: ProjectWithSlots[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'AUTH_CHECKED' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.user, authChecked: true }
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects, loading: false }
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
  addSlot: (projectId: string, s: Omit<Slot, 'id' | 'projectId' | 'createdAt'>) => Promise<void>
  deleteSlot: (projectId: string, slotId: string) => Promise<void>
}>({
  state: { user: null, projects: [], loading: true, authChecked: false },
  refreshUser: async () => {},
  refresh: async () => {},
  logout: async () => {},
  addProject: async () => {},
  updateProject: async () => {},
  deleteProject: async () => {},
  addSlot: async () => {},
  deleteSlot: async () => {},
})

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    user: null,
    projects: [],
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

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    dispatch({ type: 'SET_USER', user: null })
    dispatch({ type: 'SET_PROJECTS', projects: [] })
  }, [])

  // 초기 인증 체크
  useEffect(() => {
    refreshUser().then(() => refresh())
  }, [refreshUser, refresh])

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

  const addSlot = useCallback(async (
    projectId: string,
    s: Omit<Slot, 'id' | 'projectId' | 'createdAt'>
  ) => {
    const res = await fetch(`/api/projects/${projectId}/slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: generateId(),
        ...s,
        createdAt: new Date().toISOString(),
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || '슬롯 생성 실패')
    }
    await refresh()
  }, [refresh])

  const deleteSlot = useCallback(async (projectId: string, slotId: string) => {
    await fetch(`/api/projects/${projectId}/slots/${slotId}`, { method: 'DELETE' })
    await refresh()
  }, [refresh])

  return (
    <StoreContext.Provider value={{
      state, refreshUser, refresh, logout,
      addProject, updateProject, deleteProject, addSlot, deleteSlot,
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
