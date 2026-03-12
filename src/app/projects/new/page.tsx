'use client'

import { useRouter } from 'next/navigation'
import ProjectForm from '@/components/project/ProjectForm'

export default function NewProjectPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
          <button onClick={() => router.back()} className="text-ive-green text-sm font-semibold">
            ← 뒤로
          </button>
          <h1 className="text-base font-bold text-ive-green-pale">새 프로젝트</h1>
        </div>
      </header>
      <main className="px-4 py-6 max-w-lg mx-auto">
        <ProjectForm />
      </main>
    </div>
  )
}
