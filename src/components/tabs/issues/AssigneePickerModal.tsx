'use client'

import Modal from '@/components/ui/Modal'
import { useTranslations } from 'next-intl'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

interface AssigneePickerModalProps {
  open: boolean
  onClose: () => void
  /** Currently targeted issue iids (includes -1 for create-mode) */
  iids: number[]
  gitMembers: GitMember[]
  search: string
  onSearchChange: (value: string) => void
  pick: GitMember | null
  onPickChange: (member: GitMember | null) => void
  autoMode: boolean
  onAutoModeChange: (value: boolean) => void
  onConfirm: () => void
  /** 모달 타이틀(역할). 미지정 시 "담당자". 검증자/확인자 등 다른 역할에도 재사용. */
  title?: string
  /** "미배정" 옵션 라벨. 검증자/확인자에서는 "미배정 (생성자)" 식으로 의미가 다름. */
  noneLabel?: string
}

export default function AssigneePickerModal({
  open,
  onClose,
  iids,
  gitMembers,
  search,
  onSearchChange,
  pick,
  onPickChange,
  autoMode,
  onAutoModeChange,
  onConfirm,
  title,
  noneLabel,
}: AssigneePickerModalProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')
  const effectiveTitle = title ?? tIssue('assignee')
  const effectiveNoneLabel = noneLabel ?? tIssue('noAssignee')

  const filtered = gitMembers.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
  })

  const isNoneSelected = !pick && !autoMode
  const isAutoSelected = !pick && autoMode

  const selectNone = () => { onAutoModeChange(false); onPickChange(null) }
  const selectAuto = () => { onAutoModeChange(true); onPickChange(null) }
  const selectMember = (m: GitMember) => { onAutoModeChange(false); onPickChange(m) }

  return (
    <Modal open={open} onClose={onClose} title={`${effectiveTitle}${iids.length > 1 && !iids.includes(-1) ? ` (${iids.length}${tCommon('items')})` : ''}`} size="sm">
      <div className="p-1.5 border-b border-ive-border-dark">
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={tIssue('searchMember')}
          className="w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
          autoFocus
        />
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        {/* 담당자 없음 */}
        <button
          onClick={selectNone}
          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
            isNoneSelected ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          {isNoneSelected ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
          <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0">
            <i className="fa-solid fa-ban text-ive-text-dim text-xs" />
          </div>
          <span className="font-bold">{effectiveNoneLabel}</span>
        </button>
        {/* 자동배정 */}
        <button
          onClick={selectAuto}
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
        {filtered.map(m => {
          const isPicked = pick?.id === m.id
          return (
            <button
              key={m.id}
              onClick={() => selectMember(m)}
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
          {tCommon('cancel')}
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green text-ive-bg-deep transition-all active:scale-[0.98]"
        >
          {tCommon('confirm')}
        </button>
      </div>
    </Modal>
  )
}
