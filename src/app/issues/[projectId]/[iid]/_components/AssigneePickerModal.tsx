'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Modal from '@/components/ui/Modal'

interface IssueAssignee {
  id: number
  username: string
  name: string
  avatarUrl: string
}

interface AssigneePickerModalProps {
  open: boolean
  gitMembers: IssueAssignee[]
  initialPick: IssueAssignee | null
  onConfirm: (pick: IssueAssignee | null, auto: boolean) => void
  onClose: () => void
  /** 모달 타이틀 (역할명). 미지정 시 '담당자' */
  title?: string
  /** 미배정 옵션 라벨. 검증자/확인자에서는 "생성자가 처리" 등 의미가 다름 */
  noneLabel?: string
  /** 자동배정 옵션 노출 (검증자/확인자 picker 용). 처리자 picker 는 false */
  withAuto?: boolean
  /** 모달이 열릴 때 자동배정 모드로 시작할지 */
  initialAuto?: boolean
}

export default function AssigneePickerModal({ open, gitMembers, initialPick, onConfirm, onClose, title, noneLabel, withAuto = false, initialAuto = false }: AssigneePickerModalProps) {
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const [search, setSearch] = useState('')
  const [pick, setPick] = useState<IssueAssignee | null>(initialPick)
  const [auto, setAuto] = useState(initialAuto)

  // Sync pick & search when modal opens
  useEffect(() => {
    if (open) {
      setPick(initialPick)
      setAuto(initialAuto)
      setSearch('')
    }
  }, [open, initialPick, initialAuto])

  const filtered = gitMembers.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
  })

  const isNoneSelected = !pick && !auto
  const isAutoSelected = !pick && auto

  return (
    <Modal open={open} onClose={onClose} title={title ?? tIssue('assignee')} size="sm">
      <div className="p-1.5 border-b border-ive-border-dark">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tIssue('searchMember')}
          className="w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
          autoFocus
        />
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        {/* 미배정/생성자 옵션 */}
        <button
          onClick={() => { setPick(null); setAuto(false) }}
          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
            isNoneSelected ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          {isNoneSelected ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
          <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0">
            <i className="fa-solid fa-ban text-ive-text-dim text-xs" />
          </div>
          <span className="font-bold">{noneLabel ?? tIssue('noAssignee')}</span>
        </button>
        {/* 자동배정 옵션 (옵션) */}
        {withAuto && (
          <button
            onClick={() => { setPick(null); setAuto(true) }}
            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
              isAutoSelected ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
            }`}
          >
            {isAutoSelected ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
            <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0">
              <i className="fa-solid fa-shuffle text-ive-cyan text-xs" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{tIssue('autoAssign')}</div>
              <div className="text-xs text-ive-text-dim truncate">{tIssue('autoAssignDesc')}</div>
            </div>
          </button>
        )}
        {filtered.map(m => {
          const isPicked = pick?.id === m.id
          return (
            <button
              key={m.id}
              onClick={() => { setPick(m); setAuto(false) }}
              className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
                isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
              }`}
            >
              {isPicked ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
              {m.avatarUrl ? <img src={m.avatarUrl} className="w-7 h-7 rounded-full shrink-0" alt="" /> : <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0"><i className="fa-solid fa-user text-ive-text-dim text-xs" /></div>}
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">{m.name || m.username}</div>
                {m.name && m.name !== m.username && <div className="text-xs text-ive-text-dim truncate">@{m.username}</div>}
              </div>
            </button>
          )
        })}
      </div>
      <div className="p-3 border-t border-ive-border-dark flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-ive-text-dim border border-ive-border-subtle hover:bg-white/5 transition-all"
        >
          {tc('cancel')}
        </button>
        <button
          onClick={() => onConfirm(pick, auto)}
          className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green text-ive-bg-deep transition-all active:scale-[0.98]"
        >
          {tc('confirm')}
        </button>
      </div>
    </Modal>
  )
}
