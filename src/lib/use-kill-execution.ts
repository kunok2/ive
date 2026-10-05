'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'

/**
 * 실행 강제종료 — 묻고 나서 멈춘다. 되돌릴 수 없는 일이라 누르자마자 멈추지 않는다.
 * 트레이스 화면·작업 상세·보드 카드·프로젝트/에이전트 카드의 「강제종료」가 모두 이 훅을 쓴다(한 곳만 묻지 않게).
 * onConfirmed — 확인을 누른 뒤 멈추기 직전(버튼 스피너는 여기서 켠다 — 묻는 동안 돌지 않게).
 * 반환값: 실제로 멈췄으면 true, 취소했으면 false — 호출측은 true 일 때만 목록을 다시 읽는다.
 */
export function useKillExecution() {
  const { confirm } = useDialog()
  const te = useTranslations('execution')
  const tc = useTranslations('common')
  return useCallback(async (executionId: string, onConfirmed?: () => void): Promise<boolean> => {
    const ok = await confirm({
      title: te('forceStopConfirmTitle'),
      message: te('forceStopConfirmMessage'),
      confirmText: te('forceStop'),
      cancelText: tc('cancel'),
      variant: 'danger',
    })
    if (!ok) return false
    onConfirmed?.()
    await fetch(`/api/executions/${executionId}/kill`, { method: 'POST' })
    return true
  }, [confirm, te, tc])
}
