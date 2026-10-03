'use client'

import { useTab, TabKey, tabForPath } from '@/lib/tab-context'
import { usePathname, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'

/** 주 메뉴 탭 목록과 이동 — 하단 탭(폰·패드)과 왼쪽 세로 메뉴(PC)가 같은 것을 쓴다 */
export function useMainTabs() {
  const { activeTab, setActiveTab } = useTab()
  const pathname = usePathname()
  const router = useRouter()
  const { state } = useStore()
  const t = useTranslations('nav')

  const baseTabs: { key: TabKey; icon: string; label: string }[] = [
    { key: 'projects', icon: 'fa-solid fa-folder-open', label: t('projects') },
    { key: 'agents', icon: 'fa-solid fa-users-gear', label: t('agents') },
    { key: 'issues', icon: 'fa-solid fa-list-check', label: t('issues') },
    { key: 'reports', icon: 'fa-solid fa-chart-bar', label: t('reports') },
  ]
  const tabs = state.user?.isAdmin
    ? [...baseTabs, { key: 'admin' as TabKey, icon: 'fa-solid fa-gear', label: t('admin') }]
    : baseTabs

  const go = (key: TabKey) => {
    setActiveTab(key)
    if (pathname !== '/') router.push('/')
  }
  // 메인 화면이 아니면(이슈·프로젝트 설정 등) 그 화면이 속한 메뉴를 켠다
  const current = pathname === '/' ? activeTab : (tabForPath(pathname) ?? activeTab)
  return { tabs, activeTab: current, go, navLabel: t('mainNavigation') }
}

export default function MobileTabBar() {
  const { tabs, activeTab, go, navLabel } = useMainTabs()

  return (
    <nav className="desk:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-t border-ive-border-dark min-[512px]:rounded-t-2xl" aria-label={navLabel}>
      <div className="flex justify-around items-start pt-2 h-16">
        {tabs.map(tab => (
          <button
            key={tab.key}
            data-tour={`tab-${tab.key}`}
            onClick={() => go(tab.key)}
            className={`flex flex-col items-center gap-0.5 px-3 transition-colors ${
              activeTab === tab.key ? 'text-ive-green' : 'text-ive-text-dim'
            }`}
          >
            <i className={`${tab.icon} text-lg`} />
            <span className="text-sm font-bold">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
