'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

interface MRItem {
  iid: number
  title: string
  source_branch: string
  target_branch: string
  has_conflicts: boolean
  web_url: string
}

interface Props {
  projectId: string
  projectColor: string
  onClose: () => void
}

export default function ConflictResolutionPanel({ projectId, projectColor, onClose }: Props) {
  const t = useTranslations('conflict')
  const router = useRouter()
  const [mrs, setMrs] = useState<MRItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [merging, setMerging] = useState(false)
  const [mergeResults, setMergeResults] = useState<{ iid: number; success: boolean; error?: string }[]>([])

  const fetchConflicts = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/conflicts`)
      if (res.ok) {
        const data = await res.json()
        setMrs(data.all ?? [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => {
    fetchConflicts()
    const timer = setInterval(fetchConflicts, 60000)
    return () => clearInterval(timer)
  }, [fetchConflicts])

  const conflicts = mrs.filter(mr => mr.has_conflicts)
  const ready = mrs.filter(mr => !mr.has_conflicts)

  const toggleSelect = (iid: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(iid)) next.delete(iid)
      else next.add(iid)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === mrs.length) setSelected(new Set())
    else setSelected(new Set(mrs.map(mr => mr.iid)))
  }

  const [closing, setClosing] = useState(false)

  const handleMerge = async () => {
    if (selected.size === 0) return
    setMerging(true)
    setMergeResults([])
    try {
      const res = await fetch(`/api/projects/${projectId}/conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sequential_merge', mrIids: Array.from(selected) }),
      })
      if (res.ok) {
        const data = await res.json()
        setMergeResults(data.results ?? [])
        setSelected(new Set())
        setTimeout(fetchConflicts, 2000)
      }
    } catch { /* ignore */ }
    finally { setMerging(false) }
  }

  const handleClose = async () => {
    if (selected.size === 0) return
    setClosing(true)
    setMergeResults([])
    try {
      const res = await fetch(`/api/projects/${projectId}/conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', mrIids: Array.from(selected) }),
      })
      if (res.ok) {
        const data = await res.json()
        setMergeResults(data.results ?? [])
        setSelected(new Set())
        setTimeout(fetchConflicts, 2000)
      }
    } catch { /* ignore */ }
    finally { setClosing(false) }
  }

  const renderMR = (mr: MRItem) => {
    const result = mergeResults.find(r => r.iid === mr.iid)
    return (
      <div
        key={mr.iid}
        className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
          mr.has_conflicts
            ? 'bg-ive-red/5 border-ive-red/20'
            : result?.success
              ? 'bg-ive-green/5 border-ive-green/20'
              : 'bg-ive-bg-card border-ive-border-subtle'
        }`}
      >
        <input
          type="checkbox"
          checked={selected.has(mr.iid)}
          onChange={() => toggleSelect(mr.iid)}
          className="accent-ive-green shrink-0"
          disabled={merging}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <button
              onClick={() => {
                const issueMatch = mr.source_branch.match(/^dev-(\d+)$/)
                if (issueMatch) {
                  router.push(`/issues/${projectId}/${issueMatch[1]}`)
                } else {
                  router.push(`/issues/${projectId}/${mr.iid}`)
                }
              }}
              className="text-sm font-black hover:underline transition-colors"
              style={{ color: projectColor }}
              title={t('openIssue')}
            >
              !{mr.iid}
            </button>
            {mr.has_conflicts && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-ive-red/15 text-ive-red border border-ive-red/30">
                {t('conflict')}
              </span>
            )}
            {result && (
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                result.success
                  ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
                  : 'bg-ive-red/15 text-ive-red border border-ive-red/30'
              }`}>
                {result.success ? (result.error === 'closed' ? t('closed') : t('merged')) : t('mergeFailed')}
              </span>
            )}
          </div>
          <p className="text-sm text-ive-text truncate">{mr.title}</p>
          <p className="text-xs text-ive-text-dim mt-0.5">
            <i className="fa-solid fa-code-branch mr-1" />
            {mr.source_branch} <i className="fa-solid fa-arrow-right mx-1 text-[10px]" /> {mr.target_branch}
          </p>
        </div>
        <button
          onClick={() => window.open(mr.web_url, '_blank')}
          className="shrink-0 text-ive-text-dim hover:text-ive-text transition-colors p-1"
          title={t('openExternal')}
        >
          <i className="fa-solid fa-arrow-up-right-from-square text-xs" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 border-t border-ive-purple/20">
      <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark shrink-0 flex items-center justify-between">
        <span className="text-xs font-bold text-ive-purple uppercase tracking-widest">
          <i className="fa-solid fa-code-merge mr-1" />
          {t('title')} —{conflicts.length > 0 && <>{' '}<span className="text-ive-red">{t('conflictCount', { count: conflicts.length })}</span> /</>} {t('totalMRs', { count: mrs.length })}
        </span>
        <button onClick={onClose} className="text-ive-text-dim hover:text-ive-text transition-colors">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-center py-10 text-ive-text-dim text-sm">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2 block" />
            {t('loading')}
          </div>
        ) : mrs.length === 0 ? (
          <div className="text-center py-10 text-ive-text-dim text-sm">
            <i className="fa-solid fa-check-circle text-2xl mb-2 block text-ive-green" />
            {t('noMRs')}
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {/* 전체 선택 */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size === mrs.length && mrs.length > 0}
                onChange={toggleAll}
                className="accent-ive-green"
                disabled={merging}
              />
              <span className="text-xs font-bold text-ive-text-dim">{t('selectAll')}</span>
            </div>

            {/* 머지 가능 */}
            {ready.length > 0 && (
              <>
                <div className="text-xs font-bold text-ive-green uppercase tracking-widest">
                  <i className="fa-solid fa-check mr-1" />{t('readyToMerge')} ({ready.length})
                </div>
                <div className="space-y-2">
                  {ready.map(renderMR)}
                </div>
              </>
            )}

            {/* 충돌 있음 */}
            {conflicts.length > 0 && (
              <>
                <div className="text-xs font-bold text-ive-red uppercase tracking-widest mt-2">
                  <i className="fa-solid fa-triangle-exclamation mr-1" />{t('hasConflicts')} ({conflicts.length})
                </div>
                <div className="space-y-2">
                  {conflicts.map(renderMR)}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 하단 액션 바 */}
      {mrs.length > 0 && (
        <div className="px-3 py-2 border-t border-ive-border-dark bg-ive-bg-deep/50 shrink-0 flex items-center justify-between">
          <span className="text-xs text-ive-text-dim">
            {t('selectedCount', { count: selected.size })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              disabled={closing || merging || selected.size === 0}
              className="h-8 px-3 rounded-full text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-ive-red/10 text-ive-red/70 border border-ive-red/20 hover:bg-ive-red/15"
            >
              {closing ? (
                <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('closingMR')}</>
              ) : (
                <><i className="fa-solid fa-xmark mr-1" />{t('closeMR')}</>
              )}
            </button>
            <button
              onClick={handleMerge}
              disabled={merging || closing || selected.size === 0}
              className="h-8 px-3 rounded-full text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-ive-green/15 text-ive-green border border-ive-green/30 hover:bg-ive-green/25"
            >
              {merging ? (
                <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('merging')}</>
              ) : (
                <><i className="fa-solid fa-code-merge mr-1" />{t('sequentialMerge')}</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
