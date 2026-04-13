'use client'

import Modal from '@/components/ui/Modal'
import { useTranslations } from 'next-intl'

interface LabelCheckModalProps {
  open: boolean
  onClose: () => void
  labelStatus: { label: string; exists: boolean }[]
  labelCreating: boolean
  labelCreateMsg: string | null
  selectedProjectId: string
  onAutoCreate: () => void
}

export default function LabelCheckModal({
  open,
  onClose,
  labelStatus,
  labelCreating,
  labelCreateMsg,
  selectedProjectId,
  onAutoCreate,
}: LabelCheckModalProps) {
  const tIssue = useTranslations('issue')
  const tProject = useTranslations('project')
  const tCommon = useTranslations('common')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tIssue('labelModalTitle')}
      closeOnBackdrop={false}
    >
      <div className="flex flex-col gap-4">
        <div className="bg-ive-amber/10 border border-ive-amber/30 rounded-lg p-3">
          <div className="text-sm font-bold text-ive-amber mb-1">
            <i className="fa-solid fa-triangle-exclamation mr-1.5" />
            {tIssue('labelRequiredDesc')}
          </div>
          <p className="text-xs font-bold text-ive-text-muted leading-relaxed">
            {tIssue('labelTrackingDesc')}
            <br />
            <span className="text-ive-text-dim">{tIssue('labelAutoCreateHint')}</span>
          </p>
        </div>

        <div className="space-y-1.5">
          {labelStatus.length === 0 ? (
            <div className="text-sm font-bold text-ive-text-dim text-center py-2">
              <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
              {tIssue('labelStatusChecking')}
            </div>
          ) : (
            labelStatus.map(s => (
              <div
                key={s.label}
                className={`flex items-center gap-2 text-sm font-bold px-3 py-2 rounded-lg border ${
                  s.exists
                    ? 'border-ive-green/30 bg-ive-green/10 text-ive-green'
                    : 'border-ive-red/30 bg-ive-red/10 text-ive-red'
                }`}
              >
                <i className={`fa-solid ${s.exists ? 'fa-circle-check' : 'fa-circle-xmark'}`} />
                <span className="flex-1">{s.label}</span>
                <span className="text-xs text-ive-text-dim">
                  {s.exists ? tIssue('labelStatusExists') : tIssue('labelStatusMissing')}
                </span>
              </div>
            ))
          )}
        </div>

        {labelCreateMsg && (
          <div className="text-sm font-bold text-ive-amber bg-ive-amber/10 rounded-lg px-3 py-2 border border-ive-amber/30">
            <i className="fa-solid fa-circle-exclamation mr-1.5" />
            {labelCreateMsg}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-white/5 border border-ive-border-subtle text-ive-text-muted font-bold py-3 rounded-lg text-sm active:opacity-80 transition-all"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            disabled={labelCreating || !selectedProjectId || labelStatus.every(s => s.exists)}
            onClick={onAutoCreate}
            className="flex-[2] bg-ive-green-dark text-white font-bold py-3 rounded-lg text-sm active:opacity-90 transition-all disabled:opacity-40"
          >
            {labelCreating ? (
              <><i className="fa-solid fa-circle-notch fa-spin mr-1.5" />{tCommon('creating')}</>
            ) : (
              <><i className="fa-solid fa-wand-magic-sparkles mr-1.5" />{tIssue('autoCreateLabels')}</>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
