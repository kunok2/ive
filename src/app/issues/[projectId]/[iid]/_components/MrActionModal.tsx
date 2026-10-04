'use client'

import { useTranslations } from 'next-intl'
import Modal from '@/components/ui/Modal'

interface MrInfo {
  iid: number
  title: string
  web_url: string
  has_conflicts?: boolean
}

interface MrActionModalProps {
  open: boolean
  mr: MrInfo | null
  busy: boolean
  onChoice: (choice: 'merge' | 'close' | 'none') => void
  onClose: () => void
}

export default function MrActionModal({ open, mr, busy, onChoice, onClose }: MrActionModalProps) {
  const t = useTranslations('issue')
  const tc = useTranslations('common')
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('mrModal.title')} size="sm">
      {mr && (
        <div className="p-4 space-y-4">
          <p className="text-sm text-ive-text-muted">
            {t('mrModal.desc')}
          </p>
          <a
            href={mr.web_url}
            target="_blank"
            rel="noreferrer"
            className="block bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 hover:border-ive-cyan/40 transition-colors"
          >
            <div className="text-xs font-mono text-ive-cyan font-bold">!{mr.iid}</div>
            <div className="text-sm text-ive-text truncate">{mr.title}</div>
            {mr.has_conflicts && (
              <div className="text-xs text-ive-red font-bold mt-1">
                <i className="fa-solid fa-triangle-exclamation mr-1" />{t('mrModal.conflicts')}
              </div>
            )}
          </a>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onChoice('merge')}
              disabled={busy || mr.has_conflicts}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-ive-cyan border border-ive-cyan/30 bg-ive-cyan/5 hover:bg-ive-cyan/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <i className="fa-solid fa-code-merge mr-1.5" />{t('mrModal.merge')}
            </button>
            <button
              onClick={() => onChoice('close')}
              disabled={busy}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-ive-red border border-ive-red/30 bg-ive-red/5 hover:bg-ive-red/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <i className="fa-solid fa-xmark mr-1.5" />{t('mrModal.close')}
            </button>
            <button
              onClick={() => onChoice('none')}
              disabled={busy}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-ive-text-dim border border-ive-border-dark bg-ive-bg-deep hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <i className="fa-solid fa-arrow-right mr-1.5" />{t('mrModal.keep')}
            </button>
            <button
              onClick={() => !busy && onClose()}
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg text-xs font-bold text-ive-text-dim hover:text-ive-text transition-colors disabled:opacity-40"
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
