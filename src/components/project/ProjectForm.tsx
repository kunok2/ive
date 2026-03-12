'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Provider, Project } from '@/types'
import { useStore } from '@/lib/store'

interface Props {
  existing?: Project
  onSuccess?: () => void
}

export default function ProjectForm({ existing, onSuccess }: Props) {
  const router = useRouter()
  const { addProject, updateProject } = useStore()

  const [provider, setProvider] = useState<Provider>(existing?.provider ?? 'github')
  const [name, setName] = useState(existing?.name ?? '')
  const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !repoUrl.trim()) return

    if (existing) {
      await updateProject({ ...existing, name: name.trim(), provider, repoUrl: repoUrl.trim() })
      onSuccess ? onSuccess() : router.push(`/projects/${existing.id}`)
    } else {
      await addProject({ name: name.trim(), provider, repoUrl: repoUrl.trim() })
      onSuccess ? onSuccess() : router.push('/')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Provider 선택 */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">플랫폼</label>
        <div className="flex gap-2">
          {(['github', 'gitlab'] as Provider[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${
                provider === p
                  ? 'bg-ive-green/10 border-ive-green text-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'
              }`}
            >
              <i className={`fa-brands ${p === 'github' ? 'fa-github' : 'fa-gitlab'} mr-1.5`} />
              {p === 'github' ? 'GitHub' : 'GitLab'}
            </button>
          ))}
        </div>
      </div>

      {/* 프로젝트 이름 */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">프로젝트 이름</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="org/repository"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 저장소 URL */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">저장소 URL</label>
        <input
          type="url"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder={`https://${provider === 'github' ? 'github.com' : 'gitlab.com'}/org/repo.git`}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 버튼 */}
      <button
        type="submit"
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-sm active:bg-ive-green/80 transition-colors mt-2"
      >
        {existing ? '수정 완료' : '프로젝트 생성'}
      </button>
    </form>
  )
}
