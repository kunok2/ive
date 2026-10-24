'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateMainUrl, useTab } from '@/lib/tab-context'
import PullToRefresh from '@/components/ui/PullToRefresh'
import SegmentTabs from '@/components/ui/SegmentTabs'
import UsersPanel from './admin/UsersPanel'
import MailPanel from './admin/MailPanel'
import SettingsHubPanel from './admin/SettingsHubPanel'
import LogsPanel from './admin/LogsPanel'

type SubTab = 'users' | 'mail' | 'settings' | 'logs'

export default function AdminTab() {
  const t = useTranslations('admin')
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== 'undefined') {
      const fromUrl = new URLSearchParams(window.location.search).get('sub')
      if (window.location.pathname === '/' && fromUrl && ['users', 'mail', 'settings', 'logs'].includes(fromUrl)) return fromUrl as SubTab
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

  // 관리 탭을 보는 동안만 하위 탭을 주소에 담는다
  const { activeTab } = useTab()
  useEffect(() => {
    updateMainUrl({ sub: activeTab === 'admin' ? subTab : null })
  }, [activeTab, subTab])

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
      {/* 서브 탭 바 — 다른 탭의 종류 버튼 줄(SegmentTabs)과 같은 모양 */}
      <div className="shrink-0 pt-4 desk:max-w-xl desk:mx-auto desk:w-full">
        <SegmentTabs<SubTab> dataTour="admin-sub-tabs" value={subTab} onChange={setSubTab}
          items={subTabs.map(({ key, icon, label }) => ({ key, icon: icon.replace('fa-solid ', ''), label }))} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20 pad:pb-6 min-h-full flex flex-col">
          {subTab === 'users' && <UsersPanel key={refreshKey} />}
          {subTab === 'mail' && <MailPanel key={refreshKey} />}
          {subTab === 'settings' && <SettingsHubPanel key={refreshKey} />}
          {subTab === 'logs' && <LogsPanel key={refreshKey} />}
        </div>
      </div>
    </PullToRefresh>
  )
}
