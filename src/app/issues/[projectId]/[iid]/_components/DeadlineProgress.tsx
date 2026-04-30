'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateMedium } from '@/lib/format-date'

interface DeadlineProgressProps {
  createdAt: string
  /** YYYY-MM-DD (KST 기준 날짜만 — Git 표준). null/undefined 면 미설정. */
  dueDate: string | null | undefined
  /** 완료된 작업의 실제 완료 시각(ISO). 있으면 마감일 대비 조기/지연 표시 모드. */
  completedAt?: string | null
  /** 작성자 또는 관리자만 수정 가능. */
  canEdit: boolean
  onChange: (next: string | null) => Promise<void> | void
}

/** YYYY-MM-DD 를 KST 자정의 Date 로 변환. timezone 명시 안하면 브라우저 로컬로 해석돼 어긋남. */
function parseDueDate(yyyyMmDd: string): Date {
  // 23:59:59 KST 를 마감 순간으로 — 같은 날짜 내내는 "안 지난 것"으로 본다.
  return new Date(`${yyyyMmDd}T23:59:59+09:00`)
}

/** ms 차이를 사람 읽기 좋은 "n일 / n시간" 으로 변환 */
function formatRemain(ms: number, t: (k: string, p?: any) => string): string {
  const abs = Math.abs(ms)
  const days = Math.floor(abs / 86400000)
  const hours = Math.floor((abs % 86400000) / 3600000)
  if (days >= 1) return t('daysRemain', { days })
  return t('hoursRemain', { hours: Math.max(hours, 1) })
}

export default function DeadlineProgress({ createdAt, dueDate, completedAt, canEdit, onChange }: DeadlineProgressProps) {
  const tIssue = useTranslations('issue')
  const tc = useTranslations('common')
  const { state } = useStore()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(dueDate ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(dueDate ?? '') }, [dueDate])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const handleSave = async (next: string | null) => {
    if ((next ?? null) === (dueDate ?? null)) { setEditing(false); return }
    setSaving(true)
    try {
      await onChange(next)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  // 미설정 케이스: 작성자에게는 "마감일 설정" 버튼, 그 외엔 비표시
  if (!dueDate) {
    if (!canEdit) return null
    if (editing) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ive-bg-card border border-ive-border-subtle">
          <i className="fa-solid fa-calendar-days text-ive-cyan text-xs" />
          <input
            ref={inputRef}
            type="date"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-2 py-1 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => handleSave(draft || null)}
            disabled={saving || !draft}
            className="text-xs font-bold text-ive-green border border-ive-green/30 px-2 py-1 rounded-lg hover:bg-ive-green/10 transition-colors disabled:opacity-40"
          >
            {saving ? <i className="fa-solid fa-circle-notch fa-spin" /> : tc('save')}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setDraft(dueDate ?? '') }}
            disabled={saving}
            className="text-xs font-bold text-ive-text-dim border border-ive-border-subtle px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            {tc('cancel')}
          </button>
        </div>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full px-3 py-2 rounded-lg border border-dashed border-ive-border-subtle text-xs font-bold text-ive-text-dim hover:border-ive-cyan/40 hover:text-ive-cyan hover:bg-ive-cyan/5 transition-colors flex items-center justify-center gap-1.5"
      >
        <i className="fa-solid fa-calendar-plus" />
        {tIssue('setDueDate')}
      </button>
    )
  }

  // 마감일 설정됨: 진행 막대 + 소진율 + 인라인 수정
  const start = new Date(createdAt).getTime()
  const end = parseDueDate(dueDate).getTime()
  const now = Date.now()
  const total = Math.max(end - start, 1)

  // 완료된 작업: 완료 시각 vs 마감일 비교 (조기/정시/지연)
  // 진행중 작업: 현재 시각 vs 마감일 비교 (남음/지남)
  const completedTs = completedAt ? new Date(completedAt).getTime() : null
  const refTs = completedTs ?? now
  const consumed = refTs - start
  const ratio = Math.max(0, Math.min(1, consumed / total))
  const diffMs = end - refTs            // +면 마감 전, -면 마감 후
  const overdue = diffMs < 0
  const isCompleted = completedTs != null

  // 색상 규칙:
  //   완료: 일찍/정시 = green, 지연 = red
  //   진행중: overdue = red, 90%↑ = amber, 그 외 cyan
  const barCls = isCompleted
    ? (overdue ? 'bg-ive-red' : 'bg-ive-green')
    : (overdue ? 'bg-ive-red' : ratio >= 0.9 ? 'bg-ive-amber' : 'bg-ive-cyan')
  const labelCls = isCompleted
    ? (overdue ? 'text-ive-red' : 'text-ive-green')
    : (overdue ? 'text-ive-red' : ratio >= 0.9 ? 'text-ive-amber' : 'text-ive-cyan')

  return (
    <div className="px-3 py-2 rounded-lg bg-ive-bg-card border border-ive-border-subtle">
      {editing ? (
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-calendar-days text-ive-cyan text-xs" />
          <input
            ref={inputRef}
            type="date"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-2 py-1 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => handleSave(draft || null)}
            disabled={saving || !draft}
            className="text-xs font-bold text-ive-green border border-ive-green/30 px-2 py-1 rounded-lg hover:bg-ive-green/10 transition-colors disabled:opacity-40"
          >
            {saving ? <i className="fa-solid fa-circle-notch fa-spin" /> : tc('save')}
          </button>
          <button
            type="button"
            onClick={() => handleSave(null)}
            disabled={saving}
            className="text-xs font-bold text-ive-text-dim border border-ive-border-subtle px-2 py-1 rounded-lg hover:bg-ive-red/10 hover:text-ive-red hover:border-ive-red/30 transition-colors"
            title={tIssue('clearDueDate')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setDraft(dueDate) }}
            disabled={saving}
            className="text-xs font-bold text-ive-text-dim hover:text-ive-text px-1 transition-colors"
          >
            {tc('cancel')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <i className={`fa-solid fa-calendar-days text-xs ${labelCls}`} />
            <span className="text-xs font-bold text-ive-text-dim">
              {formatDateMedium(createdAt, state.user?.locale, state.user?.timezone)}
            </span>
            <i className="fa-solid fa-arrow-right text-[10px] text-ive-text-dim" />
            <span className={`text-xs font-bold ${labelCls}`}>{dueDate}</span>
            <span className={`ml-auto text-xs font-bold ${labelCls}`}>
              {isCompleted ? (
                Math.abs(diffMs) < 60000 // 1분 이내 = 정시
                  ? <><i className="fa-solid fa-circle-check mr-0.5" />{tIssue('completedOnTime')}</>
                  : overdue
                    ? <><i className="fa-solid fa-triangle-exclamation mr-0.5" />{tIssue('completedLate', { remain: formatRemain(diffMs, tIssue) })}</>
                    : <><i className="fa-solid fa-circle-check mr-0.5" />{tIssue('completedEarly', { remain: formatRemain(diffMs, tIssue) })}</>
              ) : overdue ? (
                <><i className="fa-solid fa-triangle-exclamation mr-0.5" />{tIssue('overdueBy', { remain: formatRemain(diffMs, tIssue) })}</>
              ) : (
                <>{formatRemain(diffMs, tIssue)} {tIssue('left')}</>
              )}
            </span>
            {canEdit && !isCompleted && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-ive-text-dim hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors"
                title={tIssue('changeDueDate')}
                aria-label={tIssue('changeDueDate')}
              >
                <i className="fa-solid fa-pen text-[10px]" />
              </button>
            )}
          </div>
          {/* 진행 막대 */}
          <div className="relative h-2 rounded-full bg-ive-bg-deep overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${barCls} transition-all`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-ive-text-dim">
            <span>{isCompleted ? tIssue('completedAt') : tIssue('elapsed')}</span>
            <span className={labelCls}>
              {isCompleted
                ? formatDateMedium(completedAt!, state.user?.locale, state.user?.timezone)
                : `${Math.round(ratio * 100)}%`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
