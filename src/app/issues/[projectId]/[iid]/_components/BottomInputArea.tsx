'use client'

import { useRef, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { createImagePasteHandlers } from '@/lib/paste-upload'
import AgentPickerDropdown from './AgentPickerDropdown'

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

interface BottomInputAreaProps {
  issue: IssueDetail
  mode: 'comment' | 'chat'
  canProgressStage: boolean
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
  onStartChat: (force?: boolean) => void
  onEndChat: () => void
  onSendChatMessage: () => void
  onChangePreferredAgent: (agentIdOrMode: string | null) => void
  onToast: (msg: string, type: 'success' | 'error') => void
}

export default function BottomInputArea({
  issue, mode, canProgressStage, projectId,
  comment, commentKey, posting, postingType,
  chatSessionId, chatHistoryOnly, chatStarting, chatSending, chatInput, chatImages, chatAgentName,
  preferredAgent, projectAgents, NEXT_STAGE,
  onSetMode, onSetComment, onSetChatInput, onAddChatImages, onRemoveChatImage,
  onPostComment, onCommentAndRetry, onCommentAndDone, onCommentAndNextStage, onCommentAndInflow,
  onStartChat, onEndChat, onSendChatMessage, onChangePreferredAgent, onToast,
}: BottomInputAreaProps) {
  const tIssue = useTranslations('issue')

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

  return (
    <div className="shrink-0 px-3 pb-20 pt-2 border-t border-ive-border-dark bg-ive-bg-deep max-w-lg mx-auto w-full">
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
          preferredAgent={preferredAgent}
          NEXT_STAGE={NEXT_STAGE}
          commentPasteHandlers={commentPasteHandlers}
          onSetComment={onSetComment}
          onPostComment={onPostComment}
          onCommentAndRetry={onCommentAndRetry}
          onCommentAndDone={onCommentAndDone}
          onCommentAndNextStage={onCommentAndNextStage}
          onCommentAndInflow={onCommentAndInflow}
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
  issue, comment, commentKey, posting, postingType, canProgressStage,
  preferredAgent, NEXT_STAGE, commentPasteHandlers,
  onSetComment, onPostComment, onCommentAndRetry, onCommentAndDone, onCommentAndNextStage, onCommentAndInflow,
}: {
  issue: BottomInputAreaProps['issue']
  comment: string
  commentKey: string
  posting: boolean
  postingType: 'comment' | 'retry' | 'done' | 'next' | 'inflow' | null
  canProgressStage: boolean
  preferredAgent: BottomInputAreaProps['preferredAgent']
  NEXT_STAGE: Record<string, { stage: string; action: string; label: string }>
  commentPasteHandlers: { onPaste: any; onDrop: any; onDragOver: any }
  onSetComment: (v: string) => void
  onPostComment: () => void
  onCommentAndRetry: (agentId?: string | null) => void
  onCommentAndDone: () => void
  onCommentAndNextStage: () => void
  onCommentAndInflow: () => void
}) {
  const tIssue = useTranslations('issue')

  return (
    <div className="flex flex-col gap-2">
      <textarea
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
          {canProgressStage && (issue.stage === 'verify_waiting' || issue.stage === 'verifying') && (
            <button
              onClick={onCommentAndInflow}
              disabled={posting || !comment.trim()}
              className="shrink-0 h-10 px-3 rounded-lg border border-ive-red/40 text-ive-red bg-ive-bg-card hover:bg-ive-red/10 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 text-xs font-bold whitespace-nowrap"
              title="코멘트와 함께 유입 상태로 초기화"
            >
              {postingType === 'inflow' ? <i className="fa-solid fa-circle-notch fa-spin" /> : (
                <><i className="fa-solid fa-rotate-left text-[10px]" /><span>유입</span></>
              )}
            </button>
          )}
          {canProgressStage && issue.stage !== 'dev' && issue.stage !== 'none' && !(preferredAgent?.assignMode === 'assignee' && NEXT_STAGE[issue.stage]) && (() => {
            const isReprocess = issue.stage === 'dev_fail'
            return (
              <button
                onClick={() => onCommentAndRetry()}
                disabled={posting || !comment.trim()}
                className="shrink-0 h-10 px-3 rounded-lg border border-ive-amber/40 text-ive-amber bg-ive-bg-card hover:bg-ive-amber/10 flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                title={tIssue(isReprocess ? 'postAndReprocessHint' : 'postAndRetryHint')}
                aria-label={tIssue(isReprocess ? 'postAndReprocess' : 'postAndRetry')}
              >
                {postingType === 'retry' ? <i className="fa-solid fa-circle-notch fa-spin" /> : (
                  <>
                    <i className={`fa-solid ${isReprocess ? 'fa-arrow-rotate-right' : 'fa-arrow-left'} text-[10px]`} />
                    <span>{tIssue(isReprocess ? 'reprocess' : 'rerun')}</span>
                  </>
                )}
              </button>
            )
          })()}
        </div>

        {/* 가운데: 코멘트만 (stay) */}
        <button
          onClick={onPostComment}
          disabled={posting || !comment.trim()}
          className="shrink-0 h-10 px-3 rounded-lg bg-ive-green text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
          title={tIssue('postCommentOnly')}
          aria-label={tIssue('postComment')}
        >
          {postingType === 'comment' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-paper-plane" /><span>{tIssue('postCommentShort')}</span></>}
        </button>

        {/* 전진 →: 다음 단계 진입 (검증완료/다음단계로) */}
        <div className="flex-1 flex justify-end">
          {(preferredAgent?.assignMode === 'assignee' || issue.stage === 'none') && NEXT_STAGE[issue.stage] && canProgressStage && (
            <button
              onClick={onCommentAndNextStage}
              disabled={posting}
              className="shrink-0 h-10 px-3 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
              title={issue.stage === 'none' ? tIssue('startProcessingHint') : undefined}
            >
              {postingType === 'next' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><span>{NEXT_STAGE[issue.stage].label}</span><i className="fa-solid fa-arrow-right text-[10px]" /></>}
            </button>
          )}
          {!((preferredAgent?.assignMode === 'assignee' || issue.stage === 'none') && NEXT_STAGE[issue.stage]) && canProgressStage && (issue.stage === 'verifying' || issue.stage === 'confirming') && (
            <button
              onClick={onCommentAndDone}
              disabled={posting || !comment.trim()}
              className="shrink-0 h-10 px-3 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
              title={tIssue('postAndDoneHint')}
              aria-label={tIssue('postAndDone')}
            >
              {postingType === 'done' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><span>{NEXT_STAGE[issue.stage]?.label || tIssue('done')}</span><i className="fa-solid fa-arrow-right text-[10px]" /></>}
            </button>
          )}
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
          aria-label={tIssue('attachImage') || '이미지 첨부'}
          title={tIssue('attachImage') || '이미지 첨부'}
        >
          <i className="fa-solid fa-image" />
        </button>
        <textarea
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
            const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            if (isMobile) return
            if (e.shiftKey) return
            e.preventDefault()
            onSendChatMessage()
          }}
          placeholder={tIssue('chatPlaceholder')}
          rows={1}
          disabled={chatSending}
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

