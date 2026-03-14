'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RoleCategory, ProjectRole } from '@/types'
import { useStore } from '@/lib/store'

interface Props {
  projectId: string
  existing?: ProjectRole
  onSuccess?: () => void
}

const roleCategories: { value: RoleCategory; label: string; icon: string; desc: string }[] = [
  { value: '개발', label: '개발', icon: 'fa-solid fa-code', desc: '코드 수정 및 기능 구현 단계' },
  { value: '검증', label: '검증', icon: 'fa-solid fa-magnifying-glass-chart', desc: '결과물 테스트 및 검수 단계' },
]

export default function RoleForm({ projectId, existing, onSuccess }: Props) {
  const router = useRouter()
  const { addRole, updateRole } = useStore()

  const [category, setCategory] = useState<RoleCategory>(existing?.category || '개발')
  const [name, setName] = useState(existing?.name || '')
  const [accessToken, setAccessToken] = useState(existing?.accessToken || '')
  const [maxAgents, setMaxAgents] = useState(existing?.maxAgents || 1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('역할 이름을 입력해주세요')
      return
    }

    setLoading(true)
    try {
      if (existing) {
        await updateRole(projectId, {
          ...existing,
          name: name.trim(),
          category,
          accessToken: accessToken.trim(),
          maxAgents,
        })
      } else {
        await addRole(projectId, {
          name: name.trim(),
          category,
          status: 'idle',
          accessToken: accessToken.trim(),
          maxAgents,
        })
      }
      onSuccess?.()
      if (!onSuccess) router.push(`/projects/${projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '작업 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* 역할 카테고리 */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">업무 단계 (카테고리)</label>
        <div className="grid grid-cols-2 gap-2">
          {roleCategories.map(r => (
            <button
              key={r.value}
              type="button"
              onClick={() => {
                setCategory(r.value)
                if (!name || name.includes(' #')) setName(`${r.value} #1`)
              }}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                category === r.value
                  ? 'bg-ive-green/10 border-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle hover:border-ive-border'
              }`}
            >
              <i className={`${r.icon} text-xl ${category === r.value ? 'text-ive-green' : 'text-ive-text-dim'}`} />
              <div className="space-y-0.5">
                <div className={`text-sm font-black ${category === r.value ? 'text-ive-green' : 'text-ive-text'}`}>
                  {r.label}
                </div>
                <div className="text-[9px] text-ive-text-dim leading-tight">{r.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 역할 이름 */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">역할 이름</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="예: API 서버 개발"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-bold"
        />
      </div>

      {/* 역할별 토큰 (선택) */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">
          역할 전용 엑세스 토큰 <span className="text-ive-text-dim font-normal">(선택)</span>
        </label>
        <input
          type="password"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          placeholder="공란 시 프로젝트 기본 토큰을 사용"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
        />
      </div>

      {/* 최대 Agent 수 */}
      <div>
        <label className="block text-xs font-semibold text-ive-text-muted mb-2">최대 투입 Agent 수</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1"
            max="100"
            value={maxAgents}
            onChange={e => setMaxAgents(parseInt(e.target.value) || 1)}
            className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
          />
          <div className="flex gap-1">
            {[1, 3, 5, 10].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setMaxAgents(n)}
                className={`px-4 py-2 rounded-lg text-xs font-black border transition-all min-w-[38px] ${
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
      </div>

      {error && (
        <div className="text-xs text-ive-red bg-ive-red/10 border border-ive-red/20 rounded-lg px-3 py-2 animate-shake">
          <i className="fa-solid fa-circle-exclamation mr-1.5" />{error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-ive-green-dark text-white font-black py-4 rounded-xl text-sm active:shadow-inner active:opacity-90 transition-all mt-4 disabled:opacity-50 shadow-lg shadow-ive-green/10"
      >
        {loading ? (
          <><i className="fa-solid fa-spinner fa-spin mr-1.5" />처리 중...</>
        ) : (
          <><i className={`fa-solid ${existing ? 'fa-check' : 'fa-id-badge'} mr-2`} />{existing ? '역할 설정 변경' : '새 역할 추가하기'}</>
        )}
      </button>
    </form>
  )
}
