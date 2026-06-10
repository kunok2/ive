'use client'

import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateMedium } from '@/lib/format-date'
import { type StageAction } from './StageActions'
import StageProgress from './StageProgress'
import DeadlineProgress from './DeadlineProgress'
import { type PresetRole } from '@/components/issue/RoleAvatarBar'
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
  closedAt?: string | null
  dueDate?: string | null
  stageTimes?: {
    scheduledAt: string | null
    firstDevStartedAt: string | null
    devStartedAt: string | null
    devEndedAt: string | null
    verifyStartedAt: string | null
    verifyEndedAt: string | null
    confirmedAt: string | null
  }
  retryCounts?: {
    fromVerify: number
    fromVerifyToInflow: number
    fromConfirm: number
    fromDone: number
  }
  forwardCounts?: {
    toProcess: number
    toVerify: number
    toConfirm: number
    toDone: number
  }
  webUrl: string
  author: string
  authorAvatarUrl?: string | null
  iveAuthorAvatar?: string | null   // IVE 사용자 아바타 ID ('photo' 리졸브된 URL 또는 'av-XX')
  assignees?: IssueAssignee[]
  presetVerifier?: PresetRole
  presetConfirmer?: PresetRole
  actualProcessor?: { agentId: string | null; agentName: string | null; agentAvatar: string | null; cliName: string | null } | null
  actualVerifier?: { userId: string | null; name: string | null; avatar: string | null } | null
  actualConfirmer?: { userId: string | null; name: string | null; avatar: string | null } | null
}

interface IssueHeaderProps {
  issue: IssueDetail
  stageInfo: { label: string; color: string; icon: string; bg: string }
  actions: StageAction[]
  stageChanging: boolean
  iterationCount: number
  canProgressStage: boolean
  canEditAssignees: boolean
  isClosing: boolean
  editMode: boolean
  editTitle: string
  editDesc: string
  saving: boolean
  showDesc: boolean
  projectId: string
  gitMembers: IssueAssignee[]
  preferredAgent: {
    assignMode?: string
    preferredAgentId: string | null
    preferredAgentName: string | null
    preferredAgentAvatar: string | null
    preferredAgentCliName: string | null
  } | null
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
  /** 처리자(에이전트) picker — 처리자 아바타 클릭 시 호출. 미지정 시 onOpenAssigneePicker 사용. */
  onOpenAgentPicker?: () => void
  onPresetVerifierChange: (preset: PresetRole) => Promise<void> | void
  onPresetConfirmerChange: (preset: PresetRole) => Promise<void> | void
  /** 작성자 또는 관리자만 호출됨. null 이면 마감일 해제. */
  onDueDateChange: (next: string | null) => Promise<void> | void
  /** 작성자(생성자) 권한 — DeadlineProgress 노출/편집 제어. */
  isCreator: boolean
  onToast: (msg: string, type: 'success' | 'error') => void
}

export default function IssueHeader({
  issue, iterationCount,
  canEditAssignees, isClosing, editMode, editTitle, editDesc, saving, showDesc,
  projectId, gitMembers, preferredAgent,
  onBack, onCloseIssue, onStartEdit, onSaveEdit, onCancelEdit,
  onSetEditTitle, onSetEditDesc, onSetShowDesc, onOpenAssigneePicker, onOpenAgentPicker,
  onPresetVerifierChange, onPresetConfirmerChange, onDueDateChange, isCreator, onToast,
}: IssueHeaderProps) {
  const { state } = useStore()
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')

  // 완료된 작업(닫힘 또는 done 단계)은 담당자/검증자/확인자/마감일 모두 수정 불가.
  // 이미 종결된 흐름을 사후 변경하면 통계와 보고서가 어그러진다.
  const isCompleted = issue.state === 'closed' || issue.stage === 'done'
  const effectiveCanEditAssignees = canEditAssignees && !isCompleted

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
    <header className="sticky top-0 z-40 w-full max-w-lg mx-auto bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shrink-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onBack} className="text-ive-green font-bold p-1 hover:bg-ive-green/5 rounded shrink-0">
          <i className="fa-solid fa-arrow-left" />
        </button>
        <span className="text-base font-bold text-ive-green shrink-0">#{issue.iid}</span>
        {iterationCount > 0 && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded border bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20 shrink-0" title={tIssue('iterationCount', { count: iterationCount })}>
            <i className="fa-solid fa-repeat mr-0.5" />{tIssue('iterationLabel', { count: iterationCount })}
          </span>
        )}
        <span className="text-xs text-ive-text-dim shrink min-w-0 truncate">
          {formatDateMedium(issue.updatedAt, state.user?.locale, state.user?.timezone)}
        </span>
        <span className="ml-auto" />
        {/* 닫기 — 관리자/생성자(canEditAssignees) 만, 이미 닫힌 이슈 제외 */}
        {canEditAssignees && issue.state !== 'closed' && (
          <button
            onClick={onCloseIssue}
            disabled={isClosing}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle hover:text-ive-red hover:border-ive-red/40 transition-all disabled:opacity-40"
            title={tIssue('closeIssue')}
            aria-label={tIssue('closeIssue')}
          >
            {isClosing ? <i className="fa-solid fa-circle-notch fa-spin text-xs" /> : <i className="fa-solid fa-xmark text-xs" />}
          </button>
        )}
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
      <div className="px-3 pb-2">
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
              <div className="flex items-center gap-2 shrink-0 ml-auto">
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
              </div>
            </div>
          </>
        )}
      </div>
      {/* 진행막대 — 5단계 흐름 + 단계별 담당자 아바타를 한 줄로 표시 */}
      {!editMode && (
        <div className="px-3 pt-1 pb-3">
          <StageProgress
            stage={issue.stage}
            createdAt={issue.createdAt}
            closedAt={issue.closedAt ?? null}
            stageTimes={issue.stageTimes ?? null}
            retryCounts={issue.retryCounts ?? null}
            forwardCounts={issue.forwardCounts ?? null}
            roles={{
              creator: {
                name: issue.author,
                avatar: issue.iveAuthorAvatar
                  ? (issue.iveAuthorAvatar.startsWith('av-') ? null : issue.iveAuthorAvatar)
                  : (issue.authorAvatarUrl ?? null),
                avatarUrl: issue.authorAvatarUrl ?? null,
              },
              processor: {
                assignMode: (preferredAgent?.assignMode as 'agent' | 'auto' | 'assignee' | 'none' | undefined) ?? 'auto',
                agentName: preferredAgent?.preferredAgentName ?? null,
                agentAvatar: preferredAgent?.preferredAgentAvatar ?? null,
                username: issue.assignees?.[0]?.username ?? null,
                name: issue.assignees?.[0]?.name ?? null,
                avatarUrl: issue.assignees?.[0]?.avatarUrl ?? null,
                pendingAuto: !!(issue as any).assigneeAuto,
              },
              verifier: issue.presetVerifier ?? { mode: 'creator', userId: null, username: null },
              confirmer: issue.presetConfirmer ?? { mode: 'creator', userId: null, username: null },
              actualProcessor: issue.actualProcessor ?? null,
              actualVerifier: issue.actualVerifier ?? null,
              actualConfirmer: issue.actualConfirmer ?? null,
              gitMembers,
              canEdit: effectiveCanEditAssignees,
              // 처리자 아바타 클릭 — 에이전트 picker 가 있으면 그쪽, 없으면 기존 git 담당자 picker.
              onProcessorClick: onOpenAgentPicker ?? onOpenAssigneePicker,
              onVerifierChange: onPresetVerifierChange,
              onConfirmerChange: onPresetConfirmerChange,
            }}
          />
          {/* 마감일 진행 — 시작일시 → 마감일시 + 소진율. 작성자만 수정 가능.
              완료된 작업(closed/done)은 마감일 대비 조기/지연을 표시하므로 마감일이 있어야만 노출. */}
          {(() => {
            const isCompleted = issue.state === 'closed' || issue.stage === 'done'
            const completedAt = issue.closedAt ?? (issue.stage === 'done' ? issue.stageTimes?.confirmedAt ?? null : null)
            // 완료 + 마감일 미설정: 비교 대상이 없으니 노출 안함.
            if (isCompleted && !issue.dueDate) return null
            // 미완료: 마감일이 있거나 작성자(설정 버튼) 인 경우만 노출.
            if (!isCompleted && !issue.dueDate && !isCreator) return null
            return (
              <div className="mt-2">
                <DeadlineProgress
                  createdAt={issue.createdAt}
                  dueDate={issue.dueDate}
                  completedAt={isCompleted ? completedAt : null}
                  canEdit={isCreator && !isCompleted}
                  onChange={onDueDateChange}
                />
              </div>
            )
          })()}
        </div>
      )}
    </header>
  )
}
