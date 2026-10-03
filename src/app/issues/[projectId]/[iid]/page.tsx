'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import IssueDetailView from './_components/IssueDetailView'
import { useTab } from '@/lib/tab-context'
import { DESK_QUERY } from '@/lib/use-media'

export default function IssueDetailPage({ params }: { params: Promise<{ projectId: string; iid: string }> }) {
  const { projectId, iid } = use(params)
  const router = useRouter()
  const { openIssueInTab } = useTab()
  // PC 폭: 단독 페이지 대신 작업 탭(왼쪽 목록 + 오른쪽 상세)으로 연다 — 보드·카드·메일 링크 어디서 와도 같다.
  // 폭을 알기 전에는 그리지 않는다(단독 화면이 잠깐 보였다가 넘어가는 깜빡임 방지)
  const [mode, setMode] = useState<'pending' | 'page'>('pending')
  useEffect(() => {
    if (window.matchMedia(DESK_QUERY).matches) {
      openIssueInTab(projectId, Number(iid))
      router.replace('/')
    } else {
      setMode('page')
    }
  }, [projectId, iid, openIssueInTab, router])
  if (mode === 'pending') return null
  return <IssueDetailView projectId={projectId} iid={iid} />
}
