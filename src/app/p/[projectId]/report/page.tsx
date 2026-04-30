'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { getKSTTodayString } from '@/lib/date-utils'
import { createImagePasteHandlers } from '@/lib/paste-upload'

const translations: Record<string, Record<string, string>> = {
  ko: {
    title: '{name} 문제 신고',
    titleDefault: '문제 신고',
    subtitle: '발견한 문제나 작업 요청 사항을 알려주세요. 첫 줄은 제목으로, 이후 내용은 본문으로 등록됩니다.',
    placeholder: '작업 내용을 입력하세요...\n\n예:\n로그인 버튼이 작동하지 않음\n\n로그인 페이지에서 이메일과 비밀번호를 입력하고 로그인 버튼을 클릭했지만 아무 반응이 없습니다.\n크롬 브라우저 최신 버전에서 확인했습니다.',
    titlePreview: '제목:',
    autoInfo: '자동으로 수집되는 정보 보기',
    referrer: '이전 페이지',
    browser: '브라우저',
    language: '언어',
    screen: '화면',
    time: '시간',
    submit: '확인',
    submitting: '등록 중...',
    successTitle: '작업이 접수되었습니다',
    successDesc: '빠른 시일 내에 처리하겠습니다.',
    retry: '추가 접수하기',
    errorTitle: '접근 불가',
    loading: '로딩 중...',
    dueDate: '마감일',
    dueDateOptional: '(선택)',
    dueDateClear: '마감일 지우기',
    dueDateTomorrow: '내일',
    dueDateNextWeek: '다음 주',
  },
  en: {
    title: 'Task Submission — {name}',
    titleDefault: 'Task Submission',
    subtitle: 'Tell us about the issue or task request. The first line will be the title, and the rest will be the body.',
    placeholder: 'Describe the task...\n\nExample:\nLogin button not working\n\nI entered my email and password on the login page and clicked the login button, but nothing happened.\nConfirmed on the latest version of Chrome.',
    titlePreview: 'Title:',
    autoInfo: 'View automatically collected info',
    referrer: 'Referrer',
    browser: 'Browser',
    language: 'Language',
    screen: 'Screen',
    time: 'Time',
    submit: 'Submit',
    submitting: 'Submitting...',
    successTitle: 'Task submitted',
    successDesc: 'We will look into it as soon as possible.',
    retry: 'Submit another task',
    errorTitle: 'Access Denied',
    loading: 'Loading...',
    dueDate: 'Due date',
    dueDateOptional: '(optional)',
    dueDateClear: 'Clear due date',
    dueDateTomorrow: 'Tomorrow',
    dueDateNextWeek: 'Next week',
  },
}

type Locale = 'ko' | 'en'

function useLocale(): Locale {
  const searchParams = useSearchParams()
  const lang = searchParams.get('lang')
  if (lang === 'en' || lang === 'ko') return lang

  // Default to 'ko' during SSR to avoid hydration mismatch
  // Client-side detection happens after mount
  return 'ko'
}

function useClientLocale(): Locale {
  const searchParams = useSearchParams()
  const lang = searchParams.get('lang')
  if (lang === 'en' || lang === 'ko') return lang

  const [locale, setLocale] = useState<Locale>('ko')

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      const browserLang = navigator.language.toLowerCase()
      if (browserLang.startsWith('en')) {
        setLocale('en')
      }
    }
  }, [])

  return locale
}

function t(locale: Locale, key: string): string {
  return translations[locale]?.[key] ?? translations.ko[key] ?? key
}

interface BrowserInfo {
  referrer: string
  userAgent: string
  language: string
  screenWidth: number
  screenHeight: number
  timestamp: string
}

function getBrowserInfo(): BrowserInfo {
  return {
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    screenWidth: typeof window !== 'undefined' ? window.screen.width : 0,
    screenHeight: typeof window !== 'undefined' ? window.screen.height : 0,
    timestamp: new Date().toISOString(),
  }
}

export default function ReportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const nonce = searchParams.get('nonce') ?? ''
  const ts = parseInt(searchParams.get('ts') ?? '0', 10)
  const exp = parseInt(searchParams.get('exp') ?? '0', 10)
  const locale = useClientLocale()

  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [content, setContent] = useState('')
  const [dueDate, setDueDate] = useState('')

  const browserInfo = useMemo(() => getBrowserInfo(), [])

  const contentRef = useRef(content)
  useEffect(() => { contentRef.current = content }, [content])

  const pasteHandlers = useMemo(() => createImagePasteHandlers({
    projectId: projectId,
    getValue: () => contentRef.current,
    setValue: v => setContent(v),
    onError: msg => alert(msg),
    uploadFn: async (file) => {
      if (!projectId || !token || !nonce || !ts || !exp) {
        throw new Error('인증 정보가 없습니다.')
      }
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      fd.append('token', token)
      fd.append('nonce', nonce)
      fd.append('timestamp', String(ts))
      fd.append('expires', String(exp))
      const res = await fetch('/api/report/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        let msg = `업로드 실패 (${res.status})`
        try {
          const data = await res.json()
          if (data?.error) msg = data.error
        } catch {
          // ignore
        }
        throw new Error(msg)
      }
      return res.json()
    },
  }), [projectId, token, nonce, ts, exp])

  useEffect(() => {
    const loadProject = async () => {
      const p = await params
      setProjectId(p.projectId)

      if (!token || !nonce || !ts || !exp) {
        setError(t(locale, 'errorTitle'))
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/projects/${p.projectId}`)
        if (!res.ok) {
          setError(t(locale, 'errorTitle'))
          setLoading(false)
          return
        }
        const data = await res.json()
        if (!data.reportSecret) {
          setError(t(locale, 'errorTitle'))
          setLoading(false)
          return
        }
        setProjectName(data.name)
      } catch {
        setError(t(locale, 'errorTitle'))
      }
      setLoading(false)
    }
    loadProject()
  }, [params, token, nonce, ts, exp, locale])

  const handleSubmit = useCallback(async () => {
    if (!content.trim()) return
    if (!projectId) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          token,
          nonce,
          timestamp: ts,
          expires: exp,
          content: content.trim(),
          dueDate: dueDate || null,
          browserInfo,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '접수 등록에 실패했습니다.')
      }

      setSuccess(true)
      setContent('')
      setDueDate('')
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }, [content, projectId, token, nonce, ts, exp, browserInfo, dueDate])

  const firstLine = content.split('\n')[0]?.trim()
  const hasContent = content.trim().length > 0

  const titleText = projectName
    ? t(locale, 'title').replace('{name}', projectName)
    : t(locale, 'titleDefault')

  if (loading) {
    return (
      <div className="min-h-screen bg-ive-bg flex items-center justify-center">
        <div className="text-ive-text-muted text-lg font-bold">{t(locale, 'loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-ive-bg flex items-center justify-center p-4">
        <div className="bg-ive-bg-card border border-ive-border-dark rounded-lg p-8 max-w-md text-center">
          <div className="text-ive-red font-bold text-lg mb-2">{t(locale, 'errorTitle')}</div>
          <div className="text-ive-text-muted text-sm">{error}</div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-ive-bg flex items-center justify-center p-4">
        <div className="bg-ive-bg-card border border-ive-green-dark/30 rounded-lg p-8 max-w-md text-center">
          <div className="text-ive-cyan font-bold text-lg mb-2">{t(locale, 'successTitle')}</div>
          <div className="text-ive-text-muted text-sm mb-4">{t(locale, 'successDesc')}</div>
          <button
            onClick={() => setSuccess(false)}
            className="bg-ive-green-dark text-white font-bold text-sm px-4 py-3 rounded-lg hover:opacity-80"
          >
            {t(locale, 'retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ive-bg p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-ive-text">{titleText}</h1>
          <p className="text-sm text-ive-text-muted mt-1">{t(locale, 'subtitle')}</p>
        </div>

        {/* Editor */}
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={pasteHandlers.onPaste}
            onDrop={pasteHandlers.onDrop}
            onDragOver={pasteHandlers.onDragOver}
            placeholder={t(locale, 'placeholder')}
            className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none font-bold"
            rows={10}
          />

          {/* Title preview */}
          {firstLine && (
            <div className="mt-2 text-xs text-ive-text-muted">
              {t(locale, 'titlePreview')} <span className="text-ive-text font-bold">{firstLine}</span>
            </div>
          )}

          {/* Due date (optional) */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <label className="text-xs font-bold text-ive-text-muted shrink-0">
              <i className="fa-solid fa-calendar-days mr-1" />
              {t(locale, 'dueDate')}
              <span className="ml-1 text-ive-text-dim font-normal">{t(locale, 'dueDateOptional')}</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text focus:outline-none focus:border-ive-green font-bold"
            />
            {dueDate && (
              <button
                type="button"
                onClick={() => setDueDate('')}
                className="shrink-0 text-xs font-bold text-ive-text-muted hover:text-ive-red px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
                title={t(locale, 'dueDateClear')}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setDueDate(getKSTTodayString(new Date(Date.now() + 86400000)))}
              className="shrink-0 text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30 hover:bg-ive-green/20 px-2 py-1.5 rounded-lg transition-all"
            >
              {t(locale, 'dueDateTomorrow')}
            </button>
            <button
              type="button"
              onClick={() => setDueDate(getKSTTodayString(new Date(Date.now() + 7 * 86400000)))}
              className="shrink-0 text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30 hover:bg-ive-green/20 px-2 py-1.5 rounded-lg transition-all"
            >
              {t(locale, 'dueDateNextWeek')}
            </button>
          </div>

          {/* Auto-collected info */}
          <div className="mt-4 border-t border-ive-border-dark pt-3">
            <details className="text-xs text-ive-text-muted">
              <summary className="cursor-pointer font-bold hover:text-ive-text">
                {t(locale, 'autoInfo')}
              </summary>
              <div className="mt-2 space-y-1 font-bold">
                {browserInfo.referrer && (
                  <div>{t(locale, 'referrer')}: <span className="text-ive-text-muted">{browserInfo.referrer}</span></div>
                )}
                <div>{t(locale, 'browser')}: <span className="text-ive-text-muted">{browserInfo.userAgent}</span></div>
                <div>{t(locale, 'language')}: <span className="text-ive-text-muted">{browserInfo.language}</span></div>
                <div>{t(locale, 'screen')}: <span className="text-ive-text-muted">{browserInfo.screenWidth}×{browserInfo.screenHeight}</span></div>
                <div>{t(locale, 'time')}: <span className="text-ive-text-muted">{browserInfo.timestamp}</span></div>
              </div>
            </details>
          </div>

          {/* Submit */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={!hasContent || submitting}
              className="bg-ive-green-dark text-white font-bold text-sm px-4 py-3 rounded-lg disabled:opacity-40 hover:opacity-80"
            >
              {submitting ? t(locale, 'submitting') : t(locale, 'submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
