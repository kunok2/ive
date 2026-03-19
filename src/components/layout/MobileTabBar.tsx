'use client'

import { useTab, TabKey } from '@/lib/tab-context'
import { usePathname, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'

const baseTabs: { key: TabKey; icon: string; label: string }[] = [
  { key: 'projects', icon: 'fa-solid fa-folder-open', label: '프로젝트' },
  { key: 'agents', icon: 'fa-solid fa-robot', label: '개발자' },
  { key: 'issues', icon: 'fa-solid fa-list-check', label: '작업' },
  { key: 'reports', icon: 'fa-solid fa-chart-bar', label: '보고서' },
]

export default function MobileTabBar() {
  const { activeTab, setActiveTab } = useTab()
  const pathname = usePathname()
  const router = useRouter()
  const { state } = useStore()

  const tabs = state.user?.isAdmin
    ? [...baseTabs, { key: 'admin' as TabKey, icon: 'fa-solid fa-gear', label: '관리' }]
    : baseTabs

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-ive-bg-card border-t border-ive-border" aria-label="메인 네비게이션">
      <div className="flex justify-around items-start pt-2 h-16 max-w-lg mx-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key)
              if (pathname !== '/') router.push('/')
            }}
            className={`flex flex-col items-center gap-0.5 px-3 transition-colors ${
              activeTab === tab.key ? 'text-ive-green' : 'text-ive-text-dim'
            }`}
          >
            <i className={`${tab.icon} text-lg`} />
            <span className="text-sm font-semibold">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
