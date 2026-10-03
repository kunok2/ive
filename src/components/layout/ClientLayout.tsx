'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import TopBar from '@/components/layout/TopBar'
import NavRail from '@/components/layout/NavRail'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
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

  // PC 폭(desk)에서는 왼쪽 세로 메뉴 + (상단바 · 본문). 그보다 좁으면 세로 메뉴가 숨고 종전 배치 그대로다.
  return (
    <div className="flex-1 min-h-0 flex">
      <NavRail />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
