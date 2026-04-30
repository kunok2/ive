'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import TopBar from '@/components/layout/TopBar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isStandalone = pathname?.startsWith('/p/')
  const theme = searchParams.get('theme') ?? 'dark'

  if (isStandalone) {
    return (
      <div className="fixed inset-0 overflow-auto bg-ive-bg z-[100]" data-theme={theme === 'light' ? 'light' : undefined}>
        {children}
      </div>
    )
  }

  return (
    <>
      <TopBar />
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </>
  )
}
