export interface User {
  id: string
  email: string
  name: string
  createdAt: string
}

export type Provider = 'github' | 'gitlab'
export type SlotRole = 'development' | 'verification' | 'review'
export type SlotStatus = 'active' | 'idle' | 'paused'

export interface Project {
  id: string
  userId: string
  name: string
  provider: Provider
  repoUrl: string
  createdAt: string
}

export interface Slot {
  id: string
  projectId: string
  name: string
  role: SlotRole
  status: SlotStatus
  accessToken: string
  maxAgents: number
  createdAt: string
}
