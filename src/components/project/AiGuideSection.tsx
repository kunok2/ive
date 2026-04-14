'use client'

import { useState, useEffect } from 'react'
import { Project } from '@/types'
import { useTranslations } from 'next-intl'

export interface AiGuideSectionProps {
  existing: Project
}

export default function AiGuideSection({ existing }: AiGuideSectionProps) {
  const t = useTranslations('project')

  const [aiGuideStatus, setAiGuideStatus] = useState<{ path: string; hasIveSection: boolean }[] | null>(null)
  const [aiGuideInstalling, setAiGuideInstalling] = useState(false)
  const [aiGuideResult, setAiGuideResult] = useState<{ path: string; created: boolean; updated: boolean; unchanged: boolean; error?: string }[] | null>(null)
  const [aiGuideMrUrl, setAiGuideMrUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/projects/${existing.id}/ai-guide`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAiGuideStatus(data.files || null) })
      .catch(() => { /* ignore */ })
  }, [existing.id])

  return (
    <div className="border-t border-ive-border-dark pt-3">
      <p className="text-sm font-bold text-ive-text-muted mb-1">
        <i className="fa-solid fa-robot mr-1.5 text-xs" />
        {t('aiGuide')}
      </p>
      <p className="text-xs text-ive-text-dim mb-3 ml-5">{t('aiGuideDescription')}</p>
      <div className="flex items-center gap-2 ml-5">
        <button
          type="button"
          onClick={async () => {
            setAiGuideInstalling(true)
            setAiGuideResult(null)
            setAiGuideMrUrl(null)
            try {
              const res = await fetch(`/api/projects/${existing.id}/ai-guide`, { method: 'POST' })
              const data = await res.json()
              setAiGuideResult(data.results || null)
              setAiGuideMrUrl(data.mrUrl || null)
              const statusRes = await fetch(`/api/projects/${existing.id}/ai-guide`)
              if (statusRes.ok) {
                const sData = await statusRes.json()
                setAiGuideStatus(sData.files || null)
              }
            } catch {
              setAiGuideResult([{ path: 'CLAUDE.md', created: false, updated: false, unchanged: false, error: t('aiGuideInstallFailed') }])
            }
            setAiGuideInstalling(false)
          }}
          disabled={aiGuideInstalling}
          className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40"
        >
          {aiGuideInstalling ? <i className="fa-solid fa-circle-notch fa-spin mr-1" /> : <i className="fa-solid fa-wand-magic-sparkles mr-1" />}
          {t('aiGuideInstall')}
        </button>
        {aiGuideStatus && aiGuideStatus.map(f => (
          <span key={f.path} className={`text-xs flex items-center gap-1 ${f.hasIveSection ? 'text-ive-green' : 'text-ive-text-dim'}`}>
            <i className={`fa-solid ${f.hasIveSection ? 'fa-circle-check' : 'fa-circle-minus'}`} />
            {f.path}
          </span>
        ))}
      </div>
      {aiGuideResult && (
        <div className="mt-2 ml-5 space-y-1">
          {aiGuideResult.map(r => (
            <div key={r.path} className={`text-xs flex items-center gap-1.5 ${r.error ? 'text-ive-red' : r.unchanged ? 'text-ive-text-dim' : 'text-ive-green'}`}>
              <i className={`fa-solid ${r.error ? 'fa-circle-xmark' : r.unchanged ? 'fa-circle-minus' : 'fa-circle-check'}`} />
              <span className="font-bold">{r.path}</span>
              <span>{r.error ? r.error : r.unchanged ? t('aiGuideUnchanged') : r.created ? t('aiGuideCreated') : t('aiGuideUpdated')}</span>
            </div>
          ))}
        </div>
      )}
      {aiGuideMrUrl && (
        <div className="mt-2 ml-5 p-2.5 rounded-lg bg-ive-cyan/10 border border-ive-cyan/20">
          <p className="text-xs text-ive-cyan font-bold mb-1">
            <i className="fa-solid fa-code-merge mr-1" />
            {t('aiGuideMrCreated')}
          </p>
          <a
            href={aiGuideMrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-ive-cyan underline hover:text-ive-cyan/80 break-all"
          >
            {aiGuideMrUrl}
          </a>
          <p className="text-xs text-ive-text-dim mt-1.5">
            <i className="fa-solid fa-circle-info mr-1" />
            {t('aiGuideMrMergeHint')}
          </p>
        </div>
      )}
    </div>
  )
}
