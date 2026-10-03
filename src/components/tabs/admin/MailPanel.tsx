'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import BroadcastView from './BroadcastView'
import SocialView from './SocialView'
import PerformanceView from './PerformanceView'
import SendLogView from './SendLogView'

// ── 홍보(Promotion) Panel ── 메일 발송 / SNS 글 / 성과 / 발송 이력
type MailSubView = 'broadcast' | 'social' | 'performance' | 'logs'
const SUB_VIEWS: MailSubView[] = ['broadcast', 'social', 'performance', 'logs']

export default function MailPanel() {
  const t = useTranslations('admin')
  const [view, setView] = useState<MailSubView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('admin-mail-subview')
      if (saved && (SUB_VIEWS as string[]).includes(saved)) return saved as MailSubView
    }
    return 'broadcast'
  })

  const [loadDraftId, setLoadDraftId] = useState<string | null>(null)

  const handleSetView = (v: MailSubView) => {
    setView(v)
    localStorage.setItem('admin-mail-subview', v)
  }

  const views: { key: MailSubView; label: string; icon: string }[] = [
    { key: 'broadcast', label: t('mailSend'), icon: 'fa-solid fa-paper-plane' },
    { key: 'social', label: t('socialPosts'), icon: 'fa-solid fa-share-nodes' },
    { key: 'performance', label: t('performance'), icon: 'fa-solid fa-chart-simple' },
    { key: 'logs', label: t('sendHistory'), icon: 'fa-solid fa-clock-rotate-left' },
  ]

  return (
    <main className="flex-1 flex flex-col min-h-0">
      {/* 서브뷰 토글 */}
      <div className="pb-2 shrink-0">
        <div className="flex gap-1.5 desk:max-w-xl desk:mx-auto">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => handleSetView(v.key)}
              title={v.label}
              className={`flex-1 min-w-0 py-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${
                view === v.key
                  ? 'bg-ive-green text-ive-bg-deep'
                  : 'bg-ive-bg-card text-ive-text-dim'
              }`}
            >
              <i className={`${v.icon} shrink-0`} /><span className="truncate">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 메일 쓰기는 폼이라 너무 넓히지 않는다 */}
      {view === 'broadcast' && <div className="desk:max-w-3xl desk:mx-auto desk:w-full"><BroadcastView loadDraftId={loadDraftId} onDraftConsumed={() => setLoadDraftId(null)} /></div>}
      {view === 'social' && <SocialView />}
      {view === 'performance' && <PerformanceView />}
      {view === 'logs' && <SendLogView onDuplicate={(id) => { setLoadDraftId(id); handleSetView('broadcast') }} />}
    </main>
  )
}
