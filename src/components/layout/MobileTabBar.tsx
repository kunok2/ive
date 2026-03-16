'use client'

import { useTab, TabKey } from '@/lib/tab-context'
import { usePathname, useRouter } from 'next/navigation'

const tabs: { key: TabKey; icon: string; label: string }[] = [
  { key: 'projects', icon: 'fa-solid fa-folder-open', label: '프로젝트' },
  { key: 'agents', icon: 'fa-solid fa-robot', label: '개발자' },
  { key: 'issues', icon: 'fa-solid fa-list-check', label: '작업' },
  { key: 'terminal', icon: 'fa-solid fa-terminal', label: 'CLI' },
]

export default function MobileTabBar() {
  const { activeTab, setActiveTab } = useTab()
  const pathname = usePathname()
  const router = useRouter()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-ive-bg-card border-t border-ive-border">
      <div className="flex justify-around items-center h-14 max-w-lg mx-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key)
              // 서브페이지에 있으면 메인으로 돌아가기
              if (pathname !== '/') router.push('/')
            }}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-colors ${
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
