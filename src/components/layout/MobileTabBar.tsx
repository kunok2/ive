'use client'

import { useTab, TabKey } from '@/lib/tab-context'
import { usePathname, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'

export default function MobileTabBar() {
  const { activeTab, setActiveTab } = useTab()
  const pathname = usePathname()
  const router = useRouter()
  const { state } = useStore()
  const t = useTranslations('nav')

  const baseTabs: { key: TabKey; icon: string; label: string }[] = [
    { key: 'projects', icon: 'fa-solid fa-folder-open', label: t('projects') },
    { key: 'agents', icon: 'fa-solid fa-robot', label: t('agents') },
    { key: 'issues', icon: 'fa-solid fa-list-check', label: t('issues') },
    { key: 'reports', icon: 'fa-solid fa-chart-bar', label: t('reports') },
  ]

  const tabs = state.user?.isAdmin
    ? [...baseTabs, { key: 'admin' as TabKey, icon: 'fa-solid fa-gear', label: t('admin') }]
    : baseTabs

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-ive-bg-card border-t border-ive-border" aria-label={t('mainNavigation')}>
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
