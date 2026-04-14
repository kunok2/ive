'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Project, ProjectColor, detectProvider } from '@/types'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'

import ColorPickerSection from './ColorPickerSection'
import OAuthImportSection, { type OAuthInfo } from './OAuthImportSection'
import ConnectionSection from './ConnectionSection'
import LabelSection, { type LabelValues } from './LabelSection'
import AiGuideSection from './AiGuideSection'
import ScannerSettingsSection, { type ScannerSettingsValues } from './ScannerSettingsSection'
import SharingSection from './SharingSection'

interface Props {
  existing?: Project
  onSuccess?: () => void
  onCancel?: () => void
}

export default function ProjectForm({ existing, onSuccess, onCancel }: Props) {
  const router = useRouter()
  const { addProject, updateProject } = useStore()
  const t = useTranslations('project')
  const tc = useTranslations('common')

  // --- Core form state ---
  const [color, setColor] = useState<ProjectColor>(existing?.color ?? '#4ade80')
  const [name, setName] = useState(existing?.name ?? '')
  const [repoUrl, setRepoUrl] = useState(existing?.repoUrl ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(existing?.avatarUrl ?? '')

  // OAuth token reuse
  const [oauthInfo, setOauthInfo] = useState<OAuthInfo>({ hasToken: false })
  const [usesOAuthToken, setUsesOAuthToken] = useState(existing?.usesOAuthToken ?? false)

  // Label settings
  const [labelTarget, setLabelTarget] = useState(existing?.labelTarget ?? 'IVE')
  const [labelSchedule, setLabelSchedule] = useState(existing?.labelSchedule ?? 'IVE-S')
  const [labelDev, setLabelDev] = useState(existing?.labelDev ?? 'IVE-D')
  const [labelVerifyWait, setLabelVerifyWait] = useState(existing?.labelVerifyWait ?? 'IVE-W')
  const [labelVerify, setLabelVerify] = useState(existing?.labelVerify ?? 'IVE-V')
  const [labelEnd, setLabelEnd] = useState(existing?.labelEnd ?? 'IVE-E')

  // Scanner / monitoring settings
  const [checkInterval, setCheckInterval] = useState(existing?.checkInterval ?? 1)
  const [snapshotInterval, setSnapshotInterval] = useState(existing?.snapshotInterval ?? 1)
  const [sparklinePoints, setSparklinePoints] = useState(existing?.sparklinePoints ?? 60)
  const [statsRetention, setStatsRetention] = useState(existing?.statsRetention ?? 7)
  const [showToolUsage, setShowToolUsage] = useState(existing?.showToolUsage ?? false)

  // Load OAuth token info
  useEffect(() => {
    fetch('/api/auth/oauth/my-token')
      .then(r => r.ok ? r.json() : { hasToken: false })
      .then(data => {
        setOauthInfo(data)
        if (!existing && data.hasToken) {
          setUsesOAuthToken(true)
        }
      })
      .catch(() => setOauthInfo({ hasToken: false }))
  }, [])

  // --- Derived values ---
  const labelValues: LabelValues = { labelTarget, labelSchedule, labelDev, labelVerifyWait, labelVerify, labelEnd }
  const scannerValues: ScannerSettingsValues = { checkInterval, showToolUsage, snapshotInterval, sparklinePoints, statsRetention }

  function handleLabelChange(field: keyof LabelValues, value: string) {
    const setters: Record<keyof LabelValues, (v: string) => void> = {
      labelTarget: setLabelTarget, labelSchedule: setLabelSchedule,
      labelDev: setLabelDev, labelVerifyWait: setLabelVerifyWait,
      labelVerify: setLabelVerify, labelEnd: setLabelEnd,
    }
    setters[field](value)
  }

  function handleScannerChange<K extends keyof ScannerSettingsValues>(field: K, value: ScannerSettingsValues[K]) {
    const setters: Record<string, (v: any) => void> = {
      checkInterval: setCheckInterval, showToolUsage: setShowToolUsage,
      snapshotInterval: setSnapshotInterval, sparklinePoints: setSparklinePoints,
      statsRetention: setStatsRetention,
    }
    setters[field](value)
  }

  function handleOAuthSelect(data: { name: string; repoUrl: string; avatarUrl?: string }) {
    setName(data.name)
    setRepoUrl(data.repoUrl)
    if (data.avatarUrl) setAvatarUrl(data.avatarUrl)
    setUsesOAuthToken(true)
    setAccessToken('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !repoUrl.trim() || (!existing && !usesOAuthToken && !accessToken.trim())) return

    const projectData = {
      name: name.trim(),
      provider: detectProvider(repoUrl.trim()),
      color,
      repoUrl: repoUrl.trim(),
      authType: 'token' as const,
      gitUsername: '',
      accessToken: usesOAuthToken ? '' : accessToken.trim(),
      usesOAuthToken,
      labelTarget: labelTarget.trim(),
      labelSchedule: labelSchedule.trim() || 'IVE-S',
      labelDev: labelDev.trim() || 'IVE-D',
      labelVerifyWait: labelVerifyWait.trim() || 'IVE-W',
      labelVerify: labelVerify.trim() || 'IVE-V',
      labelEnd: labelEnd.trim() || 'IVE-E',
      showToolUsage,
      checkInterval: Number(checkInterval) || 1,
      lastCheckedAt: existing?.lastCheckedAt ?? null,
      lastScannedIssueCount: existing?.lastScannedIssueCount ?? null,
      lastVerifyWaitingCount: existing?.lastVerifyWaitingCount ?? null,
      scannerActive: existing?.scannerActive ?? false,
      lastError: existing?.lastError ?? null,
      lastErrorAt: existing?.lastErrorAt ?? null,
      sortOrder: existing?.sortOrder ?? 0,
      avatarUrl,
      snapshotInterval,
      sparklinePoints,
      statsRetention,
      lastActivityAt: existing?.lastActivityAt ?? null,
    }

    if (existing) {
      await updateProject({ ...existing, ...projectData })
      onSuccess?.()
      if (!onSuccess) router.push(`/projects/${existing.id}`)
    } else {
      await addProject(projectData)
      onSuccess?.()
      if (!onSuccess) router.push('/')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <ColorPickerSection color={color} onColorChange={setColor} />

      {!existing && oauthInfo.hasToken && (
        <OAuthImportSection oauthInfo={oauthInfo} onSelectProject={handleOAuthSelect} />
      )}

      <ConnectionSection
        existing={existing}
        name={name}
        onNameChange={setName}
        repoUrl={repoUrl}
        onRepoUrlChange={setRepoUrl}
        accessToken={accessToken}
        onAccessTokenChange={setAccessToken}
        usesOAuthToken={usesOAuthToken}
        onUsesOAuthTokenChange={setUsesOAuthToken}
        oauthInfo={oauthInfo}
        avatarUrl={avatarUrl}
        onAvatarUrlChange={setAvatarUrl}
      />

      <ScannerSettingsSection values={scannerValues} onChange={handleScannerChange} />

      <LabelSection existing={existing} values={labelValues} onChange={handleLabelChange} />

      {existing && <AiGuideSection existing={existing} />}

      {existing && <SharingSection existing={existing} />}

      {/* Submit / Cancel buttons */}
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
          className="flex-[2] bg-ive-green-dark text-white font-bold py-4 rounded-lg text-sm active:opacity-90 transition-all"
        >
          <i className={`fa-solid ${existing ? 'fa-check' : 'fa-plus'} mr-2`} />
          {existing ? t('settingsUpdated') : t('createProject')}
        </button>
      </div>
    </form>
  )
}
