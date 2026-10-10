'use client'

import { useRef, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useKillExecution } from '@/lib/use-kill-execution'
import { useTranslations } from 'next-intl'
import { createImagePasteHandlers } from '@/lib/paste-upload'
import AgentPickerDropdown from './AgentPickerDropdown'
import { isClosedMidway } from './StageActions'

interface IssueDetail {
  iid: number
  stage: string
  state: string
  [key: string]: any
}

export interface ChatImageItem {
  id: string
  preview: string
  url: string | null
  markdown: string | null
  uploading: boolean
  error?: boolean
}

interface PreferredAgent {
  assignMode?: string
  preferredAgentId: string | null
  preferredAgentName: string | null
  preferredAgentAvatar: string | null
  preferredAgentCliName: string | null
}

interface ProjectAgent {
  agentId: string
  agent: { id: string; name: string; avatar: string; cliName: string; status: string }
}

/** 검증·확인을 에이전트에게 맡기기 — 등록 오른쪽 「에이전트 호출」 버튼 */
export interface StageHandOff {
  kind: 'verify' | 'confirm'
  /** 입력창 위 작업자 선택에서 고른 에이전트 — 누르면 이 에이전트에게 맡긴다. null 이면 맡을 수 있는 에이전트에게 자동 배정(서버가 고른다) */
  target: { id: string; name: string } | null
  /** 에이전트가 맡지 못한 사유(MR 없음 등) — 버튼 풍선말에 보인다 */
  note: string | null
  busy: boolean
  onCall: () => void
}

interface BottomInputAreaProps {
  /** 폭 제한 클래스 — 옆 칸이면 칸 전체 폭 */
  widthCls?: string
  issue: IssueDetail
  mode: 'comment' | 'chat'
  canProgressStage: boolean
  /** 지금 이 작업을 하고 있는 에이전트 실행 — 있으면 단계 버튼 대신 안내 줄 */
  agentWork: { executionId: string; agentName: string | null; kind: 'process' | 'verify' | 'confirm' | 'chat' } | null
  projectId: string
  // Comment state
  comment: string
  commentKey: string
  posting: boolean
  postingType: 'comment' | 'retry' | 'done' | 'next' | 'inflow' | null
  // Chat state
  chatSessionId: string | null
  chatHistoryOnly: boolean
  chatStarting: boolean
  chatSending: boolean
  chatInput: string
  chatImages: ChatImageItem[]
  chatAgentName: string | null
  // Agent picker state
  preferredAgent: PreferredAgent | null
  projectAgents: ProjectAgent[]
  // Next-stage config
  NEXT_STAGE: Record<string, { stage: string; action: string; label: string }>
  // Handlers
  onSetMode: (m: 'comment' | 'chat') => void
  onSetComment: (v: string) => void
  onSetChatInput: (v: string) => void
  onAddChatImages: (files: File[]) => void
  onRemoveChatImage: (id: string) => void
  onPostComment: () => void
  onCommentAndRetry: (agentId?: string | null) => void
  onCommentAndDone: () => void
  onCommentAndNextStage: () => void
  onCommentAndInflow: () => void
  /** 에이전트 실행을 강제종료한 뒤 — 이슈를 다시 읽어 안내 줄·단계 버튼을 맞춘다 */
  onAgentWorkStopped: () => void
  onStartChat: (force?: boolean) => void
  onEndChat: () => void
  onSendChatMessage: () => void
  onChangePreferredAgent: (agentIdOrMode: string | null) => void
  handOff?: StageHandOff | null
  onToast: (msg: string, type: 'success' | 'error') => void
}

export default function BottomInputArea({
  widthCls = 'max-w-lg desk:max-w-3xl',
  issue, mode, canProgressStage, agentWork, projectId,
  comment, commentKey, posting, postingType,
  chatSessionId, chatHistoryOnly, chatStarting, chatSending, chatInput, chatImages, chatAgentName,
  preferredAgent, projectAgents, NEXT_STAGE,
  onSetMode, onSetComment, onSetChatInput, onAddChatImages, onRemoveChatImage,
  onPostComment, onCommentAndRetry, onCommentAndDone, onCommentAndNextStage, onCommentAndInflow, onAgentWorkStopped,
  onStartChat, onEndChat, onSendChatMessage, onChangePreferredAgent, handOff = null, onToast,
}: BottomInputAreaProps) {
  // Image paste handler for comment textarea
  const commentRef = useRef(comment)
  useEffect(() => { commentRef.current = comment }, [comment])
  const commentPasteHandlers = useMemo(() => createImagePasteHandlers({
    projectId,
    getValue: () => commentRef.current,
    setValue: v => {
      onSetComment(v)
      try { localStorage.setItem(commentKey, v) } catch {}
    },
    onError: msg => onToast(msg, 'error'),
  }), [projectId, commentKey, onSetComment, onToast])

  const tIssue = useTranslations('issue')
  const te = useTranslations('execution')
  const [killing, setKilling] = useState(false)
  // 강제종료 — 트레이스 화면의 버튼과 같은 확인·API·동작(실행 실패 처리 + 에이전트 해제)
  const killExecution = useKillExecution()
  const handleKill = async () => {
    if (!agentWork) return
    try {
      if (await killExecution(agentWork.executionId, () => setKilling(true))) onAgentWorkStopped()
    } finally { setKilling(false) }
  }

  return (
    <div className={`shrink-0 px-3 pb-20 pad:pb-4 pt-2 border-t border-ive-border-dark bg-ive-bg-deep ${widthCls} mx-auto w-full`}>
      {/* 에이전트가 이 작업을 하는 중 — 코멘트·대화 어느 모드에서도 보이고, 이상하면 바로 트레이스로 가거나 멈춘다 */}
      {agentWork && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ive-bg-card border border-ive-border-subtle text-xs font-bold text-ive-text-secondary mb-2">
          <i className={`fa-solid fa-circle-notch fa-spin ${agentWork.kind === 'confirm' ? 'text-ive-stage-confirm' : agentWork.kind === 'verify' ? 'text-ive-stage-verify' : 'text-ive-stage-process'}`} />
          <span className="flex-1 min-w-0">
            {tIssue('agentWorking', { agent: agentWork.agentName || tIssue('agentWorkingUnknown'), work: tIssue(`agentWorkKind.${agentWork.kind === 'chat' ? 'process' : agentWork.kind}`) })}
          </span>
          {/* 돌고 있는 실행의 트레이스로 · 강제종료(단계 진행 권한자만 — 서버도 프로젝트 권한을 본다) */}
          <Link
            href={`/executions/${agentWork.executionId}`}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-ive-bg-deep border border-ive-border-dark text-ive-text-secondary hover:text-ive-text transition-colors"
          >
            <i className="fa-solid fa-terminal mr-1" />{te('viewTrace')}
          </Link>
          {canProgressStage && (
            <button
              type="button"
              onClick={handleKill}
              disabled={killing}
              className="shrink-0 text-ive-red/70 border border-ive-red/30 px-3 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors disabled:opacity-40"
            >
              {killing ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-skull-crossbones mr-1" />{te('forceStop')}</>}
            </button>
          )}
        </div>
      )}
      {/* Mode tabs */}
      <ModeTabs
        issue={issue}
        mode={mode}
        canProgressStage={canProgressStage}
        chatSessionId={chatSessionId}
        chatHistoryOnly={chatHistoryOnly}
        chatStarting={chatStarting}
        chatAgentName={chatAgentName}
        preferredAgent={preferredAgent}
        projectAgents={projectAgents}
        onSetMode={onSetMode}
        onStartChat={onStartChat}
        onEndChat={onEndChat}
        onChangePreferredAgent={onChangePreferredAgent}
      />

      {/* Comment mode input */}
      {mode === 'comment' && (
        <CommentModeInput
          issue={issue}
          comment={comment}
          commentKey={commentKey}
          posting={posting}
          postingType={postingType}
          canProgressStage={canProgressStage}
          agentWork={agentWork}
          preferredAgent={preferredAgent}
          NEXT_STAGE={NEXT_STAGE}
          commentPasteHandlers={commentPasteHandlers}
          onSetComment={onSetComment}
          onPostComment={onPostComment}
          onCommentAndRetry={onCommentAndRetry}
          onCommentAndDone={onCommentAndDone}
          onCommentAndNextStage={onCommentAndNextStage}
          onCommentAndInflow={onCommentAndInflow}
          handOff={handOff}
        />
      )}

      {/* Chat mode input */}
      {mode === 'chat' && chatSessionId && (
        <ChatModeInput
          chatInput={chatInput}
          chatSending={chatSending}
          chatImages={chatImages}
          onSetChatInput={onSetChatInput}
          onAddChatImages={onAddChatImages}
          onRemoveChatImage={onRemoveChatImage}
          onSendChatMessage={onSendChatMessage}
        />
      )}

      {/* Chat history-only: show "start new chat" prompt */}
      {mode === 'chat' && !chatSessionId && chatHistoryOnly && !chatStarting && (
        <ChatHistoryPrompt onStartChat={onStartChat} />
      )}

      {/* Chat start prompt (when mode=chat but no session yet and no history) */}
      {mode === 'chat' && !chatSessionId && !chatHistoryOnly && !chatStarting && (
        <ChatStartPrompt onStartChat={onStartChat} />
      )}

    </div>
  )
}

// --- Sub-components (private to this file) ---

function ModeTabs({
  issue, mode, canProgressStage,
  chatSessionId, chatHistoryOnly, chatStarting, chatAgentName,
  preferredAgent, projectAgents,
  onSetMode, onStartChat, onEndChat, onChangePreferredAgent,
}: {
  issue: BottomInputAreaProps['issue']
  mode: BottomInputAreaProps['mode']
  canProgressStage: boolean
  chatSessionId: string | null
  chatHistoryOnly: boolean
  chatStarting: boolean
  chatAgentName: string | null
  preferredAgent: BottomInputAreaProps['preferredAgent']
  projectAgents: BottomInputAreaProps['projectAgents']
  onSetMode: (m: 'comment' | 'chat') => void
  onStartChat: (force?: boolean) => void
  onEndChat: () => void
  onChangePreferredAgent: (v: string | null) => void
}) {
  const tIssue = useTranslations('issue')

  return (
    <div className="flex items-center gap-1 mb-2">
      <button
        onClick={() => onSetMode('comment')}
        className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all ${
          mode === 'comment' ? 'bg-ive-green/15 text-ive-green' : 'text-ive-text-dim hover:text-ive-text'
        }`}
      >
        <i className="fa-solid fa-comment mr-1" />{tIssue('commentMode')}
      </button>
      {canProgressStage && (
        <button
          onClick={() => {
            if (chatHistoryOnly) {
              onSetMode('chat')
            } else if (!chatSessionId) {
              onStartChat()
            } else {
              onSetMode('chat')
            }
          }}
          disabled={chatStarting}
          className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all ${
            mode === 'chat' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'
          }`}
        >
          {chatStarting ? (
            <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tIssue('startingChat')}</>
          ) : chatHistoryOnly && !chatSessionId ? (
            <><i className="fa-solid fa-clock-rotate-left mr-1" />{tIssue('chatMode')}</>
          ) : (
            <><i className="fa-solid fa-comments mr-1" />{chatSessionId && chatAgentName ? `${tIssue('chatMode')}(${chatAgentName})` : tIssue('chatMode')}</>
          )}
        </button>
      )}
      {canProgressStage && chatSessionId && mode === 'chat' && (
        <button
          onClick={onEndChat}
          className="text-xs font-bold px-2 py-1 rounded-lg text-ive-red/70 hover:text-ive-red hover:bg-ive-red/10 transition-all"
        >
          <i className="fa-solid fa-xmark mr-0.5" />{tIssue('endChat')}
        </button>
      )}
      {/* 작업자 선택 — 탭 행 우측 (코멘트 모드에서만, 권한 있는 경우에만) */}
      {canProgressStage && issue.stage !== 'dev' && projectAgents.length > 0 && mode === 'comment' && (
        <AgentPickerDropdown
          preferredAgent={preferredAgent}
          projectAgents={projectAgents}
          onChangePreferredAgent={onChangePreferredAgent}
        />
      )}
    </div>
  )
}

function CommentModeInput({
  issue, comment, commentKey, posting, postingType, canProgressStage: canProgress, agentWork,
  preferredAgent, NEXT_STAGE, commentPasteHandlers,
  onSetComment, onPostComment, onCommentAndRetry, onCommentAndDone, onCommentAndNextStage, onCommentAndInflow, handOff,
}: {
  issue: BottomInputAreaProps['issue']
  comment: string
  commentKey: string
  posting: boolean
  postingType: 'comment' | 'retry' | 'done' | 'next' | 'inflow' | null
  canProgressStage: boolean
  agentWork: BottomInputAreaProps['agentWork']
  preferredAgent: BottomInputAreaProps['preferredAgent']
  NEXT_STAGE: Record<string, { stage: string; action: string; label: string }>
  commentPasteHandlers: { onPaste: any; onDrop: any; onDragOver: any }
  onSetComment: (v: string) => void
  onPostComment: () => void
  onCommentAndRetry: (agentId?: string | null) => void
  onCommentAndDone: () => void
  onCommentAndNextStage: () => void
  onCommentAndInflow: () => void
  handOff: StageHandOff | null
}) {
  const tIssue = useTranslations('issue')

  // 에이전트가 이 작업을 하는 동안은 단계 버튼(유입·재실행·검증 시작·확인 등)을 내놓지 않는다 — 누르면 같은 일을 겹쳐 하게 된다.
  // 코멘트는 그대로 남길 수 있다. 서버(stage 라우트)도 같은 이유로 막는다.
  const canProgressStage = canProgress && !agentWork
  // 닫힌 작업 — 앞으로 가는 단계 버튼(검증 시작·확인 등)과 유입은 내놓지 않는다. 「← 재실행」은 이슈를 다시 열어 재처리하는 길이라 남긴다
  const isClosed = issue.state === 'closed'
  // 단, 검증·확인 도중에 닫힌 작업(MR 머지의 닫기 키워드로 Git 이 닫음 등)은 다음 단계로 이어 갈 수 있어야 정리된다 — 서버가 이슈를 다시 연다
  const forwardOk = !isClosed || isClosedMidway(issue)
  // 등록 뒤(입력이 비면) 늘어난 높이를 되돌린다
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = commentTextareaRef.current
    if (!comment && el) { el.style.height = ''; el.style.overflow = 'hidden' }
  }, [comment])

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={commentTextareaRef}
        value={comment}
        onChange={e => {
          onSetComment(e.target.value)
          localStorage.setItem(commentKey, e.target.value)
          e.target.style.height = 'auto'
          const h = Math.min(e.target.scrollHeight, 120)
          e.target.style.height = h + 'px'
          e.target.style.overflow = e.target.scrollHeight > 120 ? 'auto' : 'hidden'
        }}
        onPaste={commentPasteHandlers.onPaste}
        onDrop={commentPasteHandlers.onDrop}
        onDragOver={commentPasteHandlers.onDragOver}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          if (e.nativeEvent.isComposing) return  // 한글 조합 확정 Enter — 보내면 마지막 글자가 입력창에 남는다
          const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
          if (isMobile) return
          if (e.shiftKey) return
          e.preventDefault()
          onPostComment()
        }}
        placeholder={tIssue('commentPlaceholder')}
        rows={1}
        className="w-full min-h-10 bg-ive-bg-card border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50 overflow-hidden"
      />
      <div className="flex gap-2 items-center overflow-hidden">
        {/* ← 후진: 재실행 (현재 stage 를 스케줄로 되돌림). dev/none 단계에선 backward 액션 없음.
            dev_fail 은 처리 단계에서의 실패이므로 '이전 단계'(유입)로 가는 게 아니라 '재처리' 의미. */}
        <div className="flex-1 flex justify-start gap-1.5">
          {/* 유입 버튼 — 검증대기/검증 단계에서만 표시 (이전 버튼 앞에 위치) */}
          {canProgressStage && !isClosed && (issue.stage === 'verify_waiting' || issue.stage === 'verifying') && (
            <button
              onClick={onCommentAndInflow}
              disabled={posting || !comment.trim()}
              className="shrink-0 h-10 w-10 pad:w-auto pad:px-3 rounded-lg border border-ive-red/40 text-ive-red bg-ive-bg-card hover:bg-ive-red/10 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 text-xs font-bold whitespace-nowrap"
              title={tIssue('inflowHint')}
              aria-label={tIssue('inflowShort')}
            >
              {postingType === 'inflow' ? <i className="fa-solid fa-circle-notch fa-spin" /> : (
                <><i className="fa-solid fa-rotate-left text-sm pad:text-[10px]" /><span className="hidden pad:inline">{tIssue('inflowShort')}</span></>
              )}
            </button>
          )}
          {canProgressStage && issue.stage !== 'dev' && issue.stage !== 'none' && !(preferredAgent?.assignMode === 'assignee' && NEXT_STAGE[issue.stage]) && (() => {
            const isReprocess = issue.stage === 'dev_fail'
            return (
              <button
                onClick={() => onCommentAndRetry()}
                disabled={posting || !comment.trim()}
                className="shrink-0 h-10 w-10 pad:w-auto pad:px-3 rounded-lg border border-ive-amber/40 text-ive-amber bg-ive-bg-card hover:bg-ive-amber/10 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                title={tIssue(isReprocess ? 'postAndReprocessHint' : 'postAndRetryHint')}
                aria-label={tIssue(isReprocess ? 'postAndReprocess' : 'postAndRetry')}
              >
                {postingType === 'retry' ? <i className="fa-solid fa-circle-notch fa-spin" /> : (
                  <>
                    <i className={`fa-solid ${isReprocess ? 'fa-arrow-rotate-right' : 'fa-arrow-left'} text-sm pad:text-[10px]`} />
                    <span className="hidden pad:inline">{tIssue(isReprocess ? 'reprocess' : 'rerun')}</span>
                  </>
                )}
              </button>
            )
          })()}
        </div>

        {/* 가운데: 단계를 옮기지 않는 일 — 코멘트만(stay) · 에이전트 호출(지금 단계의 검증·확인을 에이전트에게 맡긴다) */}
        <div className="flex items-center gap-1.5">
        <button
          onClick={onPostComment}
          disabled={posting || !comment.trim()}
          className="shrink-0 h-10 w-10 pad:w-auto pad:px-3 rounded-lg bg-ive-green text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
          title={tIssue('postCommentOnly')}
          aria-label={tIssue('postComment')}
        >
          {postingType === 'comment' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-paper-plane" /><span className="hidden pad:inline">{tIssue('postCommentShort')}</span></>}
        </button>
        {handOff && canProgressStage && forwardOk && <HandOffButton handOff={handOff} disabled={posting} />}
        </div>

        {/* 전진 →: 다음 단계 진입 (검증완료/다음단계로) */}
        <div className="flex-1 flex justify-end">
          {(() => {
            // 검증대기·확인대기는 늘 「검증 시작 →」·「확인 시작 →」 — 에이전트가 맡았어도 MR 없음 등으로 못 맡으면 사람이 진행한다
            const showNext = (preferredAgent?.assignMode === 'assignee' || issue.stage === 'none' || issue.stage === 'verify_waiting' || issue.stage === 'confirm_waiting') && !!NEXT_STAGE[issue.stage] && canProgressStage && forwardOk
            const showDone = !((preferredAgent?.assignMode === 'assignee' || issue.stage === 'none') && NEXT_STAGE[issue.stage]) && canProgressStage && forwardOk && (issue.stage === 'verifying' || issue.stage === 'confirming')
            return (
              <div className="flex items-center gap-1.5">
                {showNext && (
                  <button
                    onClick={onCommentAndNextStage}
                    disabled={posting}
                    className={`shrink-0 h-10 w-10 pad:w-auto pad:px-3 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap`}
                    title={issue.stage === 'none' ? tIssue('startProcessingHint') : NEXT_STAGE[issue.stage].label}
                    aria-label={NEXT_STAGE[issue.stage].label}
                  >
                    {postingType === 'next' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><span className="hidden pad:inline">{NEXT_STAGE[issue.stage].label}</span><i className="fa-solid fa-arrow-right text-sm pad:text-[10px]" /></>}
                  </button>
                )}
                {showDone && (
                  <button
                    onClick={onCommentAndDone}
                    disabled={posting || !comment.trim()}
                    className={`shrink-0 h-10 w-10 pad:w-auto pad:px-3 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap`}
                    title={tIssue('postAndDoneHint')}
                    aria-label={tIssue('postAndDone')}
                  >
                    {postingType === 'done' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><span className="hidden pad:inline">{NEXT_STAGE[issue.stage]?.label || tIssue('done')}</span><i className="fa-solid fa-arrow-right text-sm pad:text-[10px]" /></>}
                  </button>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

const CHAT_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i
function collectImageFiles(list: FileList | null | undefined): File[] {
  if (!list || list.length === 0) return []
  const out: File[] = []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    if (f.type.startsWith('image/') || CHAT_IMAGE_EXT_RE.test(f.name)) out.push(f)
  }
  return out
}

function ChatModeInput({
  chatInput, chatSending, chatImages, onSetChatInput, onAddChatImages, onRemoveChatImage, onSendChatMessage,
}: {
  chatInput: string
  chatSending: boolean
  chatImages: ChatImageItem[]
  onSetChatInput: (v: string) => void
  onAddChatImages: (files: File[]) => void
  onRemoveChatImage: (id: string) => void
  onSendChatMessage: () => void
}) {
  const tIssue = useTranslations('issue')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 보낸 뒤(입력이 비면) 늘어난 높이를 되돌린다 — onChange 에서만 키워서 보낸 뒤에도 큰 채로 남았다
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (!chatInput && chatTextareaRef.current) chatTextareaRef.current.style.height = '' }, [chatInput])
  const anyUploading = chatImages.some(c => c.uploading)
  const canSend = !chatSending && !anyUploading && (!!chatInput.trim() || chatImages.some(c => c.url && !c.error))

  return (
    <div className="flex flex-col gap-2">
      {/* 첨부 이미지 썸네일 */}
      {chatImages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chatImages.map(img => (
            <div key={img.id} className="relative w-14 h-14 rounded-lg overflow-hidden border border-ive-border-subtle bg-ive-bg-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.preview} alt="" className="w-full h-full object-cover" />
              {(img.uploading || img.error) && (
                <div className="absolute inset-0 flex items-center justify-center bg-ive-bg-deep/70">
                  {img.uploading
                    ? <i className="fa-solid fa-circle-notch fa-spin text-ive-cyan text-xs" />
                    : <i className="fa-solid fa-triangle-exclamation text-ive-red text-xs" />}
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveChatImage(img.id)}
                className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-ive-bg-deep/80 text-ive-text-dim hover:text-ive-red rounded-bl-lg"
                aria-label="remove"
              >
                <i className="fa-solid fa-xmark text-[10px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { const fs = collectImageFiles(e.target.files); if (fs.length) onAddChatImages(fs); e.target.value = '' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={chatSending}
          className="shrink-0 w-10 h-10 rounded-lg bg-ive-bg-card border border-ive-cyan/30 text-ive-text-dim hover:text-ive-cyan flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
          aria-label={tIssue('attachImage')}
          title={tIssue('attachImage')}
        >
          <i className="fa-solid fa-image" />
        </button>
        <textarea
          ref={chatTextareaRef}
          value={chatInput}
          onChange={e => {
            onSetChatInput(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
          }}
          onPaste={e => { const fs = collectImageFiles(e.clipboardData?.files); if (fs.length) { e.preventDefault(); onAddChatImages(fs) } }}
          onDrop={e => { const fs = collectImageFiles(e.dataTransfer?.files); if (fs.length) { e.preventDefault(); onAddChatImages(fs) } }}
          onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }}
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            if (e.nativeEvent.isComposing) return  // 한글 조합 확정 Enter — 보내면 마지막 글자가 입력창에 남는다
            const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            if (isMobile) return
            if (e.shiftKey) return
            e.preventDefault()
            onSendChatMessage()
          }}
          placeholder={tIssue('chatPlaceholder')}
          rows={1}
          className="flex-1 min-h-10 bg-ive-bg-card border border-ive-cyan/30 rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-cyan/50 disabled:opacity-50"
          style={{ overflow: 'auto', scrollbarGutter: 'stable' }}
        />
        <button
          onClick={onSendChatMessage}
          disabled={!canSend}
          className="shrink-0 w-10 h-10 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
        >
          {chatSending ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
        </button>
      </div>
    </div>
  )
}

function ChatHistoryPrompt({ onStartChat }: { onStartChat: (force?: boolean) => void }) {
  const tIssue = useTranslations('issue')

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-ive-text-dim">
        <i className="fa-solid fa-clock-rotate-left mr-1" />{tIssue('chatEnded')}
      </span>
      <button
        onClick={() => onStartChat()}
        className="text-xs font-bold text-ive-cyan hover:opacity-80 transition-opacity"
      >
        <i className="fa-solid fa-plus mr-1" />{tIssue('startNewChat')}
      </button>
    </div>
  )
}

function ChatStartPrompt({ onStartChat }: { onStartChat: (force?: boolean) => void }) {
  const tIssue = useTranslations('issue')

  return (
    <div className="text-center py-2">
      <button
        onClick={() => onStartChat()}
        className="text-sm font-bold text-ive-cyan hover:opacity-80 transition-opacity"
      >
        <i className="fa-solid fa-comments mr-1" />{tIssue('startChat')}
      </button>
    </div>
  )
}


/**
 * 「에이전트 호출」 버튼 — 지금 단계 일(검증·확인)을 에이전트에게 맡긴다. 앞으로 가는 버튼 앞에 따로 둔다.
 * 고르게 하지 않는다: 입력창 위에서 작업자(에이전트)를 골라 두었으면 그 에이전트에게, 아니면 맡을 수 있는 에이전트에게 자동 배정.
 */
function HandOffButton({ handOff, disabled }: { handOff: StageHandOff; disabled: boolean }) {
  const tIssue = useTranslations('issue')
  const hint = handOff.target ? tIssue('callAgentTo', { agent: handOff.target.name }) : tIssue('callAgentAuto')
  const title = handOff.note ? `${hint}\n${tIssue('agentBlocked', { note: handOff.note })}` : hint

  return (
    <button
      type="button"
      onClick={handOff.onCall}
      disabled={disabled || handOff.busy}
      className={`shrink-0 h-10 w-10 pad:w-auto pad:px-3 rounded-lg border bg-ive-bg-card flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 text-xs font-bold whitespace-nowrap ${handOff.kind === 'verify'
        ? 'border-ive-stage-verify/40 text-ive-stage-verify hover:bg-ive-stage-verify/10'
        : 'border-ive-stage-confirm/40 text-ive-stage-confirm hover:bg-ive-stage-confirm/10'}`}
      title={title}
      aria-label={hint}
    >
      {/* 폰 폭은 하단 버튼 모두 아이콘만(줄 폭 확보) — 넓은 칸에서 글자까지 */}
      {handOff.busy ? <i className="fa-solid fa-circle-notch fa-spin" /> : <>
        <i className="fa-solid fa-robot text-sm pad:text-[10px]" />
        <span className="hidden pad:inline">{tIssue('callAgent')}</span>
      </>}
    </button>
  )
}
