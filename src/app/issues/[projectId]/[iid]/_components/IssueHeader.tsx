'use client'

import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateMedium } from '@/lib/format-date'
import StageActionButtons from './StageActions'
import { createImagePasteHandlers } from '@/lib/paste-upload'
import { useMemo, useRef, useEffect } from 'react'

interface IssueAssignee {
  id: number
  username: string
  name: string
  avatarUrl: string
}

interface IssueDetail {
  iid: number
  title: string
  description: string
  stage: string
  state: string
  labels: string[]
  createdAt: string
  updatedAt: string
  webUrl: string
  author: string
  assignees?: IssueAssignee[]
}

interface StageAction {
  action: string
  label: string
  icon: string
  danger?: boolean
}

interface IssueHeaderProps {
  issue: IssueDetail
  stageInfo: { label: string; color: string; icon: string; bg: string }
  actions: StageAction[]
  stageChanging: boolean
  iterationCount: number
  canProgressStage: boolean
  isClosing: boolean
  editMode: boolean
  editTitle: string
  editDesc: string
  saving: boolean
  showDesc: boolean
  projectId: string
  onBack: () => void
  onStageAction: (action: string) => void
  onCloseIssue: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onSetEditTitle: (v: string) => void
  onSetEditDesc: (v: string) => void
  onSetShowDesc: (v: boolean) => void
  onOpenAssigneePicker: () => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

export default function IssueHeader({
  issue, stageInfo, actions, stageChanging, iterationCount,
  canProgressStage, isClosing, editMode, editTitle, editDesc, saving, showDesc,
  projectId,
  onBack, onStageAction, onCloseIssue, onStartEdit, onSaveEdit, onCancelEdit,
  onSetEditTitle, onSetEditDesc, onSetShowDesc, onOpenAssigneePicker, onToast,
}: IssueHeaderProps) {
  const { state } = useStore()
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const tAuth = useTranslations('auth')

  // Image paste handler for edit description textarea
  const editDescRef = useRef(editDesc)
  useEffect(() => { editDescRef.current = editDesc }, [editDesc])
  const editDescPasteHandlers = useMemo(() => createImagePasteHandlers({
    projectId,
    getValue: () => editDescRef.current,
    setValue: v => onSetEditDesc(v),
    onError: msg => onToast(msg, 'error'),
  }), [projectId, onSetEditDesc, onToast])

  return (
    <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shrink-0">
      <div className="flex items-center gap-2 px-3 py-2 max-w-lg mx-auto">
        <button onClick={onBack} className="text-ive-green font-bold p-1 hover:bg-ive-green/5 rounded shrink-0">
          <i className="fa-solid fa-arrow-left" />
        </button>
        <span className="text-base font-bold text-ive-green shrink-0">#{issue.iid}</span>
        {issue.stage !== 'none' && (
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${stageInfo.bg} ${stageInfo.color} border-current/20 shrink-0`}>
            <i className={`fa-solid ${stageInfo.icon} mr-0.5`} />{stageInfo.label}
          </span>
        )}
        {iterationCount > 0 && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded border bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20 shrink-0" title={tIssue('iterationCount', { count: iterationCount })}>
            <i className="fa-solid fa-repeat mr-0.5" />{tIssue('iterationLabel', { count: iterationCount })}
          </span>
        )}
        <span className="text-xs text-ive-text-dim shrink-0"><i className="fa-solid fa-user mr-0.5" />{issue.author}</span>
        {/* 담당자 */}
        <button
          type="button"
          onClick={onOpenAssigneePicker}
          className="flex items-center gap-1 text-xs text-ive-text-dim hover:text-ive-text transition-all shrink-0"
        >
          {(issue.assignees && issue.assignees.length > 0) ? (
            issue.assignees.map(a => (
              <span key={a.id} className="flex items-center gap-0.5">
                {a.avatarUrl ? <img src={a.avatarUrl} className="w-4 h-4 rounded-full" alt="" /> : <i className="fa-solid fa-user mr-0.5" />}
                {a.name || a.username}
              </span>
            ))
          ) : (
            <><i className="fa-solid fa-user-plus mr-0.5" />{tIssue('selectAssignee')}</>
          )}
        </button>
        <span className="text-xs text-ive-text-dim ml-auto shrink-0">
          {formatDateMedium(issue.updatedAt, state.user?.locale, state.user?.timezone)}
        </span>
        {issue.webUrl && (
          <button
            onClick={() => window.open(issue.webUrl, '_blank')}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle hover:text-ive-cyan hover:border-ive-cyan/30 transition-all"
            title={tIssue('viewOnRemote')}
            aria-label={tIssue('openOriginal')}
          >
            <i className="fa-solid fa-arrow-up-right-from-square text-xs" />
          </button>
        )}
      </div>
      {/* 제목 + 설명 토글 + 단계 변경 */}
      <div className="px-3 pb-2 max-w-lg mx-auto">
        {editMode ? (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={editTitle}
                onChange={e => onSetEditTitle(e.target.value)}
                className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm font-bold text-ive-text focus:outline-none focus:border-ive-green"
                placeholder={tIssue('title')}
                autoFocus
              />
            </div>
            <div className="flex gap-2 items-end">
              <textarea
                value={editDesc}
                onChange={e => onSetEditDesc(e.target.value)}
                onPaste={editDescPasteHandlers.onPaste}
                onDrop={editDescPasteHandlers.onDrop}
                onDragOver={editDescPasteHandlers.onDragOver}
                className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text resize-none focus:outline-none focus:border-ive-green"
                placeholder={tIssue('descriptionOptional')}
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={onSaveEdit}
                disabled={saving || !editTitle.trim()}
                className="flex-1 text-xs font-bold text-ive-green border border-ive-green/30 py-1.5 rounded-lg hover:bg-ive-green/10 transition-colors disabled:opacity-40"
              >
                {saving ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-check mr-1" />{tc('save')}</>}
              </button>
              <button
                onClick={onCancelEdit}
                className="flex-1 text-xs font-bold text-ive-text-dim border border-ive-border py-1.5 rounded-lg hover:bg-ive-bg-deep transition-colors"
              >
                {tc('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 flex-wrap">
              <h1 className="text-sm font-bold text-ive-text leading-snug flex-1 min-w-[70%]">{issue.title}</h1>
              <div className="flex items-center gap-1 shrink-0 ml-auto">
                <button
                  onClick={onStartEdit}
                  className="w-7 h-7 rounded-lg flex items-center justify-center bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle hover:text-ive-green hover:border-ive-green/30 transition-all"
                  title={tc('edit')}
                >
                  <i className="fa-solid fa-pen text-xs" />
                </button>
                {issue.description && (
                  <button onClick={() => onSetShowDesc(!showDesc)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showDesc ? 'bg-ive-green/10 text-ive-green' : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'}`} title={tIssue('viewDescription')}>
                    <i className={`fa-solid fa-file-lines text-xs`} />
                  </button>
                )}
                {canProgressStage && <StageActionButtons actions={actions} stageChanging={stageChanging} onAction={onStageAction} />}
                {canProgressStage && (
                  <button
                    onClick={onCloseIssue}
                    disabled={isClosing || stageChanging}
                    className="h-7 px-2 rounded-lg text-xs font-bold border text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10 transition-all active:scale-95 disabled:opacity-40"
                  >
                    {isClosing ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-xmark mr-0.5" />{tc('close')}</>}
                  </button>
                )}
                {!canProgressStage && (
                  <span className="text-xs text-ive-text-dim italic">
                    <i className="fa-solid fa-lock mr-1" />담당자만 변경 가능
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
