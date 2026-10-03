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
  // PC 폭의 주 메뉴 위치 — 사용자 설정(프로필 › 환경 설정). 폰 폭은 늘 하단 탭
  const nav = state.user?.navPosition ?? 'left'
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

  // PC 폭(desk)에서는 세로 메뉴(왼쪽·오른쪽) + (상단바 · 본문), 또는 하단 탭. 그보다 좁으면 세로 메뉴가 숨고 종전 배치 그대로다.
  // 하단 탭을 고르면 PC 폭 전용 하단 탭을 여기서 한 번 그리고, 본문 아래에 탭 높이(h-16)만큼 비운다.
  return (
    <div className={`flex-1 min-h-0 flex ${nav === 'right' ? 'flex-row-reverse' : ''}`}>
      {nav !== 'bottom' && <NavRail side={nav} />}
      <div className={`flex-1 min-w-0 flex flex-col ${nav === 'bottom' ? 'desk:pb-16' : ''}`}>
        <TopBar />
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
      {nav === 'bottom' && <MobileTabBar deskOnly />}
    </div>
  )
}
