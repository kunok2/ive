'use client'

import { use, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import DiffViewer from '@/components/mr/DiffViewer'
import ConfirmModal from '@/components/ui/ConfirmModal'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useToast } from '@/components/ui/Toast'
import { useStore } from '@/lib/store'
import { transitionTarget } from '@/lib/stage-transitions'

interface MRInfo {
  iid: number
  title: string
  state: string
  source_branch: string
  target_branch: string
  has_conflicts: boolean
  web_url: string
}

interface FileChange {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
}

export default function MRDiffPage({ params }: { params: Promise<{ projectId: string; iid: string }> }) {
  const { projectId, iid } = use(params)
  const router = useRouter()
  const t = useTranslations('mr')
  const tc = useTranslations('common')
  const { state } = useStore()
  const slackConnected = !!state.user?.slackUserId
  const [notifyOnComplete, setNotifyOnComplete] = useState(true)
  const [mr, setMr] = useState<MRInfo | null>(null)
  const [changes, setChanges] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [merging, setMerging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [mergeError, setMergeError] = useState('')
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const finishingRef = useRef(false)
  const { toast } = useToast()

  const fetchChanges = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr/changes`)
      if (!res.ok) throw new Error('Failed to fetch MR changes')
      const data = await res.json()
      setMr(data.mr)
      setChanges(data.changes)
    } catch {
      setError(t('loadChangesFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId, iid])

  useEffect(() => { fetchChanges() }, [fetchChanges])

  async function handleMerge() {
    setMerging(true)
    setMergeError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', notify: slackConnected && notifyOnComplete }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast(data.error || 'Merge failed', 'error')
        throw new Error(data.error || 'Merge failed')
      }
      // 검증 중인 이슈면 바로 검증을 마무리할지 묻는다 — 아니면 이전 화면으로
      const stage = await fetch(`/api/projects/${projectId}/issues/${iid}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null)).then(d => d?.stage as string | undefined).catch(() => undefined)
      if (stage === 'verifying') setShowFinishConfirm(true)
      else router.back()
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : t('mergeFailed'))
    } finally {
      setMerging(false)
    }
  }

  // 머지 직후 「예」 — 검증 코멘트를 남기고 검증을 완료(확인 대기)로 올린다
  async function handleFinishVerify() {
    finishingRef.current = true
    try {
      const to = transitionTarget('verifying', 'approve')
      const prefix = to === 'confirm_waiting' ? '**검증 → 확인대기**\n\n' : ''
      const noteRes = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: prefix + t('finishVerifyComment', { iid: mr?.iid ?? 0 }) }),
      })
      if (!noteRes.ok) {
        const data = await noteRes.json().catch(() => ({}))
        toast(data.error || 'Comment failed', 'error'); return
      }
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'verifying', action: 'approve' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || `Error: ${res.status}`, 'error')
      } else {
        toast(t('finishVerifyDone'), 'success')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error')
    } finally {
      router.back()
    }
  }

  async function handleCloseMR() {
    setClosing(true)
    setMergeError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast(data.error || 'Close failed', 'error')
        throw new Error(data.error || 'Close failed')
      }
      router.back()
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : t('closeFailed'))
    } finally {
      setClosing(false)
    }
  }

  // 전체 +/- 통계
  let totalAdded = 0
  let totalRemoved = 0
  for (const c of changes) {
    for (const line of c.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) totalAdded++
      else if (line.startsWith('-') && !line.startsWith('---')) totalRemoved++
    }
  }

  const canMerge = mr && mr.state === 'opened' && !mr.has_conflicts
  const isMerged = mr?.state === 'merged'

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 z-40 w-full max-w-lg desk:max-w-6xl mx-auto bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="px-3 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-ive-green text-base font-bold p-1 hover:bg-ive-green/5 rounded">
              <i className="fa-solid fa-arrow-left mr-1" />{tc('back')}
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold text-ive-green-pale truncate">
                {mr ? t('reviewTitle', { iid: mr.iid }) : t('reviewTitleNoId')}
              </h1>
              {mr && (
                <div className="text-xs text-ive-text-muted flex items-center gap-1 mt-0.5">
                  <code className="bg-ive-bg-deep px-1 rounded">{mr.source_branch}</code>
                  <i className="fa-solid fa-arrow-right text-[8px] text-ive-text-dim" />
                  <code className="bg-ive-bg-deep px-1 rounded">{mr.target_branch}</code>
                  {totalAdded > 0 && <span className="text-ive-green ml-1">+{totalAdded}</span>}
                  {totalRemoved > 0 && <span className="text-ive-red ml-1">-{totalRemoved}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 w-full max-w-lg desk:max-w-6xl mx-auto flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto pl-3 pr-1">
      <main className="pt-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-ive-text-dim" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-circle-exclamation text-3xl text-ive-red mb-3 block" />
            <p className="text-base text-ive-text-muted">{error}</p>
          </div>
        ) : (
          <>
            <div className="text-xs text-ive-text-dim mb-3 px-1">
              {t('changedFiles', { count: changes.length })}
            </div>

            <DiffViewer changes={changes} />
          </>
        )}
      </main>
      </div>

      {/* 항상 보이는 하단 액션 바 — 스크롤과 무관 */}
      {!loading && !error && (
        <div className="shrink-0 px-3 pt-3 pb-20 pad:pb-6 bg-ive-bg-deep border-t border-ive-border-dark">
          {mergeError && (
            <div className="mb-3 text-sm text-ive-red bg-ive-red/10 rounded-lg px-3 py-2 border border-ive-red/20">
              <i className="fa-solid fa-circle-exclamation mr-1" />{mergeError}
            </div>
          )}
          {!isMerged ? (
            <div className="flex gap-2">
              <button
                onClick={() => canMerge && setShowMergeConfirm(true)}
                disabled={!canMerge || merging || closing}
                className={`flex-1 text-base font-bold py-3 rounded-lg active:scale-[0.98] transition-all ${
                  canMerge
                    ? 'text-white bg-ive-green hover:bg-ive-green/90'
                    : 'text-ive-text-dim bg-ive-bg-card border border-ive-border-subtle cursor-not-allowed'
                }`}
              >
                {merging ? (
                  <><i className="fa-solid fa-spinner fa-spin mr-1.5" />{t('merging')}</>
                ) : mr?.has_conflicts ? (
                  <><i className="fa-solid fa-ban mr-1.5" />{t('conflictCannotMerge')}</>
                ) : (
                  <><i className="fa-solid fa-code-merge mr-1.5" />{t('mergeAction')}</>
                )}
              </button>
              <button
                onClick={() => setShowCloseConfirm(true)}
                disabled={merging || closing}
                className="text-base font-bold text-ive-red/70 bg-ive-red/5 px-4 py-3 rounded-lg active:scale-[0.98] transition-all hover:bg-ive-red/10 border border-ive-red/20"
              >
                {closing ? (
                  <i className="fa-solid fa-spinner fa-spin" />
                ) : (
                  <><i className="fa-solid fa-xmark mr-1.5" />{t('discardAction')}</>
                )}
              </button>
            </div>
          ) : (
            <div className="text-center py-3 bg-ive-cyan/10 rounded-lg border border-ive-cyan/20">
              <i className="fa-solid fa-code-merge text-ive-cyan mr-1.5" />
              <span className="text-sm font-bold text-ive-cyan">{t('alreadyMerged')}</span>
            </div>
          )}
        </div>
      )}
      </div>

      <ConfirmModal
        open={showMergeConfirm}
        onClose={() => setShowMergeConfirm(false)}
        onConfirm={handleMerge}
        title={t('confirmMergeTitle')}
        message={`!${mr?.iid} ${mr?.source_branch} → ${mr?.target_branch}\n\n${t('confirmMergeAsk')}`}
        confirmLabel={t('mergeAction')}
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
        onClose={() => { setShowFinishConfirm(false); if (!finishingRef.current) router.back() }}
        onConfirm={handleFinishVerify}
        title={t('finishVerifyTitle')}
        message={t('finishVerifyMessage')}
        confirmLabel={t('finishVerifyYes')}
      />
      <ConfirmModal
        open={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={handleCloseMR}
        title={t('discardTitle')}
        message={`!${mr?.iid} ${mr?.source_branch}\n\n${t('confirmDiscardAsk')}`}
        confirmLabel={t('discardAction')}
        danger
      />

      <MobileTabBar />
    </div>
  )
}
