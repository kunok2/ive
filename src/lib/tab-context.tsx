'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

export type TabKey = 'projects' | 'issues' | 'agents' | 'terminal'

const TabContext = createContext<{
  activeTab: TabKey
  setActiveTab: (tab: TabKey) => void
}>({
  activeTab: 'projects',
  setActiveTab: () => {},
})

export function TabProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabKey>('projects')
  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab() {
  return useContext(TabContext)
}
