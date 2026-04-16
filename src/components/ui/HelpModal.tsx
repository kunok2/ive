'use client'

import { useTranslations } from 'next-intl'
import { useTab } from '@/lib/tab-context'

interface HelpModalProps {
  open: boolean
  onClose: () => void
  onShowIntro: () => void
}

const tabSections = [
  { key: 'projects', icon: 'fa-solid fa-folder', tips: 3 },
  { key: 'agents', icon: 'fa-solid fa-robot', tips: 3 },
  { key: 'issues', icon: 'fa-solid fa-list-check', tips: 3 },
  { key: 'reports', icon: 'fa-solid fa-chart-line', tips: 3 },
  { key: 'admin', icon: 'fa-solid fa-gear', tips: 3 },
] as const

export default function HelpModal({ open, onClose, onShowIntro }: HelpModalProps) {
  const t = useTranslations('help')
  const { activeTab } = useTab()

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className="relative w-full max-w-sm bg-ive-bg-card border border-ive-border rounded-2xl max-h-[80vh] flex flex-col animate-slide-up overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-dark shrink-0">
          <h2 className="text-base font-bold text-ive-text">
            <i className="fa-solid fa-circle-question text-ive-cyan mr-2" />
            {t('title')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ive-text-muted hover:bg-ive-bg-deep transition-colors text-xl"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">
            {tabSections.map(({ key, icon, tips }) => {
              const isActive = activeTab === key
              return (
                <div
                  key={key}
                  className={`rounded-lg p-3 transition-colors ${
                    isActive
                      ? 'bg-ive-cyan/10 border border-ive-cyan/20'
                      : 'bg-ive-bg/50 border border-ive-border-dark'
                  }`}
                >
                  <h3 className={`text-sm font-bold mb-2 ${isActive ? 'text-ive-cyan' : 'text-ive-text'}`}>
                    <i className={`${icon} mr-1.5`} />
                    {t(key as 'projects' | 'agents' | 'issues' | 'reports' | 'admin')}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {Array.from({ length: tips }, (_, i) => (
                      <li key={i} className="text-xs font-bold text-ive-text-secondary flex items-start gap-1.5">
                        <i className="fa-solid fa-chevron-right text-ive-text-dim mt-0.5 shrink-0" style={{ fontSize: '8px' }} />
                        <span>{t(`${key}Tip${i + 1}` as keyof IntlMessages['help'])}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-ive-border-dark shrink-0">
          <button
            onClick={() => { onClose(); onShowIntro() }}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-ive-cyan border border-ive-cyan/30 hover:bg-ive-cyan/10 transition-colors"
          >
            <i className="fa-solid fa-circle-play mr-1.5" />
            {t('showIntro')}
          </button>
        </div>
      </div>
    </div>
  )
}
