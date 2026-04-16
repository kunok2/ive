'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import PullToRefresh from '@/components/ui/PullToRefresh'
import TerminalTab from './TerminalTab'
import UsersPanel from './admin/UsersPanel'
import MailPanel from './admin/MailPanel'
import SettingsPanel from './admin/SettingsPanel'
import OAuthProvidersPanel from './admin/OAuthProvidersPanel'

type SubTab = 'users' | 'mail' | 'settings' | 'oauth' | 'cli'

export default function AdminTab() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-subtab')
      if (saved && ['users', 'mail', 'settings', 'oauth', 'cli'].includes(saved)) return saved as SubTab
      if (saved === 'activity') return 'users'
    }
    return 'users'
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    localStorage.setItem('ive-admin-subtab', subTab)
  }, [subTab])

  const handleRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1)
  }, [])

  const subTabs: { key: SubTab; icon: string; label: string }[] = [
    { key: 'users', icon: 'fa-solid fa-users', label: t('users') },
    { key: 'mail', icon: 'fa-solid fa-envelope', label: t('mail') },
    { key: 'settings', icon: 'fa-solid fa-gear', label: t('settings') },
    { key: 'oauth', icon: 'fa-solid fa-key', label: 'OAuth' },
    { key: 'cli', icon: 'fa-solid fa-terminal', label: t('cli') },
  ]

  return (
    <PullToRefresh onRefresh={handleRefresh} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      {/* 서브 탭 바 */}
      <div className="shrink-0 pt-4 pb-3">
        <div data-tour="admin-sub-tabs" className="flex">
          {subTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex-1 py-2.5 text-sm font-bold text-center transition-colors ${
                subTab === t.key
                  ? 'text-ive-green border-b-2 border-ive-green'
                  : 'text-ive-text-dim'
              }`}
            >
              <i className={`${t.icon} mr-1`} />{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20">
          {subTab === 'users' && <UsersPanel key={refreshKey} />}
          {subTab === 'mail' && <MailPanel key={refreshKey} />}
          {subTab === 'settings' && <SettingsPanel key={refreshKey} />}
          {subTab === 'oauth' && <OAuthProvidersPanel key={refreshKey} />}
          {subTab === 'cli' && <TerminalTab />}
        </div>
      </div>
    </PullToRefresh>
  )
}
