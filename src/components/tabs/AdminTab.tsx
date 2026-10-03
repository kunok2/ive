'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import PullToRefresh from '@/components/ui/PullToRefresh'
import UsersPanel from './admin/UsersPanel'
import MailPanel from './admin/MailPanel'
import SettingsHubPanel from './admin/SettingsHubPanel'
import LogsPanel from './admin/LogsPanel'

type SubTab = 'users' | 'mail' | 'settings' | 'logs'

export default function AdminTab() {
  const t = useTranslations('admin')
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ive-admin-subtab')
      if (saved && ['users', 'mail', 'settings', 'logs'].includes(saved)) return saved as SubTab
      if (saved === 'activity' || saved === 'cli') return 'users'
      // OAuth/Slack/터미널은 설정 하위로 이동됨 → 설정 탭으로 진입
      if (saved === 'oauth' || saved === 'slack' || saved === 'terminal') return 'settings'
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
    { key: 'mail', icon: 'fa-solid fa-bullhorn', label: t('promotion') },
    { key: 'settings', icon: 'fa-solid fa-gear', label: t('settings') },
    { key: 'logs', icon: 'fa-solid fa-file-lines', label: t('logs') },
  ]

  return (
    <PullToRefresh onRefresh={handleRefresh} className="w-full flex-1 flex flex-col max-w-lg desk:max-w-5xl mx-auto px-4 desk:px-6 overflow-hidden">
      {/* 서브 탭 바 — 버튼이 투명 배경이라 pt-4면 아이콘이 색박스 토글 탭들보다 더 내려가 보임. pt-1로 시각 정렬 */}
      <div className="shrink-0 pt-1 pb-3">
        <div data-tour="admin-sub-tabs" className="flex desk:max-w-xl desk:mx-auto">
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
              <i className={`${t.icon} sm:mr-1`} /><span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20 desk:pb-6 min-h-full flex flex-col">
          {subTab === 'users' && <UsersPanel key={refreshKey} />}
          {subTab === 'mail' && <MailPanel key={refreshKey} />}
          {subTab === 'settings' && <SettingsHubPanel key={refreshKey} />}
          {subTab === 'logs' && <LogsPanel key={refreshKey} />}
        </div>
      </div>
    </PullToRefresh>
  )
}
