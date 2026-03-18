'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useDialog } from '@/components/ui/ConfirmDialog'
import MRReviewSection from '@/components/mr/MRReviewSection'
import ReactMarkdown from 'react-markdown'

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
}

interface Note {
  id: number
  body: string
  author: string
  system: boolean
  createdAt: string
}

const STAGE_INFO: Record<string, { label: string; color: string; icon: string; bg: string }> = {
  waiting:    { label: '대기',     color: 'text-ive-green',    icon: 'fa-clock',              bg: 'bg-ive-green/10' },
  dev:        { label: '개발 중',  color: 'text-ive-cyan',     icon: 'fa-code',               bg: 'bg-ive-cyan/10' },
  dev_fail:   { label: '개발 실패', color: 'text-ive-red',     icon: 'fa-circle-xmark',       bg: 'bg-ive-red/10' },
  done:       { label: '완료',     color: 'text-emerald-400', icon: 'fa-circle-check',       bg: 'bg-emerald-500/10' },
  unknown:    { label: '알 수 없음', color: 'text-ive-text-dim', icon: 'fa-question',         bg: 'bg-white/5' },
}

interface StageAction {
  action: string
  label: string
  icon: string
  danger?: boolean
}

const STAGE_ACTIONS: Record<string, StageAction[]> = {
  waiting: [],
  dev: [
    { action: 'cancel', label: '개발 취소 (대기로)', icon: 'fa-rotate-left', danger: true },
  ],
  dev_fail: [
    { action: 'retry', label: '재시도 (대기로)', icon: 'fa-rotate' },
  ],
  done: [
    { action: 'reopen', label: '다시 열기 (대기로)', icon: 'fa-rotate' },
  ],
}

export default function IssueDetailPage({ params }: { params: Promise<{ projectId: string; iid: string }> }) {
  const { projectId, iid } = use(params)
  const router = useRouter()
  const { confirm } = useDialog()
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [stageChanging, setStageChanging] = useState(false)
  const [showDesc, setShowDesc] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const notesEndRef = useRef<HTMLDivElement>(null)

  const fetchIssue = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}`)
    if (res.ok) {
      setIssue(await res.json())
    }
    setLoading(false)
  }, [projectId, iid])

  const fetchNotes = useCallback(async () => {
    setNotesLoading(true)
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`)
    if (res.ok) {
      const data = await res.json()
      setNotes(data)
    }
    setNotesLoading(false)
  }, [projectId, iid])

  useEffect(() => {
    fetchIssue()
    fetchNotes()
  }, [fetchIssue, fetchNotes])

  async function handleStageAction(action: string) {
    if (!issue) return
    setStageChanging(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: issue.stage, action }),
      })
      if (res.ok) {
        await fetchIssue()
        await fetchNotes()
      }
    } finally {
      setStageChanging(false)
    }
  }

  async function handleCloseIssue() {
    const ok = await confirm({
      title: '이슈 닫기',
      message: `#${iid} 이슈를 닫으시겠습니까?`,
      confirmText: '닫기',
      cancelText: '취소',
      variant: 'warning',
    })
    if (!ok) return
    setIsClosing(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/close`, {
        method: 'POST',
      })
      if (res.ok) {
        router.back()
        return
      }
    } finally {
      setIsClosing(false)
    }
  }

  async function handlePostComment() {
    if (!comment.trim()) return
    setPosting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (res.ok) {
        setComment('')
        await fetchNotes()
      }
    } finally {
      setPosting(false)
    }
  }

  // 코멘트 작성 + 상태를 대기로 변경 (재실행 트리거)
  async function handleCommentAndRetry() {
    if (!comment.trim()) return
    setPosting(true)
    try {
      // 1. 코멘트 등록
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (!res.ok) return
      setComment('')
      // 2. 상태를 대기로 변경 (waiting이면 이미 대기이므로 스킵)
      if (issue?.stage !== 'waiting') {
        const stageAction = issue?.stage === 'done' ? 'reopen' : 'retry'
        await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: issue?.stage, action: stageAction }),
        })
      }
      await fetchIssue()
      await fetchNotes()
    } finally {
      setPosting(false)
    }
  }

  function startEdit() {
    if (!issue) return
    setEditTitle(issue.title)
    setEditDesc(issue.description || '')
    setEditMode(true)
  }

  async function handleSaveEdit() {
    if (!editTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc }),
      })
      if (res.ok) {
        setEditMode(false)
        await fetchIssue()
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted">불러오는 중...</div>
  }

  if (!issue) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-ive-text-muted mb-4">이슈를 찾을 수 없습니다</p>
          <button onClick={() => router.back()} className="text-ive-green font-semibold">
            <i className="fa-solid fa-arrow-left mr-1" />돌아가기
          </button>
        </div>
      </div>
    )
  }

  const stageInfo = STAGE_INFO[issue.stage] || STAGE_INFO.unknown
  const actions = STAGE_ACTIONS[issue.stage] || []
  const iterationCount = notes.filter(n => n.body.includes('IVE(봇)')).length

  return (
    <div className="h-screen flex flex-col">
      {/* 헤더: 뒤로가기 + 이슈번호 + 상태 + 외부링크 */}
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 max-w-lg mx-auto">
          <button onClick={() => router.back()} className="text-ive-green font-semibold p-1 hover:bg-ive-green/5 rounded shrink-0">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <span className="text-base font-black text-ive-green shrink-0">#{issue.iid}</span>
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${stageInfo.bg} ${stageInfo.color} border-current/20 shrink-0`}>
            <i className={`fa-solid ${stageInfo.icon} mr-0.5`} />{stageInfo.label}
          </span>
          {iterationCount > 0 && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded border bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20 shrink-0" title={`${iterationCount}회 작업 완료`}>
              <i className="fa-solid fa-repeat mr-0.5" />{iterationCount}차
            </span>
          )}
          <span className="text-xs text-ive-text-dim shrink-0"><i className="fa-solid fa-user mr-0.5" />{issue.author}</span>
          <span className="text-xs text-ive-text-dim ml-auto shrink-0">
            {new Date(issue.updatedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
        </div>
        {/* 제목 + 설명 토글 + 단계 변경 */}
        <div className="px-3 pb-2 max-w-lg mx-auto">
          {editMode ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm font-bold text-ive-text focus:outline-none focus:border-ive-green"
                placeholder="제목"
                autoFocus
              />
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text resize-none focus:outline-none focus:border-ive-green"
                placeholder="설명 (선택)"
                rows={4}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !editTitle.trim()}
                  className="flex-1 text-xs font-bold text-ive-green border border-ive-green/30 py-1.5 rounded-lg hover:bg-ive-green/10 transition-colors disabled:opacity-40"
                >
                  {saving ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-check mr-1" />저장</>}
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="flex-1 text-xs font-bold text-ive-text-dim border border-ive-border py-1.5 rounded-lg hover:bg-ive-bg-deep transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <h1 className="text-sm font-bold text-ive-text leading-snug flex-1 line-clamp-2">{issue.title}</h1>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={startEdit}
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle hover:text-ive-green hover:border-ive-green/30 transition-all"
                    title="수정"
                  >
                    <i className="fa-solid fa-pen text-xs" />
                  </button>
                  {issue.description && (
                    <button onClick={() => setShowDesc(!showDesc)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showDesc ? 'bg-ive-green/10 text-ive-green' : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'}`} title="설명 보기">
                      <i className={`fa-solid fa-file-lines text-xs`} />
                    </button>
                  )}
                  {actions.map(act => (
                    <button
                      key={act.action}
                      onClick={() => handleStageAction(act.action)}
                      disabled={stageChanging}
                      className={`h-7 px-2 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 ${
                        act.danger
                          ? 'text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10'
                          : 'text-ive-green border-ive-green/30 bg-ive-bg-card hover:bg-ive-green/10'
                      }`}
                    >
                      {stageChanging ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className={`fa-solid ${act.icon} mr-0.5`} />{act.label}</>}
                    </button>
                  ))}
                  <button
                    onClick={handleCloseIssue}
                    disabled={isClosing || stageChanging}
                    className="h-7 px-2 rounded-lg text-xs font-bold border text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10 transition-all active:scale-95 disabled:opacity-40"
                  >
                    {isClosing ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-xmark mr-0.5" />닫기</>}
                  </button>
                </div>
              </div>
              {showDesc && issue.description && (
                <div className="mt-1.5 text-sm text-ive-text-muted bg-ive-bg-card rounded-lg p-2.5 whitespace-pre-wrap break-words leading-relaxed max-h-[30vh] overflow-y-auto">
                  {issue.description}
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {/* 활동 기록 - 남은 공간 전체 사용 */}
      <div className="flex-1 flex flex-col min-h-0 max-w-lg mx-auto w-full">
        <div className="flex-1 overflow-y-auto pb-2 pl-3 pr-1">
          {/* MR 리뷰 섹션 - 스크롤 영역 안에 배치 */}
          {(issue.stage === 'done' || issue.stage === 'dev') && (
            <div className="pr-2">
              <MRReviewSection projectId={projectId} issueIid={Number(iid)} />
            </div>
          )}

          <div className="py-1.5 pr-2 flex items-center justify-between mt-2 sticky top-0 z-10 bg-ive-bg-deep/95 backdrop-blur-sm">
            <span className="text-xs font-bold text-ive-text-dim uppercase tracking-widest">
              <i className="fa-solid fa-comments mr-1" />활동 기록
              {!notesLoading && <span className="ml-1 opacity-50">({notes.length})</span>}
            </span>
            {notes.length > 0 && (
              <button
                onClick={() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="text-xs font-bold text-ive-text-dim hover:text-ive-green border border-ive-border-subtle hover:border-ive-green/30 px-2 py-0.5 rounded-lg transition-all"
                title="마지막 노트로 이동"
              >
                <i className="fa-solid fa-angles-down mr-1" />마지막
              </button>
            )}
          </div>

          {notesLoading ? (
            <div className="text-center py-10 text-ive-text-dim text-sm">노트 불러오는 중...</div>
          ) : notes.length === 0 ? (
            <div className="text-center py-10 text-ive-text-dim text-sm">아직 활동 기록이 없습니다</div>
          ) : (
            <div className="space-y-1.5">
              {notes.map(note => {
                const isBot = !note.system && note.body.includes('IVE(봇)')
                return (
                <div key={note.id} className={`rounded-lg px-3 py-2 ${
                  note.system
                    ? 'bg-white/[0.02]'
                    : isBot
                      ? 'bg-ive-bg-card border border-ive-border-subtle'
                      : 'bg-ive-green/[0.06] border border-ive-green/20'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold ${
                      note.system ? 'text-ive-text-dim' : isBot ? 'text-ive-cyan' : 'text-ive-green'
                    }`}>
                      {note.system ? (
                        <><i className="fa-solid fa-gear mr-0.5" />시스템</>
                      ) : isBot ? (
                        <><i className="fa-solid fa-robot mr-0.5" />IVE 봇</>
                      ) : (
                        <><i className="fa-solid fa-user mr-0.5" />사용자</>
                      )}
                    </span>
                    <span className="text-xs text-ive-text-dim ml-auto">
                      {new Date(note.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  </div>
                  <div className={`text-sm leading-relaxed break-words ${note.system ? 'text-ive-text-dim italic' : 'text-ive-text-muted'}`}>
                    {note.body.length > 500 ? <NoteBody body={note.body} /> : <MarkdownNote body={cleanNoteBody(note.body)} />}
                  </div>
                </div>
                )
              })}
              <div ref={notesEndRef} />
            </div>
          )}
        </div>

        {/* 코멘트 입력 - 하단 고정 */}
        <div className="shrink-0 px-3 pb-20 pt-2 border-t border-ive-border-dark bg-ive-bg-deep/80">
          <div className="flex gap-2 items-end">
            <textarea
              value={comment}
              onChange={e => {
                setComment(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              }}
              placeholder="코멘트..."
              rows={1}
              className="flex-1 bg-ive-bg-card border border-ive-border rounded-xl px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50"
              style={{ overflow: 'hidden' }}
            />
            <button
              onClick={handlePostComment}
              disabled={posting || !comment.trim()}
              className="shrink-0 w-10 h-10 rounded-xl bg-ive-green text-ive-bg-deep flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
              title="코멘트만 등록"
            >
              {posting ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
            </button>
            {issue.stage !== 'dev' && (
              <button
                onClick={handleCommentAndRetry}
                disabled={posting || !comment.trim()}
                className="shrink-0 h-10 px-3 rounded-xl bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1 active:scale-95 transition-all disabled:opacity-40 text-xs font-bold"
                title="코멘트 등록 + 재실행"
              >
                {posting ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-paper-plane" /><i className="fa-solid fa-play" /></>}
              </button>
            )}
          </div>
        </div>
      </div>

      <MobileTabBar />
    </div>
  )
}

/** 노트 본문 정리: 도구 태그 제거, HTML 태그를 MD로 변환 */
function cleanNoteBody(body: string): string {
  return body
    .split('\n')
    .filter(line => !line.match(/^>\s*\*{0,2}🔧/))
    .join('\n')
    .replace(/<details>/gi, '')
    .replace(/<\/details>/gi, '')
    .replace(/<summary>(.*?)<\/summary>/gi, '**$1**')
    .replace(/<\/?br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:div|span|p)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function MarkdownNote({ body }: { body: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="text-base font-bold text-ive-text mt-2 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold text-ive-text mt-2 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold text-ive-text mt-1.5 mb-0.5">{children}</h3>,
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-bold text-ive-text">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          if (isBlock) {
            return <code className="block bg-ive-bg-deep rounded-lg p-2 my-1.5 text-xs font-mono overflow-x-auto whitespace-pre">{children}</code>
          }
          return <code className="bg-ive-bg-deep px-1 py-0.5 rounded text-xs font-mono text-ive-cyan">{children}</code>
        },
        pre: ({ children }) => <pre className="mb-1.5">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-ive-border pl-2.5 my-1.5 text-ive-text-dim">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ive-cyan hover:underline">{children}</a>,
        hr: () => <hr className="border-ive-border-dark my-2" />,
      }}
    >
      {body}
    </ReactMarkdown>
  )
}

// 긴 노트를 접었다 펼 수 있는 컴포넌트
function NoteBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false)
  const cleaned = cleanNoteBody(body)
  const display = expanded ? cleaned : cleaned.slice(0, 500) + '...'
  return (
    <>
      <MarkdownNote body={display} />
      <button
        onClick={() => setExpanded(!expanded)}
        className="block mt-1 text-xs text-ive-green hover:underline"
      >
        {expanded ? '접기' : '전체 보기'}
      </button>
    </>
  )
}
