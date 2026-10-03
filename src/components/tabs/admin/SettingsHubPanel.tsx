'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import SettingsPanel from './SettingsPanel'
import OAuthProvidersPanel from './OAuthProvidersPanel'
import TerminalTab from '../TerminalTab'

type SettingsSubView = 'settings' | 'oauth' | 'terminal'

// 설정 탭 하위에 설정 / OAuth / 터미널 화면을 둔다 (UsersPanel의 사용자/활동 패턴과 동일).
// Slack은 별도 탭을 두지 않고 OAuth 화면에 통합한다 (provider 자격증명 + 워크스페이스 관리).
export default function SettingsHubPanel() {
  const t = useTranslations('admin')
  const [view, setView] = useState<SettingsSubView>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-settings-subview')
      // 과거 'slack' 저장값은 oauth로 흡수
      if (saved === 'oauth' || saved === 'slack') return 'oauth'
      if (saved === 'terminal') return saved
    }
    return 'settings'
  })

  useEffect(() => {
    localStorage.setItem('ive-admin-settings-subview', view)
  }, [view])

  const views: { key: SettingsSubView; label: string; icon: string }[] = [
    { key: 'settings', label: t('settings'), icon: 'fa-solid fa-gear' },
    { key: 'oauth', label: 'OAuth', icon: 'fa-solid fa-key' },
    { key: 'terminal', label: t('terminal'), icon: 'fa-solid fa-terminal' },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="pb-2 shrink-0">
        <div className="flex gap-1.5 desk:max-w-xl desk:mx-auto">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                view === v.key
                  ? 'bg-ive-green text-ive-bg-deep'
                  : 'bg-ive-bg-card text-ive-text-dim active:scale-[0.96]'
              }`}
            >
              <i className={`${v.icon} mr-1`} />{v.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'settings' && <SettingsPanel />}
      {view === 'oauth' && <OAuthProvidersPanel />}
      {view === 'terminal' && <TerminalTab />}
    </div>
  )
}
