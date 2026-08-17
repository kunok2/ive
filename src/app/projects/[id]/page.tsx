'use client'

import { use, useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import ProjectForm from '@/components/project/ProjectForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import CustomSelect from '@/components/ui/CustomSelect'
import { useTranslations } from 'next-intl'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { state, deleteProject } = useStore()

  const [showEditProject, setShowEditProject] = useState(false)
  const [showDeleteProject, setShowDeleteProject] = useState(false)
  const [showLeaveShare, setShowLeaveShare] = useState(false)
  const [reportSecret, setReportSecret] = useState<string | null>(null)
  const [reportToken, setReportToken] = useState<string | null>(null)
  const [reportNonce, setReportNonce] = useState<string | null>(null)
  const [reportTimestamp, setReportTimestamp] = useState<number>(0)
  const [reportExpires, setReportExpires] = useState<number>(0)
  const [generatingSecret, setGeneratingSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [secretVisible, setSecretVisible] = useState(false)
  const [gitMembers, setGitMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [gitMembersLoading, setGitMembersLoading] = useState(false)
  const [urlTheme, setUrlTheme] = useState<'dark' | 'light' | 'auto'>('auto')
  const [urlLang, setUrlLang] = useState<'auto' | 'ko' | 'en'>('auto')

  const tp = useTranslations('project')
  const tc = useTranslations('common')

  const project = state.projects.find(p => p.id === id)

  useEffect(() => {
    if (!project?.reportSecret) return
    setReportSecret(project.reportSecret)
    // 페이지 재진입 시 기존 secret으로 새 HMAC 토큰을 발급받는다
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/projects/${id}/report-secret`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled || !data.reportToken) return
        setReportToken(data.reportToken.token)
        setReportNonce(data.reportToken.nonce)
        setReportTimestamp(data.reportToken.timestamp)
        setReportExpires(data.reportToken.expires)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [id, project?.reportSecret])

  const reportUrl = useMemo(() => {
    if (!reportToken) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const base = `${origin}/p/${id}/report?token=${reportToken}&nonce=${reportNonce}&ts=${reportTimestamp}&exp=${reportExpires}`
    const extra: string[] = []
    if (urlTheme !== 'dark') extra.push(`theme=${urlTheme}`)
    if (urlLang !== 'auto') extra.push(`lang=${urlLang}`)
    return extra.length > 0 ? `${base}&${extra.join('&')}` : base
  }, [id, reportToken, reportNonce, reportTimestamp, reportExpires, urlTheme, urlLang])

  const handleGenerateSecret = async () => {
    setGeneratingSecret(true)
    try {
      const res = await fetch(`/api/projects/${id}/report-secret`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setReportSecret(data.secret)
        setReportToken(data.reportToken?.token ?? null)
        setReportNonce(data.reportToken?.nonce ?? null)
        setReportTimestamp(data.reportToken?.timestamp ?? 0)
        setReportExpires(data.reportToken?.expires ?? 0)
      }
    } catch { /* ignore */ }
    finally { setGeneratingSecret(false) }
  }

  const handleRevokeSecret = async () => {
    setGeneratingSecret(true)
    try {
      const res = await fetch(`/api/projects/${id}/report-secret`, { method: 'DELETE' })
      if (res.ok) {
        setReportSecret(null)
        setReportToken(null)
        setReportNonce(null)
        setReportTimestamp(0)
        setReportExpires(0)
      }
    } catch { /* ignore */ }
    finally { setGeneratingSecret(false) }
  }

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(reportUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  /** API 로 붙이는 쪽에서 쓰는 값들(접수 주소·프로젝트 ID·시크릿) 복사 */
  const copyField = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(key)
      setTimeout(() => setCopiedField(null), 2000)
    } catch { /* ignore */ }
  }

  // API 로 붙일 때 쓰는 접수 주소 — 토큰은 붙이지 않는다.
  // 토큰은 1회용이고 7일이면 만료돼 저장해 두면 못 쓴다. 부르는 쪽이 시크릿으로 매번 서명한다.
  const apiReportUrl = typeof window !== 'undefined' ? `${window.location.origin}/p/${id}/report` : ''

  const fetchGitMembers = useCallback(async () => {
    setGitMembersLoading(true)
    try {
      const res = await fetch(`/api/projects/${id}/members`)
      if (res.ok) {
        const data = await res.json()
        setGitMembers(data)
      }
    } catch { /* ignore */ }
    finally { setGitMembersLoading(false) }
  }, [id])

  useEffect(() => { fetchGitMembers() }, [fetchGitMembers])

  if (state.loading) {
    return <div className="h-full flex items-center justify-center text-ive-text-muted text-base">{tc('loading')}</div>
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-ive-text-muted mb-4">{tp('notFound')}</p>
          <Link href="/" className="text-ive-green text-base font-bold">
            <i className="fa-solid fa-arrow-left mr-1" />{tc('home')}
          </Link>
        </div>
      </div>
    )
  }

  const isOwner = !project.shareRole
  const canEdit = isOwner || project.shareRole === 'editor'

  async function handleDeleteProject() {
    await deleteProject(id)
    router.push('/')
  }

  async function handleLeaveShare() {
    await deleteProject(id)
    router.push('/')
  }

  return (
    <div className="h-full flex flex-col">
      <header className="shrink-0 z-40 w-full max-w-lg mx-auto bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center gap-3 px-3 py-3">
          <Link href="/" className="text-ive-green text-base font-bold p-1 hover:bg-ive-green/5 rounded">
            <i className="fa-solid fa-arrow-left mr-1" />{tc('back')}
          </Link>
          <h1 className="text-lg font-bold text-ive-green-pale flex-1 truncate">{project.name}</h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 w-full max-w-lg mx-auto flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto pl-3 pr-1">
      <main className="pt-4 pb-20">
        {/* 프로젝트 정보 헤더 */}
        <div
          className="bg-ive-bg-card rounded-lg p-5 border border-ive-border-subtle mb-6 relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
             <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-6xl`} />
          </div>

          <div className="flex items-center gap-3 mb-4 relative z-10">
            {project.avatarUrl ? (
              <img src={project.avatarUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-ive-border shrink-0" />
            ) : (
              <div
                className="w-12 h-12 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0"
              >
                <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-3xl text-ive-green`} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold truncate leading-tight">{project.name}</div>
              <a
                href={project.repoUrl.replace(/\.git$/, '')}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-ive-text-muted truncate mt-0.5 hover:text-ive-green transition-colors inline-flex items-center gap-1"
              >
                {project.repoUrl}
                <i className="fa-solid fa-arrow-up-right-from-square text-xs opacity-50 shrink-0" />
              </a>
            </div>
          </div>

          <div className="flex items-center justify-end mt-4 pt-4 border-t border-ive-border-dark relative z-10 gap-2">
            {canEdit ? (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowEditProject(true)}
                  className="text-base font-bold text-ive-text-muted border border-ive-border px-3 py-2 rounded-lg hover:border-ive-green/30 hover:text-ive-green transition-all bg-ive-bg/50"
                >
                  <i className="fa-solid fa-pen-to-square mr-1" />{tc('edit')}
                </button>
                {isOwner ? (
                  <button
                    onClick={() => setShowDeleteProject(true)}
                    className="text-base font-bold text-ive-red/60 border border-ive-red/20 px-3 py-2 rounded-lg hover:bg-ive-red/10 transition-all"
                  >
                    <i className="fa-solid fa-trash-can" />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowLeaveShare(true)}
                    title={tp('leaveShare')}
                    aria-label={tp('leaveShare')}
                    className="text-base font-bold text-ive-red/60 border border-ive-red/20 px-3 py-2 rounded-lg hover:bg-ive-red/10 transition-all"
                  >
                    <i className="fa-solid fa-right-from-bracket" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg leading-none bg-ive-cyan/15 text-ive-cyan border border-ive-cyan/30`}>
                  <i className="fa-solid fa-share-nodes mr-1" />
                  {tp('viewerPermission')}
                </span>
                <button
                  onClick={() => setShowLeaveShare(true)}
                  title={tp('leaveShare')}
                  aria-label={tp('leaveShare')}
                  className="text-base font-bold text-ive-red/60 border border-ive-red/20 px-3 py-2 rounded-lg hover:bg-ive-red/10 transition-all"
                >
                  <i className="fa-solid fa-right-from-bracket" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 작업 접수 페이지 섹션 */}
        {canEdit && (
          <div className="mb-6">
            <h2 className="text-base font-bold text-ive-text uppercase tracking-widest flex items-center gap-2 mb-3 px-1">
              <span className="w-1.5 h-1.5 rounded-full bg-ive-amber" />
              {tp('reportPage')}
            </h2>
            <div className="bg-ive-bg-card rounded-lg border border-ive-border-subtle p-4">
              {!reportSecret ? (
                <div className="py-2">
                  <p className="text-sm text-ive-text-muted mb-3">
                    {tp('reportPageDesc')}
                  </p>
                  {/* 사용 방법 가이드 */}
                  <div className="bg-ive-bg-deep/50 border border-ive-border-dark rounded-lg p-3 mb-4 text-left space-y-3">
                    <div className="text-xs font-bold text-ive-text-muted mb-2 uppercase tracking-wider">
                      <i className="fa-solid fa-circle-info mr-1" />{tp('reportPageHowTo')}
                    </div>
                    <ol className="text-xs text-ive-text-muted space-y-1.5">
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-bg-card border border-ive-border flex items-center justify-center text-ive-cyan font-bold">1</span>
                        <span>{tp('reportPageStep1')}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-bg-card border border-ive-border flex items-center justify-center text-ive-cyan font-bold">2</span>
                        <span>{tp('reportPageStep2')}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-bg-card border border-ive-border flex items-center justify-center text-ive-cyan font-bold">3</span>
                        <span>{tp('reportPageStep3')}</span>
                      </li>
                    </ol>
                  </div>
                  <details className="text-xs text-ive-text-muted">
                    <summary className="cursor-pointer font-bold text-ive-text hover:text-ive-green transition-colors">
                      <i className="fa-solid fa-code mr-1" />{tp('reportPageAdvanced')}
                    </summary>
                    <div className="mt-3 space-y-3">
                      {/* 테마 변경 */}
                      <div>
                        <div className="text-ive-text font-bold mb-1">
                          <i className="fa-solid fa-palette mr-1 text-ive-amber" />{tp('reportPageTheme')}
                        </div>
                        <pre className="bg-ive-bg-input border border-ive-border rounded-lg p-2 text-ive-text-muted overflow-x-auto font-mono text-xs">
                          {`?theme=light&lang=en`}
                        </pre>
                        <p className="mt-1 text-ive-text-dim">{tp('reportPageThemeHint')}</p>
                      </div>
                      {/* API 직접 호출 */}
                      <div>
                        <div className="text-ive-text font-bold mb-1">
                          <i className="fa-solid fa-terminal mr-1 text-ive-amber" />{tp('reportPageApi')}
                        </div>
                        <pre className="bg-ive-bg-input border border-ive-border rounded-lg p-2 text-ive-text-muted overflow-x-auto font-mono text-xs">
{`POST /api/report
{
  "projectId": "프로젝트 ID",
  "token": "HMAC 토큰",
  "nonce": "nonce",
  "timestamp": 1234567890,
  "expires": 1234567890,
  "content": "첫 줄: 제목\\n\\n본문 내용...",
  "dueDate": "2026-05-31",
  "browserInfo": { "referrer": "..." }
}`}
                        </pre>
                        <p className="mt-1 text-ive-text-dim">{tp('reportPageApiHint')}</p>
                      </div>
                      {/* 보안 */}
                      <div>
                        <div className="text-ive-text font-bold mb-1">
                          <i className="fa-solid fa-shield-halved mr-1 text-ive-amber" />{tp('reportPageSecurity')}
                        </div>
                        <p className="text-ive-text-dim">{tp('reportPageSecurityHint')}</p>
                      </div>
                    </div>
                  </details>
                  <div className="flex justify-end">
                    <button
                      onClick={handleGenerateSecret}
                      disabled={generatingSecret}
                      className="bg-ive-green-dark text-white font-bold text-sm px-4 py-3 rounded-lg disabled:opacity-40 hover:opacity-80"
                    >
                      {generatingSecret ? (
                        <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tc('loading')}</>
                      ) : (
                        <><i className="fa-solid fa-link mr-1" />{tp('reportPageEnable')}</>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* ① 화면 붙이기 — 접수 페이지를 그대로 열어 쓰는 방식 */}
                  <div>
                    <div className="text-xs font-bold text-ive-text uppercase tracking-wider">
                      <i className="fa-solid fa-window-maximize mr-1 text-ive-cyan" />{tp('reportPageEmbedTitle')}
                    </div>
                    <p className="mt-1 text-xs text-ive-text-dim">{tp('reportPageEmbedDesc')}</p>
                  </div>

                  {/* URL */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={reportUrl}
                      className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-sm text-ive-text font-bold focus:outline-none"
                    />
                  </div>

                  {/* 안내: 복사 전 테마/언어 선택 */}
                  <p className="text-xs text-ive-text-dim flex items-start gap-1.5">
                    <i className="fa-solid fa-circle-info mt-0.5 text-ive-cyan" />
                    <span>{tp('reportPageCopyHint')}</span>
                  </p>

                  {/* 테마/언어 선택 + 복사 */}
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-ive-text-dim font-bold shrink-0">
                        <i className="fa-solid fa-palette mr-1 text-ive-amber" />{tp('reportPageThemeLabel')}
                      </span>
                      <CustomSelect
                        size="sm"
                        value={urlTheme}
                        onChange={(v) => setUrlTheme(v as 'dark' | 'light' | 'auto')}
                        options={[
                          { value: 'auto', label: tp('reportPageThemeAuto') },
                          { value: 'dark', label: tp('reportPageThemeDark') },
                          { value: 'light', label: tp('reportPageThemeLight') },
                        ]}
                        className="w-[88px]"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-ive-text-dim font-bold shrink-0">
                        <i className="fa-solid fa-language mr-1 text-ive-amber" />{tp('reportPageLanguage')}
                      </span>
                      <CustomSelect
                        size="sm"
                        value={urlLang}
                        onChange={(v) => setUrlLang(v as 'auto' | 'ko' | 'en')}
                        options={[
                          { value: 'auto', label: tp('reportPageLangAuto') },
                          { value: 'ko', label: tp('reportPageLangKo') },
                          { value: 'en', label: tp('reportPageLangEn') },
                        ]}
                        className="w-[100px]"
                      />
                    </div>
                    <button
                      onClick={handleCopyUrl}
                      className={`ml-auto shrink-0 font-bold text-xs px-3 py-1.5 rounded-lg border transition-all ${copied ? 'bg-ive-green/20 text-ive-green border-ive-green/30' : 'bg-ive-bg-deep text-ive-text-muted border-ive-border-subtle hover:text-ive-green hover:border-ive-green/30'}`}
                    >
                      {copied ? <i className="fa-solid fa-check" /> : <><i className="fa-regular fa-copy mr-1" />{tp('reportPageCopyUrl')}</>}
                    </button>
                  </div>

                  {/* 사용 방법 요약 */}
                  <div className="bg-ive-bg-deep/50 border border-ive-border-dark rounded-lg p-3 text-left">
                    <ol className="text-xs text-ive-text-muted space-y-1.5">
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-bg-card border border-ive-border flex items-center justify-center text-ive-cyan font-bold">1</span>
                        <span>{tp('reportPageStep1')}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-bg-card border border-ive-border flex items-center justify-center text-ive-cyan font-bold">2</span>
                        <span>{tp('reportPageStep2')}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-bg-card border border-ive-border flex items-center justify-center text-ive-cyan font-bold">3</span>
                        <span>{tp('reportPageStep3')}</span>
                      </li>
                    </ol>
                  </div>

                  {/* ② API 연동 — 남의 화면에서 만든 내용을 API 로 보내는 방식.
                       여기 값 세 개(주소·프로젝트 ID·시크릿)를 그쪽 설정에 복사해 넣는다.
                       URL 에 붙는 토큰은 주지 않는다 — 1회용이라 저장해 두면 두 번째부터 실패한다. */}
                  <div className="border-t border-ive-border-dark pt-3">
                    <div className="text-xs font-bold text-ive-text uppercase tracking-wider">
                      <i className="fa-solid fa-plug mr-1 text-ive-amber" />{tp('reportPageApiTitle')}
                    </div>
                    <p className="mt-1 mb-2 text-xs text-ive-text-dim">{tp('reportPageApiDesc')}</p>
                    <div className="space-y-1.5">
                      {[
                        { key: 'url', label: tp('reportPageApiUrl'), value: apiReportUrl, secret: false },
                        { key: 'pid', label: tp('reportPageApiProjectId'), value: id, secret: false },
                        { key: 'secret', label: tp('reportPageApiSecret'), value: reportSecret ?? '', secret: true },
                      ].map(row => (
                        <div key={row.key} className="flex items-center gap-2">
                          <span className="shrink-0 w-24 text-xs font-bold text-ive-text-muted">{row.label}</span>
                          <input
                            type={row.secret && !secretVisible ? 'password' : 'text'}
                            readOnly
                            value={row.value}
                            className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-xs text-ive-text font-mono focus:outline-none"
                          />
                          {row.secret && (
                            <button
                              onClick={() => setSecretVisible(v => !v)}
                              className="shrink-0 text-xs font-bold text-ive-text-muted hover:text-ive-green px-2 py-2 rounded-lg hover:bg-white/5"
                              title={tp(secretVisible ? 'reportPageApiSecretHide' : 'reportPageApiSecretShow')}
                            >
                              <i className={secretVisible ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} />
                            </button>
                          )}
                          <button
                            onClick={() => copyField(row.key, row.value)}
                            className={`shrink-0 font-bold text-xs px-3 py-2 rounded-lg border transition-all ${copiedField === row.key ? 'bg-ive-green/20 text-ive-green border-ive-green/30' : 'bg-ive-bg-deep text-ive-text-muted border-ive-border-subtle hover:text-ive-green hover:border-ive-green/30'}`}
                          >
                            {copiedField === row.key ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-ive-text-dim">
                      <i className="fa-solid fa-triangle-exclamation mr-1 text-ive-amber" />{tp('reportPageApiSecretHint')}
                    </p>
                  </div>

                  {/* 고급 옵션 */}
                  <details className="text-xs text-ive-text-muted">
                    <summary className="cursor-pointer font-bold text-ive-text hover:text-ive-green transition-colors">
                      <i className="fa-solid fa-code mr-1" />{tp('reportPageAdvanced')}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="text-ive-text font-bold mb-1">
                          <i className="fa-solid fa-palette mr-1 text-ive-amber" />{tp('reportPageTheme')}
                        </div>
                        <pre className="bg-ive-bg-input border border-ive-border rounded-lg p-2 text-ive-text-muted overflow-x-auto font-mono text-xs">
                          {`?theme=light`}
                        </pre>
                        <p className="mt-1 text-ive-text-dim">{tp('reportPageThemeHint')}</p>
                      </div>
                      <div>
                        <div className="text-ive-text font-bold mb-1">
                          <i className="fa-solid fa-terminal mr-1 text-ive-amber" />{tp('reportPageApi')}
                        </div>
                        <pre className="bg-ive-bg-input border border-ive-border rounded-lg p-2 text-ive-text-muted overflow-x-auto font-mono text-xs">
{`POST /api/report
{
  "projectId": "프로젝트 ID",
  "token": "HMAC 토큰",
  "nonce": "nonce",
  "timestamp": 1234567890,
  "expires": 1234567890,
  "content": "첫 줄: 제목\\n\\n본문 내용...",
  "dueDate": "2026-05-31",
  "browserInfo": { "referrer": "..." }
}`}
                        </pre>
                        <p className="mt-1 text-ive-text-dim">{tp('reportPageApiHint')}</p>
                      </div>
                      <div>
                        <div className="text-ive-text font-bold mb-1">
                          <i className="fa-solid fa-shield-halved mr-1 text-ive-amber" />{tp('reportPageSecurity')}
                        </div>
                        <p className="text-ive-text-dim">{tp('reportPageSecurityHint')}</p>
                      </div>
                    </div>
                  </details>

                  {/* 보안 상태 + 재생성 */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ive-text-dim">
                      <i className="fa-solid fa-shield-halved mr-1" />
                      {tp('reportPageActive')}
                    </span>
                    <button
                      onClick={handleRevokeSecret}
                      disabled={generatingSecret}
                      className="text-ive-red/60 font-bold hover:text-ive-red disabled:opacity-40"
                    >
                      <i className="fa-solid fa-rotate mr-1" />{tp('reportPageRegenerate')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Git 프로젝트 멤버 섹션 */}
        <div className="flex items-center justify-between mt-6 mb-3 px-1">
          <h2 className="text-base font-bold text-ive-text uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-ive-cyan" />
            {tp('gitMembers', { count: gitMembers.length })}
          </h2>
          <button
            onClick={fetchGitMembers}
            disabled={gitMembersLoading}
            className="text-xs font-bold text-ive-text-dim hover:text-ive-green px-2 py-1 rounded-lg hover:bg-white/5 transition-all disabled:opacity-40"
          >
            <i className={`fa-solid fa-arrows-rotate ${gitMembersLoading ? 'fa-spin' : ''}`} />
          </button>
        </div>
        {gitMembers.length === 0 ? (
          <div className="text-center py-8 bg-ive-bg-card rounded-lg border border-dashed border-ive-border-subtle">
            <i className="fa-solid fa-users text-2xl text-ive-text-dim mb-2 block" />
            <p className="text-sm text-ive-text-muted">{gitMembersLoading ? tc('loading') : tp('noGitMembers')}</p>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {gitMembers.map(m => (
              <div key={m.id} className="flex items-center gap-3 bg-ive-bg-card rounded-lg border border-ive-border-subtle px-3 py-2.5">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} className="w-8 h-8 rounded-lg object-cover bg-ive-bg-deep border border-ive-border shrink-0" alt="" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-user text-ive-text-dim" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-ive-text truncate">{m.name || m.username}</div>
                  {m.name && m.name !== m.username && (
                    <div className="text-xs text-ive-text-dim truncate">@{m.username}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      </div>
      </div>

      {/* 모달들 */}
      <Modal
        open={showEditProject}
        onClose={() => setShowEditProject(false)}
        title={tp('projectSettings')}
        closeOnBackdrop={false}
      >
        <ProjectForm
          existing={project}
          onSuccess={() => setShowEditProject(false)}
          onCancel={() => setShowEditProject(false)}
        />
      </Modal>

      <ConfirmModal
        open={showDeleteProject}
        onClose={() => setShowDeleteProject(false)}
        onConfirm={handleDeleteProject}
        title={tp('deleteProject')}
        message={tp('deleteProjectConfirm')}
        confirmLabel={tp('permanentDelete')}
        danger
      />

      <ConfirmModal
        open={showLeaveShare}
        onClose={() => setShowLeaveShare(false)}
        onConfirm={handleLeaveShare}
        title={tp('leaveShare')}
        message={tp('leaveShareConfirm')}
        confirmLabel={tp('leaveShareConfirmLabel')}
        danger
      />

      <MobileTabBar />
    </div>
  )
}
