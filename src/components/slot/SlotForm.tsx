'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlotRole } from '@/types'
import { useStore } from '@/lib/store'

interface Props {
  projectId: string
  onSuccess?: () => void
}

const roles: { value: SlotRole; label: string; icon: string; desc: string }[] = [
  { value: 'development', label: '개발', icon: 'fa-solid fa-code', desc: '코드 수정, 기능 구현' },
  { value: 'verification', label: '검증', icon: 'fa-solid fa-magnifying-glass', desc: '빌드, 테스트, 코드 리뷰' },
  { value: 'review', label: '리뷰', icon: 'fa-solid fa-eye', desc: 'Before/After 비교, 최종 승인' },
]

export default function SlotForm({ projectId, onSuccess }: Props) {
  const router = useRouter()
  const { addSlot } = useStore()

  const [role, setRole] = useState<SlotRole>('development')
  const [name, setName] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [maxAgents, setMaxAgents] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('슬롯 이름을 입력해주세요')
      return
    }
    if (!accessToken.trim()) {
      setError('액세스 토큰을 입력해주세요')
      return
    }

    setLoading(true)
    try {
      await addSlot(projectId, {
        name: name.trim(),
        role,
        status: 'idle',
        accessToken: accessToken.trim(),
        maxAgents,
      })
      onSuccess ? onSuccess() : router.push(`/projects/${projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '슬롯 생성 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">슬롯 역할</label>
        <div className="flex flex-col gap-2">
          {roles.map(r => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRole(r.value)}
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                role === r.value
                  ? 'bg-ive-green/10 border-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle'
              }`}
            >
              <i className={`${r.icon} text-lg w-6 text-center`} />
              <div>
                <div className={`text-sm font-bold ${role === r.value ? 'text-ive-green' : 'text-ive-text'}`}>
                  {r.label}
                </div>
                <div className="text-[11px] text-ive-text-muted">{r.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">슬롯 이름</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="개발 #1"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">
          <i className="fa-solid fa-key mr-1" />액세스 토큰
        </label>
        <input
          type="password"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          placeholder="ghp_xxxx 또는 glpat-xxxx"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
        />
        <p className="text-[10px] text-ive-text-dim mt-1">
          <i className="fa-solid fa-lock mr-1" />토큰은 암호화되어 안전하게 저장됩니다
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">최대 Agent 수</label>
        <div className="flex gap-2">
          {[1, 2, 3, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setMaxAgents(n)}
              className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${
                maxAgents === n
                  ? 'bg-ive-green/10 border-ive-green text-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-xs text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">
          <i className="fa-solid fa-circle-exclamation mr-1" />{error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-sm active:bg-ive-green/80 transition-colors mt-2 disabled:opacity-50"
      >
        {loading ? (<><i className="fa-solid fa-spinner fa-spin mr-1.5" />생성 중...</>) : (<><i className="fa-solid fa-plus mr-1.5" />슬롯 생성</>)}
      </button>
    </form>
  )
}
