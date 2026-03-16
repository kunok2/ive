'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTab } from '@/lib/tab-context'

export default function AgentsRedirect() {
  const router = useRouter()
  const { setActiveTab } = useTab()

  useEffect(() => {
    setActiveTab('agents')
    router.replace('/')
  }, [setActiveTab, router])

  return null
}
