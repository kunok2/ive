'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateFull } from '@/lib/format-date'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { useToast } from '@/components/ui/Toast'
import { transitionTarget } from '@/lib/stage-transitions'

interface MRInfo {
  iid: number
  title: string
  state: string
  source_branch: string
  target_branch: string
  merge_status: string
  has_conflicts: boolean
  web_url: string
  changes_count: string | null
  user_notes_count: number
  created_at: string
  merged_at: string | null
  merged_by: { name: string } | null
  projectName?: string
}

interface Props {
  projectId: string
  issueIid: number
  /** MR 데이터 로드/표시로 섹션 높이가 바뀐 직후 호출 (부모가 채팅 스크롤 보정용) */
  onLayoutChange?: () => void
  /** 이슈의 현재 단계 — 'verifying' 에서 머지하면 검증을 바로 마무리할지 묻는다 */
  stage?: string
  /** 검증 완료 처리 후 이슈·노트 갱신 */
  onRefreshAll?: () => Promise<void> | void
}

export default function MRReviewSection({ projectId, issueIid, onLayoutChange, stage, onRefreshAll }: Props) {
  const router = useRouter()
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('mr')
  const td = useTranslations('dialog')
  const { watchPipeline, toast } = useToast()
  const [mr, setMr] = useState<MRInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [notifyOnComplete, setNotifyOnComplete] = useState(true)
  const [error, setError] = useState('')
  const slackConnected = !!state.user?.slackUserId

  const fetchMR = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${issueIid}/mr`)
      if (!res.ok) throw new Error('Failed to fetch MR')
      const data = await res.json()
      setMr(data.mr)
    } catch (err: any) {
      setMr(null)
      setError(err.message || 'Failed to fetch MR')
    } finally {
      setLoading(false)
    }
  }, [projectId, issueIid])

  useEffect(() => { fetchMR() }, [fetchMR])

  // 로딩 완료/MR 표시로 섹션 높이가 바뀐 직후 부모에 알림 (늦게 그려지며 아래 채팅을 밀어내는 문제 보정)
  useEffect(() => { onLayoutChange?.() }, [loading, mr]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMerge() {
    setMerging(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${issueIid}/mr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', notify: slackConnected && notifyOnComplete }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast(data.error || 'Merge failed', 'error')
        throw new Error(data.error || 'Merge failed')
      }
      await fetchMR()
      if (stage === 'verifying') setShowFinishConfirm(true)
      if (mr) {
        watchPipeline({
          projectId,
          issueIid,
          mrIid: mr.iid,
          label: `${mr.projectName ? `[${mr.projectName}] ` : ''}!${mr.iid} ${mr.source_branch}`,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  // 머지 직후 「예」 — 검증 코멘트를 남기고 검증을 완료(확인 대기)로 올린다
  async function handleFinishVerify() {
    setError('')
    try {
      const to = transitionTarget('verifying', 'approve')
      const prefix = to === 'confirm_waiting' ? '**검증 → 확인대기**\n\n' : ''
      const noteRes = await fetch(`/api/projects/${projectId}/issues/${issueIid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: prefix + t('finishVerifyComment', { iid: mr?.iid ?? 0 }) }),
      })
      if (!noteRes.ok) {
        const data = await noteRes.json().catch(() => ({}))
        toast(data.error || 'Comment failed', 'error'); return
      }
      const res = await fetch(`/api/projects/${projectId}/issues/${issueIid}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'verifying', action: 'approve' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || `Error: ${res.status}`, 'error')
      } else {
        toast(t('finishVerifyDone'), 'success')
      }
      await onRefreshAll?.()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error')
    }
  }

  async function handleClose() {
    setClosing(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${issueIid}/mr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast(data.error || 'Close failed', 'error')
        throw new Error(data.error || 'Close failed')
      }
      await fetchMR()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Close failed')
    } finally {
      setClosing(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6 bg-ive-bg-card rounded-lg p-4 border border-ive-border-subtle animate-pulse">
        <div className="h-4 bg-ive-bg-deep rounded w-1/3 mb-3" />
        <div className="h-3 bg-ive-bg-deep rounded w-2/3" />
      </div>
    )
  }

  if (!mr) return null

  const isMerged = mr.state === 'merged'
  const canMerge = mr.state === 'opened' && !mr.has_conflicts && mr.merge_status !== 'cannot_be_merged'
  const hasConflicts = mr.has_conflicts || mr.merge_status === 'cannot_be_merged'

  return (
    <>
      <div className="mt-6 bg-ive-bg-card rounded-lg border border-ive-border-subtle overflow-hidden">
        <div className="px-4 py-3 border-b border-ive-border-dark flex items-center gap-2">
          <i className="fa-solid fa-code-merge text-ive-cyan" />
          <span className="text-sm font-bold text-ive-text tracking-wider">{t('workResult')}</span>
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <div className="text-base font-bold text-ive-green-pale truncate">
                !{mr.iid} {mr.title}
              </div>
              <div className="text-sm text-ive-text-muted mt-1 flex items-center gap-1.5 flex-wrap">
                <code className="text-xs bg-ive-bg-deep px-1.5 py-0.5 rounded">{mr.source_branch}</code>
                <i className="fa-solid fa-arrow-right text-xs text-ive-text-dim" />
                <code className="text-xs bg-ive-bg-deep px-1.5 py-0.5 rounded">{mr.target_branch}</code>
              </div>
            </div>
          </div>

          {/* 상태 표시 */}
          <div className="flex items-center gap-2 mb-4">
            {isMerged ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-ive-cyan/15 text-ive-cyan px-2 py-1 rounded-lg">
                <i className="fa-solid fa-code-merge" /> {t('mergeComplete')}
              </span>
            ) : hasConflicts ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-ive-red/15 text-ive-red px-2 py-1 rounded-lg">
                <i className="fa-solid fa-triangle-exclamation" /> {t('conflict')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-ive-green/15 text-ive-green px-2 py-1 rounded-lg">
                <i className="fa-solid fa-circle-check" /> {t('readyToMerge')}
              </span>
            )}
            {mr.changes_count && (
              <span className="text-xs text-ive-text-dim">
                {t('changedFiles', { count: mr.changes_count })}
              </span>
            )}
          </div>

          {error && (
            <div className="mb-3 text-sm text-ive-red bg-ive-red/10 rounded-lg px-3 py-2 border border-ive-red/20">
              <i className="fa-solid fa-circle-exclamation mr-1" />{error}
            </div>
          )}

          {/* 머지 완료 정보 */}
          {isMerged && mr.merged_at && (
            <div className="text-xs text-ive-text-dim mb-3">
              {mr.merged_by?.name && <span>{t('mergedBy', { name: mr.merged_by.name, date: formatDateFull(mr.merged_at, userLocale, userTz) })}</span>}
              {!mr.merged_by?.name && <span>{formatDateFull(mr.merged_at, userLocale, userTz)}</span>}
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/issues/${projectId}/${issueIid}/mr`)}
              className="flex-1 text-sm font-bold text-ive-cyan bg-ive-cyan/10 px-3 py-2.5 rounded-lg active:scale-[0.98] transition-all hover:bg-ive-cyan/15"
            >
              <i className="fa-solid fa-code mr-1.5" />{t('codeReview')}
            </button>
            {!isMerged && (
              <>
                <button
                  onClick={() => canMerge && setShowMergeConfirm(true)}
                  disabled={!canMerge || merging || closing}
                  className={`flex-1 text-sm font-bold px-3 py-2.5 rounded-lg active:scale-[0.98] transition-all ${
                    canMerge
                      ? 'text-ive-green bg-ive-green/10 hover:bg-ive-green/15'
                      : 'text-ive-text-dim bg-ive-bg-deep cursor-not-allowed'
                  }`}
                >
                  {merging ? (
                    <><i className="fa-solid fa-spinner fa-spin mr-1.5" />{t('merging')}</>
                  ) : hasConflicts ? (
                    <><i className="fa-solid fa-ban mr-1.5" />{t('cannotMerge')}</>
                  ) : (
                    <><i className="fa-solid fa-code-merge mr-1.5" />{t('merge')}</>
                  )}
                </button>
                <button
                  onClick={() => setShowCloseConfirm(true)}
                  disabled={merging || closing}
                  className="text-sm font-bold text-ive-red/70 bg-ive-red/5 px-3 py-2.5 rounded-lg active:scale-[0.98] transition-all hover:bg-ive-red/10"
                >
                  {closing ? (
                    <i className="fa-solid fa-spinner fa-spin" />
                  ) : (
                    <><i className="fa-solid fa-xmark mr-1.5" />{t('closeMR')}</>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showMergeConfirm}
        onClose={() => setShowMergeConfirm(false)}
        onConfirm={handleMerge}
        title={td('mrMergeTitle')}
        message={td('mrMergeConfirm', { iid: mr?.iid ?? 0, source: mr?.source_branch ?? '', target: mr?.target_branch ?? '' })}
        confirmLabel={t('merge')}
        extra={
          slackConnected ? (
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={notifyOnComplete}
                onChange={e => setNotifyOnComplete(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 rounded accent-ive-cyan cursor-pointer"
              />
              <span className="text-sm font-bold text-ive-text-muted leading-snug">
                {t('notifyWhenDone')}
              </span>
            </label>
          ) : (
            <p className="text-xs text-ive-text-dim leading-snug">
              <i className="fa-brands fa-slack mr-1.5" />{t('slackNotConnected')}
            </p>
          )
        }
      />
      <ConfirmModal
        open={showFinishConfirm}
        onClose={() => setShowFinishConfirm(false)}
        onConfirm={handleFinishVerify}
        title={t('finishVerifyTitle')}
        message={t('finishVerifyMessage')}
        confirmLabel={t('finishVerifyYes')}
      />
      <ConfirmModal
        open={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={handleClose}
        title={td('mrCloseTitle')}
        message={td('mrCloseConfirm', { iid: mr?.iid ?? 0, source: mr?.source_branch ?? '' })}
        confirmLabel={t('closeMR')}
        danger
      />
    </>
  )
}
