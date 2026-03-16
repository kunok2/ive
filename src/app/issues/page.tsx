'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTab } from '@/lib/tab-context'

export default function IssuesRedirect() {
  const router = useRouter()
  const { setActiveTab } = useTab()

  useEffect(() => {
    setActiveTab('issues')
    router.replace('/')
  }, [setActiveTab, router])

  return null
}
