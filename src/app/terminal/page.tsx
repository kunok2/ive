'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTab } from '@/lib/tab-context'

export default function TerminalRedirect() {
  const router = useRouter()
  const { setActiveTab } = useTab()

  useEffect(() => {
    setActiveTab('terminal')
    router.replace('/')
  }, [setActiveTab, router])

  return null
}
