'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CliName, DEFAULT_AVATARS } from '@/types'
import { useStore } from '@/lib/store'
import { AvatarSelector } from '@/components/agent/AgentAvatar'

interface Props {
  onSuccess?: () => void
}

export default function AgentForm({ onSuccess }: Props) {
  const t = useTranslations('agent')
  const tc = useTranslations('common')
  const { addAgent, state } = useStore()
  const userMaxAgents = state.user?.maxAgents || 0
  const userMaxTurns = state.user?.maxTurns || 0
  const currentAgentCount = state.agents.length
  const limitReached = userMaxAgents > 0 && currentAgentCount >= userMaxAgents

  const cliTools: { value: CliName; label: string; icon: string; desc: string; defaultName: string }[] = [
    { value: 'claude', label: 'Claude Code', icon: 'fa-solid fa-atom', desc: t('claudeDesc'), defaultName: 'Claude' },
    { value: 'opencode', label: 'OpenCode', icon: 'fa-solid fa-terminal', desc: t('opencodeDesc'), defaultName: 'OpenCode' },
  ]

  const allowedClis = state.user?.allowedClis || ['opencode']
  const availableTools = cliTools.filter(t => allowedClis.includes(t.value))
  const defaultCli = (availableTools[0]?.value ?? 'opencode') as CliName

  const [cliName, setCliName] = useState<CliName>(defaultCli)
  const [name, setName] = useState(availableTools[0]?.defaultName ?? 'Agent')
  const [avatar, setAvatar] = useState<string>(() => DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)].id)
  const [cliPaths, setCliPaths] = useState<Record<string, string>>({})
  const [cliVersion, setCliVersion] = useState('')
  const [maxTurns, setMaxTurns] = useState(() => userMaxTurns > 0 ? Math.floor(userMaxTurns / 2) : 200)
  const [snapshotInterval, setSnapshotInterval] = useState(1)
  const [sparklinePoints, setSparklinePoints] = useState(60)
  const [statsRetention, setStatsRetention] = useState(7)
  const [showMonitoring, setShowMonitoring] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/settings/cli-paths')
      .then(r => r.json())
      .then(setCliPaths)
      .catch(() => {})
  }, [])

  function handleCliChange(cli: CliName) {
    setCliName(cli)
    const tool = cliTools.find(t => t.value === cli)
    if (tool) {
      setName(tool.defaultName)
    }
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
        maxTurns,
        status: 'available',
        snapshotInterval,
        sparklinePoints,
        statsRetention,
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">{t('cliTool')}</label>
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
              <i className={`${t.icon} text-xl w-6 text-center`} />
              <div>
                <div className={`text-base font-bold ${cliName === t.value ? 'text-ive-green' : 'text-ive-text'}`}>
                  {t.label}
                </div>
                <div className="text-base text-ive-text-muted">{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Agent 이름 */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">{t('agentName')} <span className="text-ive-red">*</span></label>
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">{t('avatar')}</label>
        <AvatarSelector value={avatar} onChange={setAvatar} />
      </div>

      {/* 버전 (선택) */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
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
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          <i className="fa-solid fa-repeat mr-1" />{t('maxTurns')}
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
              onClick={() => setMaxTurns(v => Math.min(userMaxTurns > 0 ? userMaxTurns : 1000, v + 10))}
              className="px-2.5 py-3 text-ive-text-muted hover:text-ive-green hover:bg-ive-green/10 transition-colors text-base font-black"
            >+</button>
          </div>
          {userMaxTurns > 0 && <span className="text-[10px] text-ive-amber shrink-0">max {userMaxTurns}</span>}
          <div className="flex gap-1 flex-1 min-w-0">
            {[50, 100, 200].filter(v => userMaxTurns <= 0 || v <= userMaxTurns).map(v => (
              <button key={v} type="button" onClick={() => setMaxTurns(v)}
                className={`flex-1 py-3 rounded-lg text-sm font-black border transition-all ${maxTurns === v ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
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
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{snapshotInterval}</span>
                  <button type="button" onClick={() => setSnapshotInterval(v => Math.min(60, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[1, 5, 10].map(v => (
                    <button key={v} type="button" onClick={() => setSnapshotInterval(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-black border transition-all ${snapshotInterval === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
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
                  <button type="button" onClick={() => setSparklinePoints(v => Math.max(10, v - 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{sparklinePoints}</span>
                  <button type="button" onClick={() => setSparklinePoints(v => Math.min(200, v + 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[30, 60, 120].map(v => (
                    <button key={v} type="button" onClick={() => setSparklinePoints(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-black border transition-all ${sparklinePoints === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
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
                  <button type="button" onClick={() => setStatsRetention(v => Math.max(1, v - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-black text-ive-text border-x border-ive-border">{statsRetention}</span>
                  <button type="button" onClick={() => setStatsRetention(v => Math.min(90, v + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-black">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[7, 14, 30].map(v => (
                    <button key={v} type="button" onClick={() => setStatsRetention(v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-black border transition-all ${statsRetention === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
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
        <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">
          <i className="fa-solid fa-circle-exclamation mr-1" />{error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || limitReached}
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-base active:bg-ive-green/80 transition-colors mt-2 disabled:opacity-50"
      >
        {loading ? (<><i className="fa-solid fa-spinner fa-spin mr-1.5" />{tc('creating')}</>) : (<><i className="fa-solid fa-robot mr-1.5" />{t('addAgent')}</>)}
      </button>
    </form>
  )
}
