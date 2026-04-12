'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import DiffViewer from '@/components/mr/DiffViewer'
import ConfirmModal from '@/components/ui/ConfirmModal'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useToast } from '@/components/ui/Toast'

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
  const [mr, setMr] = useState<MRInfo | null>(null)
  const [changes, setChanges] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [merging, setMerging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [mergeError, setMergeError] = useState('')
  const { toast } = useToast()

  const fetchChanges = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr/changes`)
      if (!res.ok) throw new Error('Failed to fetch MR changes')
      const data = await res.json()
      setMr(data.mr)
      setChanges(data.changes)
    } catch {
      setError('MR 변경사항을 불러올 수 없습니다')
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
        body: JSON.stringify({ action: 'merge' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast(data.error || 'Merge failed', 'error')
        throw new Error(data.error || 'Merge failed')
      }
      router.back()
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : '머지 실패')
    } finally {
      setMerging(false)
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
      setMergeError(err instanceof Error ? err.message : 'MR 닫기 실패')
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
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="px-4 py-3 max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="text-ive-green text-base font-bold p-1 hover:bg-ive-green/5 rounded">
              <i className="fa-solid fa-arrow-left mr-1" />뒤로
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold text-ive-green-pale truncate">
                {mr ? `MR !${mr.iid} 코드 리뷰` : '코드 리뷰'}
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

      <main className="px-4 pt-4 pb-20 max-w-lg mx-auto">
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
              변경 파일 {changes.length}개
            </div>

            <DiffViewer changes={changes} />

            {mergeError && (
              <div className="mt-4 text-sm text-ive-red bg-ive-red/10 rounded-lg px-3 py-2 border border-ive-red/20">
                <i className="fa-solid fa-circle-exclamation mr-1" />{mergeError}
              </div>
            )}

            {/* 머지/닫기 버튼 */}
            {!isMerged && (
              <div className="mt-6 mb-4 flex gap-2">
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
                    <><i className="fa-solid fa-spinner fa-spin mr-1.5" />머지 중...</>
                  ) : mr?.has_conflicts ? (
                    <><i className="fa-solid fa-ban mr-1.5" />충돌로 머지 불가</>
                  ) : (
                    <><i className="fa-solid fa-code-merge mr-1.5" />머지</>
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
                    <><i className="fa-solid fa-xmark mr-1.5" />버림</>
                  )}
                </button>
              </div>
            )}

            {isMerged && (
              <div className="mt-6 mb-4 text-center py-3 bg-ive-cyan/10 rounded-lg border border-ive-cyan/20">
                <i className="fa-solid fa-code-merge text-ive-cyan mr-1.5" />
                <span className="text-sm font-bold text-ive-cyan">이미 머지된 MR입니다</span>
              </div>
            )}
          </>
        )}
      </main>

      <ConfirmModal
        open={showMergeConfirm}
        onClose={() => setShowMergeConfirm(false)}
        onConfirm={handleMerge}
        title="MR 머지 확인"
        message={`!${mr?.iid} ${mr?.source_branch} → ${mr?.target_branch}\n\n이 MR을 머지할까요?`}
        confirmLabel="머지"
      />
      <ConfirmModal
        open={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={handleCloseMR}
        title="MR 버림"
        message={`!${mr?.iid} ${mr?.source_branch}\n\n머지하지 않고 이 MR을 버릴까요?`}
        confirmLabel="버림"
        danger
      />

      <MobileTabBar />
    </div>
  )
}
