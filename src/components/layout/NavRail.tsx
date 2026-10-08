'use client'

import { useStore } from '@/lib/store'
import { useMainTabs } from '@/components/layout/MobileTabBar'

/**
 * 패드·PC 폭(pad, 768px 이상)의 주 메뉴를 왼쪽·오른쪽 세로 막대로 둘 때(사용자 설정). 폰 폭은 늘 하단 탭(MobileTabBar).
 * 탭 목록·이동은 하단 탭과 같은 것(useMainTabs)을 쓴다.
 */
export default function NavRail({ side = 'left' }: { side?: 'left' | 'right' }) {
  const { state } = useStore()
  const { tabs, activeTab, go, navLabel } = useMainTabs()
  if (!state.authChecked || !state.user) return null

  return (
    <nav aria-label={navLabel} className={`hidden pad:flex w-[76px] shrink-0 flex-col items-center justify-center gap-1 py-4 bg-ive-bg-deep/95 ${side === 'right' ? 'border-l' : 'border-r'} border-ive-border-dark`}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          data-tour={`tab-${tab.key}`}
          onClick={() => go(tab.key)}
          aria-current={activeTab === tab.key ? 'page' : undefined}
          className={`w-[60px] py-2 rounded-lg flex flex-col items-center gap-1 transition-colors ${
            activeTab === tab.key ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim hover:text-ive-text-secondary hover:bg-white/[0.03]'
          }`}
        >
          <i className={`${tab.icon} text-lg`} />
          <span className="text-xs font-bold">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
