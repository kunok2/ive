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
  onConfirm: (pick: IssueAssignee | null) => void
  onClose: () => void
}

export default function AssigneePickerModal({ open, gitMembers, initialPick, onConfirm, onClose }: AssigneePickerModalProps) {
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const [search, setSearch] = useState('')
  const [pick, setPick] = useState<IssueAssignee | null>(initialPick)

  // Sync pick & search when modal opens
  useEffect(() => {
    if (open) {
      setPick(initialPick)
      setSearch('')
    }
  }, [open, initialPick])

  const filtered = gitMembers.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
  })

  return (
    <Modal open={open} onClose={onClose} title={tIssue('assignee')} size="sm">
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
        {/* 담당자 없음 옵션 */}
        <button
          onClick={() => setPick(null)}
          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
            !pick ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          {!pick ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
          <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0">
            <i className="fa-solid fa-ban text-ive-text-dim text-xs" />
          </div>
          <span className="font-bold">{tIssue('noAssignee')}</span>
        </button>
        {filtered.map(m => {
          const isPicked = pick?.id === m.id
          return (
            <button
              key={m.id}
              onClick={() => setPick(m)}
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
          onClick={() => onConfirm(pick)}
          className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green text-ive-bg-deep transition-all active:scale-[0.98]"
        >
          {tc('confirm')}
        </button>
      </div>
    </Modal>
  )
}
