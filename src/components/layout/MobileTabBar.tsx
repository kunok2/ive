'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/', icon: 'fa-solid fa-folder-open', label: '프로젝트' },
  { href: '/agents', icon: 'fa-solid fa-robot', label: 'Agent' },
  { href: '/review', icon: 'fa-solid fa-clipboard-check', label: '검수' },
  { href: '/alerts', icon: 'fa-solid fa-bell', label: '알림' },
]

export default function MobileTabBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-ive-bg-card border-t border-ive-border">
      <div className="flex justify-around items-center h-14 max-w-lg mx-auto">
        {tabs.map(tab => {
          const isActive = tab.href === '/'
            ? pathname === '/'
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-colors ${
                isActive ? 'text-ive-green' : 'text-ive-text-dim'
              }`}
            >
              <i className={`${tab.icon} text-base`} />
              <span className="text-[10px] font-semibold">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
