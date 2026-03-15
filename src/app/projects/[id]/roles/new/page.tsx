'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import RoleForm from '@/components/role/RoleForm'

export default function NewRolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state } = useStore()

  const project = state.projects.find(p => p.id === id)

  if (!project) {
    router.push('/')
    return null
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shadow">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <button onClick={() => router.back()} className="text-ive-green text-base font-semibold hover:opacity-75 transition-opacity">
            <i className="fa-solid fa-arrow-left mr-1" />뒤로
          </button>
          <h1 className="text-lg font-bold text-ive-green-pale">역할 정의</h1>
          <span className="text-sm text-ive-text-muted ml-auto truncate font-medium uppercase tracking-wider">{project.name}</span>
        </div>
      </header>
      <main className="px-4 py-6 max-w-lg mx-auto">
        <RoleForm projectId={id} />
      </main>
    </div>
  )
}
