'use client'

import { useState } from 'react'
import { CliName } from '@/types'
import { useStore } from '@/lib/store'

interface Props {
  onSuccess?: () => void
}

const cliTools: { value: CliName; label: string; icon: string; desc: string; defaultPath: string; defaultName: string }[] = [
  { value: 'claude', label: 'Claude Code', icon: 'fa-solid fa-atom', desc: 'Anthropic의 AI 코딩 CLI', defaultPath: '/usr/local/bin/claude', defaultName: 'Claude' },
  { value: 'gemini', label: 'Gemini CLI', icon: 'fa-brands fa-google', desc: 'Google의 AI 코딩 CLI', defaultPath: '/usr/local/bin/gemini', defaultName: 'Gemini' },
  { value: 'codex', label: 'Codex CLI', icon: 'fa-solid fa-brain', desc: 'OpenAI의 AI 코딩 CLI', defaultPath: '/usr/local/bin/codex', defaultName: 'Codex' },
]

export default function AgentForm({ onSuccess }: Props) {
  const { addAgent } = useStore()

  const [cliName, setCliName] = useState<CliName>('claude')
  const [name, setName] = useState(cliTools[0].defaultName)
  const [cliPath, setCliPath] = useState(cliTools[0].defaultPath)
  const [cliVersion, setCliVersion] = useState('')
  const [maxTurns, setMaxTurns] = useState(200)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleCliChange(cli: CliName) {
    setCliName(cli)
    const tool = cliTools.find(t => t.value === cli)
    if (tool) {
      setCliPath(tool.defaultPath)
      setName(tool.defaultName)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Agent 이름을 입력해주세요')
      return
    }
    if (!cliPath.trim()) {
      setError('CLI 설치 경로를 입력해주세요')
      return
    }

    setLoading(true)
    try {
      await addAgent({
        name: name.trim(),
        cliName,
        cliPath: cliPath.trim(),
        cliVersion: cliVersion.trim(),
        maxTurns,
        status: 'available',
      })
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent 생성 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* CLI 도구 선택 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">CLI 도구</label>
        <div className="flex flex-col gap-2">
          {cliTools.map(t => {
            const disabled = t.value !== 'claude'
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => !disabled && handleCliChange(t.value)}
                disabled={disabled}
                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  disabled
                    ? 'bg-ive-bg-deep border-ive-border-subtle opacity-40 cursor-not-allowed'
                    : cliName === t.value
                      ? 'bg-ive-green/10 border-ive-green'
                      : 'bg-ive-bg-card border-ive-border-subtle'
                }`}
              >
                <i className={`${t.icon} text-xl w-6 text-center`} />
                <div>
                  <div className={`text-base font-bold ${disabled ? 'text-ive-text-dim' : cliName === t.value ? 'text-ive-green' : 'text-ive-text'}`}>
                    {t.label}
                    {disabled && <span className="ml-2 text-sm font-normal text-ive-text-dim">(준비 중)</span>}
                  </div>
                  <div className="text-base text-ive-text-muted">{t.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Agent 이름 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">Agent 이름</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="개발 Agent #1"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* CLI 설치 경로 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          <i className="fa-solid fa-folder mr-1" />설치 경로
        </label>
        <input
          type="text"
          value={cliPath}
          onChange={e => setCliPath(e.target.value)}
          placeholder="/opt/homebrew/bin/claude"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
        />
        <p className="text-sm text-ive-text-dim mt-1">
          <i className="fa-solid fa-circle-info mr-1" />장비에 설치된 CLI 실행 파일의 전체 경로
        </p>
      </div>

      {/* 버전 (선택) */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          <i className="fa-solid fa-code-branch mr-1" />버전 <span className="text-ive-text-dim font-normal">(선택)</span>
        </label>
        <input
          type="text"
          value={cliVersion}
          onChange={e => setCliVersion(e.target.value)}
          placeholder="예: 2.1.69"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
        />
      </div>

      {/* Max Turns */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          <i className="fa-solid fa-repeat mr-1" />최대 턴 수
        </label>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center border border-ive-border rounded-lg overflow-hidden bg-ive-bg-input shrink-0">
            <button
              type="button"
              onClick={() => setMaxTurns(v => Math.max(1, v - 10))}
              className="px-2.5 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-black"
            >−</button>
            <span className="w-12 py-3 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{maxTurns}</span>
            <button
              type="button"
              onClick={() => setMaxTurns(v => Math.min(1000, v + 10))}
              className="px-2.5 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-black"
            >+</button>
          </div>
          <div className="flex gap-1 flex-1 min-w-0">
            {[50, 100, 200].map(v => (
              <button key={v} type="button" onClick={() => setMaxTurns(v)}
                className={`flex-1 py-3 rounded-lg text-sm font-black border transition-all ${maxTurns === v ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
              >{v}</button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">
          <i className="fa-solid fa-circle-exclamation mr-1" />{error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-base active:bg-ive-green/80 transition-colors mt-2 disabled:opacity-50"
      >
        {loading ? (<><i className="fa-solid fa-spinner fa-spin mr-1.5" />생성 중...</>) : (<><i className="fa-solid fa-robot mr-1.5" />Agent 추가</>)}
      </button>
    </form>
  )
}
