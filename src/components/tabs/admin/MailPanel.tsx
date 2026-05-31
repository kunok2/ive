'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import BroadcastView from './BroadcastView'
import ReportScheduleView from './ReportScheduleView'
import SendLogView from './SendLogView'

// ── Mail Panel ──
type MailSubView = 'broadcast' | 'reports' | 'logs'

export default function MailPanel() {
  const t = useTranslations('admin')
  const [view, setView] = useState<MailSubView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('admin-mail-subview')
      if (saved === 'broadcast' || saved === 'reports' || saved === 'logs') return saved
    }
    return 'broadcast'
  })

  const handleSetView = (v: MailSubView) => {
    setView(v)
    localStorage.setItem('admin-mail-subview', v)
  }

  const views: { key: MailSubView; label: string; icon: string }[] = [
    { key: 'broadcast', label: t('mailSend'), icon: 'fa-solid fa-paper-plane' },
    { key: 'reports', label: t('reportLabel'), icon: 'fa-solid fa-file-lines' },
    { key: 'logs', label: t('sendHistory'), icon: 'fa-solid fa-clock-rotate-left' },
  ]

  return (
    <main className="flex-1 flex flex-col min-h-0">
      {/* 서브뷰 토글 */}
      <div className="pb-2 shrink-0">
        <div className="flex gap-1.5">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => handleSetView(v.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                view === v.key
                  ? 'bg-ive-green text-ive-bg-deep'
                  : 'bg-ive-bg-card text-ive-text-dim'
              }`}
            >
              <i className={`${v.icon} mr-1`} />{v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'broadcast' && <BroadcastView />}
      {view === 'reports' && <ReportScheduleView />}
      {view === 'logs' && <SendLogView />}
    </main>
  )
}
