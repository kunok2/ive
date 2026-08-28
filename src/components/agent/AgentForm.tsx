'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CliName } from '@/types'
import { useStore } from '@/lib/store'
import { AvatarSelector } from '@/components/agent/AgentAvatar'
import CliLogo from '@/components/ui/CliLogo'

interface Props {
  onSuccess?: () => void
  onCancel?: () => void
}

export default function AgentForm({ onSuccess, onCancel }: Props) {
  const t = useTranslations('agent')
  const tc = useTranslations('common')
  const { addAgent, state } = useStore()
  const userMaxAgents = state.user?.maxAgents || 0
  const userMaxTurns = state.user?.maxTurns || 0
  const currentAgentCount = state.agents.length
  const limitReached = userMaxAgents > 0 && currentAgentCount >= userMaxAgents

  const cliTools: { value: CliName; label: string; icon: string; desc: string; defaultName: string }[] = [
    { value: 'claude', label: 'Claude Code', icon: 'fa-solid fa-atom', desc: t('claudeDesc'), defaultName: 'Claude' },
    { value: 'agy', label: 'agy', icon: 'fa-brands fa-google', desc: t('agyDesc'), defaultName: 'Antigravity' },
    { value: 'codex', label: 'Codex CLI', icon: 'fa-solid fa-brain', desc: t('codexDesc'), defaultName: 'Codex' },
    { value: 'opencode', label: 'OpenCode', icon: 'fa-solid fa-terminal', desc: t('opencodeDesc'), defaultName: 'OpenCode' },
  ]

  const allowedClis = state.user?.allowedClis || ['opencode']
  const availableTools = cliTools.filter(t => allowedClis.includes(t.value))
  const defaultCli = (availableTools[0]?.value ?? 'opencode') as CliName

  const [cliName, setCliName] = useState<CliName>(defaultCli)
  const [name, setName] = useState(availableTools[0]?.defaultName ?? 'Agent')
  // 기본 아바타 = 선택된 CLI(회사) 브랜드 로고
  const [avatar, setAvatar] = useState<string>(`cli-${defaultCli}`)
  const [cliPaths, setCliPaths] = useState<Record<string, string>>({})
  const [cliModels, setCliModels] = useState<Record<string, string[]>>({})
  const [modelName, setModelName] = useState('')
  const [cliVersion, setCliVersion] = useState('')
  const [maxTurns, setMaxTurns] = useState(() => userMaxTurns > 0 ? Math.floor(userMaxTurns / 2) : 200)
  const [snapshotInterval, setSnapshotInterval] = useState(1)
  const [sparklinePoints, setSparklinePoints] = useState(60)
  const [statsRetention, setStatsRetention] = useState(7)
  const [showMonitoring, setShowMonitoring] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/settings/cli-paths').then(r => r.json()).then(setCliPaths).catch(() => {})
    fetch('/api/settings/cli-models').then(r => r.json()).then(setCliModels).catch(() => {})
  }, [])

  function handleCliChange(cli: CliName) {
    setCliName(cli)
    setModelName('')
    const tool = cliTools.find(t => t.value === cli)
    if (tool) {
      setName(tool.defaultName)
    }
    // 회사 로고 기본 아바타를 쓰던 중이면 새 CLI 로고로 갱신 (사용자가 직접 고른 아바타는 유지)
    setAvatar(prev => (prev.startsWith('cli-') ? `cli-${cli}` : prev))
  }

  const currentCliPath = cliPaths[cliName] || ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError(t('nameRequired'))
      return
    }
    if (!currentCliPath) {
      setError(t('cliPathMissing'))
      return
    }

    setLoading(true)
    try {
      await addAgent({
        name: name.trim(),
        avatar,
        cliName,
        cliPath: currentCliPath,
        cliVersion: cliVersion.trim(),
        modelName,
        maxTurns,
        status: 'available',
        snapshotInterval,
        sparklinePoints,
        statsRetention,
        enabled: true,
      })
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* CLI 도구 선택 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('cliTool')}</label>
        <div className="flex flex-col gap-2">
          {availableTools.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => handleCliChange(t.value)}
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                cliName === t.value
                  ? 'bg-ive-green/10 border-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle'
              }`}
            >
              <CliLogo cli={t.value} className="w-6 h-6 shrink-0" />
              <div>
                <div className={`text-base font-bold ${cliName === t.value ? 'text-ive-green' : 'text-ive-text'}`}>
                  {t.label}
                </div>
                <div className="text-sm text-ive-text-muted">{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 모델 선택 */}
      {(cliModels[cliName]?.length ?? 0) > 0 && (
        <div>
          <label className="block text-base font-bold text-ive-text-muted mb-2">
            <i className="fa-solid fa-microchip mr-1" />{t('model')}
          </label>
          <select
            value={modelName}
            onChange={e => setModelName(e.target.value)}
            className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text focus:outline-none focus:border-ive-green"
          >
            <option value="">{t('modelDefault')}</option>
            {cliModels[cliName].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Agent 이름 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('agentName')} <span className="text-ive-red">*</span></label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('agentNamePlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 아바타 선택 */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">{t('avatar')}</label>
        <AvatarSelector value={avatar} onChange={setAvatar} cliName={cliName} />
      </div>

      {/* 버전 (선택) */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">
          <i className="fa-solid fa-code-branch mr-1" />{t('versionOptional')}
        </label>
        <input
          type="text"
          value={cliVersion}
          onChange={e => setCliVersion(e.target.value)}
          placeholder={t('versionPlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green font-mono"
        />
      </div>

      {/* Max Turns */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">
          <i className="fa-solid fa-repeat mr-1" />{t('maxTurns')}
        </label>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center border border-ive-border rounded-lg overflow-hidden bg-ive-bg-input shrink-0">
            <button
              type="button"
              onClick={() => setMaxTurns(v => Math.max(1, v - 10))}
              className="px-2.5 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-bold"
            >−</button>
            <span className="w-12 py-3 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{maxTurns}</span>
            <button
              type="button"
              onClick={() => setMaxTurns(v => Math.min(userMaxTurns > 0 ? userMaxTurns : 1000, v + 10))}
              className="px-2.5 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-bold"
            >+</button>
          </div>
          {userMaxTurns > 0 && <span className="text-xs text-ive-amber shrink-0">max {userMaxTurns}</span>}
          <div className="flex gap-1 flex-1 min-w-0">
            {[50, 100, 200].filter(v => userMaxTurns <= 0 || v <= userMaxTurns).map(v => (
              <button key={v} type="button" onClick={() => setMaxTurns(v)}
                className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-all ${maxTurns === v ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
              >{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 모니터링 설정 */}
      <div className="border-t border-ive-border-dark pt-2">
        <button
          type="button"
          onClick={() => setShowMonitoring(!showMonitoring)}
          className="flex items-center gap-1.5 text-base font-bold text-ive-cyan mb-3"
        >
          <i className={`fa-solid ${showMonitoring ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
          {t('monitoring')}
        </button>

        {showMonitoring && (
          <div className="space-y-4 pb-2 animate-in fade-in slide-in-from-top-2">
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {t('snapshotInterval')} <span className="text-ive-text-dim font-normal">({tc('minutes')})</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{snapshotInterval}</span>
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.min(60, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[1, 5, 10].map(v => (
                    <button key={v} type="button" onClick={() => setSnapshotInterval(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${snapshotInterval === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}m</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {t('sparklinePoints')}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setSparklinePoints(v => Math.max(10, v - 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{sparklinePoints}</span>
                  <button type="button" onClick={() => setSparklinePoints(v => Math.min(200, v + 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[30, 60, 120].map(v => (
                    <button key={v} type="button" onClick={() => setSparklinePoints(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${sparklinePoints === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}</button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {t('dataRetention')} <span className="text-ive-text-dim font-normal">({tc('days')})</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setStatsRetention(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{statsRetention}</span>
                  <button type="button" onClick={() => setStatsRetention(v => Math.min(90, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[7, 14, 30].map(v => (
                    <button key={v} type="button" onClick={() => setStatsRetention(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${statsRetention === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}d</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {limitReached && (
        <div className="text-sm text-ive-amber bg-ive-amber/10 rounded-lg px-3 py-2">
          <i className="fa-solid fa-triangle-exclamation mr-1" />
          {t('limitExceededCurrent', { max: userMaxAgents, current: currentAgentCount })}
        </div>
      )}

      {error && (
        <div className="text-sm font-bold text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">
          <i className="fa-solid fa-circle-exclamation mr-1" />{error}
        </div>
      )}

      {/* 버튼 — 스크롤해도 항상 하단에 고정 */}
      <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-1 mt-2 border-t border-ive-border-dark bg-ive-bg-solid flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-white/5 border border-ive-border-subtle text-ive-text-muted font-bold py-4 rounded-lg text-sm active:opacity-80 transition-all"
          >
            {tc('cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={loading || limitReached}
          className="flex-[2] bg-ive-green-dark text-white font-bold py-4 rounded-lg text-sm active:bg-ive-green/80 transition-colors disabled:opacity-50"
        >
          {loading ? (<><i className="fa-solid fa-spinner fa-spin mr-1.5" />{tc('creating')}</>) : (<><i className="fa-solid fa-robot mr-1.5" />{t('addAgent')}</>)}
        </button>
      </div>
    </form>
  )
}
