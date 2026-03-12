'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import SlotForm from '@/components/slot/SlotForm'

export default function NewSlotPage({ params }: { params: Promise<{ id: string }> }) {
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
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <button onClick={() => router.back()} className="text-ive-green text-sm font-semibold">
            ← 뒤로
          </button>
          <h1 className="text-base font-bold text-ive-green-pale">슬롯 추가</h1>
          <span className="text-[11px] text-ive-text-muted ml-auto truncate">{project.name}</span>
        </div>
      </header>
      <main className="px-4 py-6 max-w-lg mx-auto">
        <SlotForm projectId={id} />
      </main>
    </div>
  )
}
