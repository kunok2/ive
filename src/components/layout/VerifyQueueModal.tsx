'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Modal from '@/components/ui/Modal'

interface QueueItem {
  projectId: string
  projectName: string
  projectColor: string
  issueIid: number
  issueTitle: string
  stage: string
  waitingSince: string | null
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function VerifyQueueModal({ open, onClose }: Props) {
  const router = useRouter()
  const t = useTranslations('verifyQueue')
  const tStage = useTranslations('stage')
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(false)
    fetch('/api/me/verifier/queue')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('fetch failed')))
      .then(d => { if (!cancelled) setItems(Array.isArray(d.issues) ? d.issues : []) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const go = (item: QueueItem) => {
    onClose()
    router.push(`/issues/${item.projectId}/${item.issueIid}`)
  }

  return (
    <Modal open={open} onClose={onClose} title={t('title')}>
      {loading ? (
        <p className="text-sm text-ive-text-dim text-center py-8">{t('loading')}</p>
      ) : error ? (
        <p className="text-sm text-ive-red text-center py-8">{t('loadFailed')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ive-text-dim text-center py-8">{t('empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(item => (
            <button
              key={`${item.projectId}-${item.issueIid}`}
              onClick={() => go(item)}
              className="w-full text-left rounded-lg bg-ive-bg-deep border border-ive-border-dark px-3 py-2.5 hover:border-ive-amber/50 active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: item.projectColor || '#888' }}
                />
                <span className="text-xs font-bold text-ive-text-muted truncate">{item.projectName}</span>
                <span className="text-xs font-bold text-ive-text-secondary shrink-0">#{item.issueIid}</span>
                <span className="ml-auto text-[10px] font-bold text-ive-amber bg-ive-amber/15 border border-ive-amber/30 rounded-lg px-1.5 py-0.5 shrink-0">
                  {tStage(item.stage)}
                </span>
              </div>
              <p className="text-sm font-bold text-ive-text truncate">{item.issueTitle || `#${item.issueIid}`}</p>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
