'use client'

import { RefObject, useEffect, useRef } from 'react'
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
  authorAvatarUrl?: string | null
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
  /** 폭 제한 클래스 — 옆 칸이면 칸 전체 폭 */
  widthCls?: string
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
  /** 본문과 활동 기록 사이에 끼울 블록 (단계 자동화·증적 패널) */
  topSlot?: React.ReactNode
  notesEndRef: RefObject<HTMLDivElement | null>
  // Handlers
  onRefreshAll: () => Promise<void>
  onDeleteNote: (noteId: number) => void
}

export default function NotesList({
  widthCls = 'max-w-lg desk:max-w-3xl',
  issue, notes, notesLoading, loading, showDesc, canProgressStage,
  projectId, iid,
  mode, chatSessionId, chatHistoryOnly, chatMessages, chatAgentName, chatAgentAvatar,
  chatSending, chatSendingStartTime, chatStreamText,
  scrollContainerRef, notesEndRef,
  onRefreshAll, onDeleteNote, topSlot,
}: NotesListProps) {
  const { state } = useStore()
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')

  // 작업마다 마지막 스크롤 위치를 기억해 다시 열면 그 자리로(이 브라우저 탭 안에서만 — sessionStorage, 실행 목록과 같은 방식).
  // 노트를 다 받은 뒤 한 번 돌려놓고, 이미지가 늦게 떠 높이가 바뀌는 동안(약 1.5초)은 사용자가 스크롤하지 않았으면 다시 맞춘다.
  const scrollKey = `issue-scroll-${projectId}-${iid}`
  const restoredRef = useRef(false)
  useEffect(() => { restoredRef.current = false }, [scrollKey])
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || notesLoading || restoredRef.current) return
    restoredRef.current = true
    let saved = 0
    try { saved = Number(sessionStorage.getItem(scrollKey)) || 0 } catch { /* 저장소를 못 쓰면 맨 위에서 */ }
    if (saved <= 0) return
    let userMoved = false
    const apply = () => { if (!userMoved) el.scrollTop = saved }
    const stop = () => { userMoved = true }
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchmove', stop, { passive: true })
    el.addEventListener('keydown', stop)
    requestAnimationFrame(apply)
    const timers = [150, 500, 1000, 1500].map(ms => setTimeout(apply, ms))
    return () => {
      timers.forEach(clearTimeout)
      el.removeEventListener('wheel', stop); el.removeEventListener('touchmove', stop); el.removeEventListener('keydown', stop)
    }
  }, [notesLoading, scrollKey, scrollContainerRef])
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | null = null
    const save = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => { try { sessionStorage.setItem(scrollKey, String(Math.round(el.scrollTop))) } catch { /* ignore */ } }, 200)
    }
    el.addEventListener('scroll', save, { passive: true })
    return () => { el.removeEventListener('scroll', save); if (t) clearTimeout(t) }
  }, [scrollKey, scrollContainerRef])

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${widthCls} mx-auto w-full`}>
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pb-2 pl-3 pr-1">
        <PullToRefresh onRefresh={onRefreshAll} scrollContainerRef={scrollContainerRef}>
          {/* 이슈 본문 - 스크롤 영역 안에 배치 */}
          {showDesc && issue.description && (
            <div className="mt-1.5 mr-2 text-sm text-ive-text bg-ive-bg-card rounded-lg p-2.5 break-words leading-relaxed">
              <MarkdownNote body={cleanNoteBody(issue.description)} projectId={projectId} />
            </div>
          )}
          {topSlot}
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
          ) : (
            <div className="space-y-1.5">
              {notes.length === 0 ? (
                <div className="text-center py-10 text-ive-text-dim text-sm">{tIssue('noActivity')}</div>
              ) : (
                [...notes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map(note => {
                const hasBotMarker = !note.system && (note.body.includes('<!-- ive-bot -->') || note.body.includes('IVE(봇)'))
                const isIveUser = !hasBotMarker && !!note.iveAuthorAvatar
                const isBot = hasBotMarker
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
                          note.iveAuthorAvatar ? (
                            <><AgentAvatar avatar={note.iveAuthorAvatar} size="xs" /><span className="text-ive-cyan">{note.author}</span></>
                          ) : (
                            <><i className="fa-solid fa-robot mr-0.5" />{tIssue('iveBot')}</>
                          )
                        ) : (
                          <>
                            {isIveUser && note.iveAuthorAvatar ? (
                              <AgentAvatar avatar={note.iveAuthorAvatar} size="xs" />
                            ) : note.avatarUrl ? (
                              <img src={note.avatarUrl} alt="" className="w-4 h-4 rounded-lg" />
                            ) : (
                              <i className="fa-solid fa-user" />
                            )}
                            {note.author}
                          </>
                        )}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-ive-text-muted">
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
                })
              )}

              {/* 작업결과 반영(MR) — 처리 결과(노트) 다음, 채팅 이전의 시간순 위치 */}
              {canProgressStage && (issue.stage === 'done' || issue.stage === 'dev' || issue.stage === 'verify_waiting' || issue.stage === 'verifying') && (
                <MRReviewSection
                  projectId={projectId}
                  issueIid={Number(iid)}
                  onLayoutChange={() => {
                    // MR이 늦게 그려지며 아래 채팅을 뷰 밖으로 밀어내므로, 채팅 모드면 바닥으로 보정
                    if (mode === 'chat') requestAnimationFrame(() => notesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }))
                  }}
                />
              )}

              {/* Chat messages inline in timeline (머지 이후 작업이므로 MR 다음) */}
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
        </PullToRefresh>
      </div>
    </div>
  )
}
