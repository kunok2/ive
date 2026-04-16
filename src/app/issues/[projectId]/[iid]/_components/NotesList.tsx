'use client'

import { RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateMedium } from '@/lib/format-date'
import MarkdownNote, { cleanNoteBody } from '@/components/ui/MarkdownNote'
import MRReviewSection from '@/components/mr/MRReviewSection'
import PullToRefresh from '@/components/ui/PullToRefresh'
import AgentAvatar from '@/components/agent/AgentAvatar'
import NoteBody from './NoteBody'
import ChatMessages from './ChatMessages'

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

interface Note {
  id: number
  body: string
  author: string
  avatarUrl: string
  iveAuthorAvatar?: string | null
  system: boolean
  createdAt: string
  isMine?: boolean
}

interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface NotesListProps {
  issue: IssueDetail
  notes: Note[]
  notesLoading: boolean
  loading: boolean
  showDesc: boolean
  canProgressStage: boolean
  projectId: string
  iid: string
  // Chat props
  mode: 'comment' | 'chat'
  chatSessionId: string | null
  chatHistoryOnly: boolean
  chatMessages: ChatMessage[]
  chatAgentName: string | null
  chatAgentAvatar: string | null
  chatSending: boolean
  chatSendingStartTime: number | null
  chatStreamText: string
  // Refs
  scrollContainerRef: RefObject<HTMLDivElement | null>
  notesEndRef: RefObject<HTMLDivElement | null>
  // Handlers
  onRefreshAll: () => Promise<void>
  onDeleteNote: (noteId: number) => void
}

export default function NotesList({
  issue, notes, notesLoading, loading, showDesc, canProgressStage,
  projectId, iid,
  mode, chatSessionId, chatHistoryOnly, chatMessages, chatAgentName, chatAgentAvatar,
  chatSending, chatSendingStartTime, chatStreamText,
  scrollContainerRef, notesEndRef,
  onRefreshAll, onDeleteNote,
}: NotesListProps) {
  const { state } = useStore()
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')

  return (
    <div className="flex-1 flex flex-col min-h-0 max-w-lg mx-auto w-full">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pb-2 pl-3 pr-1">
        <PullToRefresh onRefresh={onRefreshAll} scrollContainerRef={scrollContainerRef}>
          {/* 이슈 본문 - 스크롤 영역 안에 배치 */}
          {showDesc && issue.description && (
            <div className="mt-1.5 mr-2 text-sm text-ive-text bg-ive-bg-card rounded-lg p-2.5 break-words leading-relaxed">
              <MarkdownNote body={cleanNoteBody(issue.description)} projectId={projectId} />
            </div>
          )}
          {/* MR 리뷰 섹션 - 담당자 또는 관리자만 표시 */}
          {canProgressStage && (issue.stage === 'done' || issue.stage === 'dev' || issue.stage === 'verify_waiting' || issue.stage === 'verifying') && (
            <div className="pr-2">
              <MRReviewSection projectId={projectId} issueIid={Number(iid)} />
            </div>
          )}

          <div className="py-1.5 pr-2 flex items-center justify-between mt-2 sticky top-0 z-10 bg-ive-bg-deep/95 backdrop-blur-sm">
            <span className="text-xs font-bold text-ive-text-dim uppercase tracking-widest">
              <i className="fa-solid fa-comments mr-1" />{tIssue('activityLog')}
              {!notesLoading && <span className="ml-1 opacity-50">({notes.length})</span>}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={onRefreshAll}
                disabled={loading || notesLoading}
                className="text-xs font-bold text-ive-text-dim hover:text-ive-green border border-ive-border-subtle hover:border-ive-green/30 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                title={tc('refresh')}
              >
                <i className={`fa-solid fa-arrows-rotate mr-1 ${loading || notesLoading ? 'fa-spin' : ''}`} />{tc('refresh')}
              </button>
              {notes.length > 0 && (
                <button
                  onClick={() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="text-xs font-bold text-ive-text-dim hover:text-ive-green border border-ive-border-subtle hover:border-ive-green/30 px-3 py-1.5 rounded-lg transition-all"
                  title={tIssue('lastNoteTooltip')}
                >
                  <i className="fa-solid fa-angles-down mr-1" />{tIssue('last')}
                </button>
              )}
            </div>
          </div>

          {notesLoading ? (
            <div className="text-center py-10 text-ive-text-dim text-sm">{tIssue('loadingNotes')}</div>
          ) : notes.length === 0 ? (
            <div className="text-center py-10 text-ive-text-dim text-sm">{tIssue('noActivity')}</div>
          ) : (
            <div className="space-y-1.5">
              {notes.map(note => {
                const isIveUser = !!note.iveAuthorAvatar
                const isBot = !note.system && !isIveUser && (note.body.includes('<!-- ive-bot -->') || note.body.includes('IVE(봇)'))
                return (
                  <div key={note.id} className={`rounded-lg px-3 py-2 ${
                    note.system
                      ? 'bg-white/[0.02]'
                      : isBot
                        ? 'bg-ive-bg-card border border-ive-border-subtle'
                        : 'bg-ive-green/[0.06] border border-ive-green/20'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold flex items-center gap-1 ${
                        note.system ? 'text-ive-text-dim' : isBot ? 'text-ive-cyan' : 'text-ive-green'
                      }`}>
                        {note.system ? (
                          <><i className="fa-solid fa-gear mr-0.5" />{tIssue('system')}</>
                        ) : isBot ? (
                          <><i className="fa-solid fa-robot mr-0.5" />{tIssue('iveBot')}</>
                        ) : (
                          <>
                            {isIveUser && note.iveAuthorAvatar ? (
                              <AgentAvatar avatar={note.iveAuthorAvatar} size="xs" />
                            ) : note.avatarUrl ? (
                              <img src={note.avatarUrl} alt="" className="w-4 h-4 rounded-full" />
                            ) : (
                              <i className="fa-solid fa-user" />
                            )}
                            {note.author}
                          </>
                        )}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-ive-text-dim">
                          {formatDateMedium(note.createdAt, state.user?.locale, state.user?.timezone)}
                        </span>
                        {note.isMine && (
                          <button
                            onClick={() => onDeleteNote(note.id)}
                            className="text-ive-text-dim hover:text-ive-red transition-colors ml-1"
                            title={tc('delete')}
                          >
                            <i className="fa-solid fa-trash-can text-[10px]" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className={`text-sm leading-relaxed break-words ${note.system ? 'text-ive-text-dim italic' : 'text-ive-text-muted'}`}>
                      {note.body.length > 500 ? <NoteBody body={note.body} projectId={projectId} /> : <MarkdownNote body={cleanNoteBody(note.body)} projectId={projectId} />}
                    </div>
                  </div>
                )
              })}

              {/* Chat messages inline in timeline */}
              <ChatMessages
                mode={mode}
                chatSessionId={chatSessionId}
                chatHistoryOnly={chatHistoryOnly}
                chatMessages={chatMessages}
                chatAgentName={chatAgentName}
                chatAgentAvatar={chatAgentAvatar}
                chatSending={chatSending}
                chatSendingStartTime={chatSendingStartTime}
                chatStreamText={chatStreamText}
                iid={iid}
              />

              <div ref={notesEndRef} />
            </div>
          )}
          {/* MR 리뷰 섹션 - 노트 목록 하단에도 표시 */}
          {canProgressStage && (issue.stage === 'done' || issue.stage === 'dev' || issue.stage === 'verify_waiting' || issue.stage === 'verifying') && (
            <div className="pr-2 mt-2">
              <MRReviewSection projectId={projectId} issueIid={Number(iid)} />
            </div>
          )}
        </PullToRefresh>
      </div>
    </div>
  )
}
