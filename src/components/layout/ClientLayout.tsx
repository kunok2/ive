'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import TopBar from '@/components/layout/TopBar'
import DebugOverflow from '@/components/layout/DebugOverflow'

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

  return (
    <>
      <TopBar />
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      <DebugOverflow />
    </>
  )
}
