'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import TopBar from '@/components/layout/TopBar'
import NavRail from '@/components/layout/NavRail'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useStore } from '@/lib/store'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { state } = useStore()
  // 패드·PC 폭의 주 메뉴 위치 — 사용자 설정(프로필 › 환경 설정). 폰 폭은 늘 하단 탭
  const nav = state.user?.navPosition ?? 'top'
  const isStandalone = pathname?.startsWith('/p/')
  const theme = searchParams.get('theme') ?? 'dark'

  if (isStandalone) {
    // light/auto는 globals.css에서 처리(auto는 prefers-color-scheme 미디어 쿼리)
    const dataTheme = theme === 'light' || theme === 'auto' ? theme : undefined
    return (
      <div className="fixed inset-0 overflow-auto bg-ive-bg z-[100]" data-theme={dataTheme}>
        {children}
      </div>
    )
  }

  // 패드·PC 폭(pad, 768px~)의 주 메뉴: 위(상단바 가운데 — TopBar 가 그린다, 기본)·아래(하단 탭)·왼쪽/오른쪽(세로 메뉴). 폰 폭은 늘 하단 탭.
  // 하단 탭을 고르면 패드·PC 폭 전용 하단 탭을 여기서 한 번 그리고, 본문 아래에 탭 높이(h-16)만큼 비운다.
  return (
    <div className={`flex-1 min-h-0 flex ${nav === 'right' ? 'flex-row-reverse' : ''}`}>
      {(nav === 'left' || nav === 'right') && <NavRail side={nav} />}
      <div className={`flex-1 min-w-0 flex flex-col ${nav === 'bottom' ? 'pad:pb-16' : ''}`}>
        <TopBar />
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
      {nav === 'bottom' && <MobileTabBar deskOnly />}
    </div>
  )
}
