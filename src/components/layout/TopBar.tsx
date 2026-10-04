'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab, tabForPath } from '@/lib/tab-context'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useTranslations } from 'next-intl'
import { DEFAULT_AVATARS } from '@/types'
import { useMainTabs } from '@/components/layout/MobileTabBar'
import UserProfileForm from '@/components/auth/UserProfileForm'
import ProjectForm from '@/components/project/ProjectForm'
import AgentForm from '@/components/agent/AgentForm'
import Modal from '@/components/ui/Modal'
import VerifyQueueModal from '@/components/layout/VerifyQueueModal'
import HelpModal from '@/components/ui/HelpModal'
import TourOverlay, { tourSteps } from '@/components/ui/TourOverlay'
import IntroSlides from '@/components/auth/IntroSlides'
import { useAppVersionWatch } from '@/lib/use-app-version-watch'

export default function TopBar() {
  const router = useRouter()
  const pathname = usePathname()
  const { state, logout, refreshUser } = useStore()
  const { activeTab, setActiveTab, issuesProjectId } = useTab()
  // 메뉴 위치 「위」(기본) — PC 폭에서 상단바 가운데에 주 메뉴. 탭 목록·이동은 하단 탭·세로 메뉴와 같은 것
  const mainTabs = useMainTabs()
  const { alert: showAlert, confirm: showConfirm } = useDialog()
  const tn = useTranslations('nav')
  const tc = useTranslations('common')
  const td = useTranslations('dialog')
  const tAuth = useTranslations('auth')
  const ta = useTranslations('agent')
  const tp = useTranslations('project')
  const t = useTranslations('help')

  const tVerify = useTranslations('verifyQueue')
  // 배포로 새 판이 나오면 우측 툴바에 새로고침 — 웹앱을 껐다 켜지 않아도 되게
  const appVersion = useAppVersionWatch()
  const [myVerifyCount, setMyVerifyCount] = useState(0)
  const [showVerifyQueue, setShowVerifyQueue] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [avatarTs, setAvatarTs] = useState(() => Date.now())
  const [showNewProject, setShowNewProject] = useState(false)
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showIntro, setShowIntro] = useState(false)
  const [tourTab, setTourTab] = useState<string | null>(null)

  // 메인 페이지 확인 (/, /ko, /en 등)
  const isMainPage = pathname === '/' || /^\/(ko|en)($|\/)/.test(pathname)

  useEffect(() => {
    if (!state.user) return
    let cancelled = false
    const fetchCount = () => {
      fetch('/api/me/verifier/queue?counts=1')
        .then(r => r.ok ? r.json() : { total: 0 })
        .then(d => { if (!cancelled) setMyVerifyCount(Number(d.total || 0)) })
        .catch(() => { /* ignore */ })
    }
    fetchCount()

    const iv = setInterval(fetchCount, 30000)
    window.addEventListener('refresh-counts', fetchCount)

    return () => {
      cancelled = true
      clearInterval(iv)
      window.removeEventListener('refresh-counts', fetchCount)
    }
  }, [state.user])

  useEffect(() => {
    const handleProjectAdd = () => setShowNewProject(true)
    const handleAgentAdd = () => setShowNewAgent(true)
    window.addEventListener('project-add-trigger', handleProjectAdd)
    window.addEventListener('agent-add-trigger', handleAgentAdd)
    return () => {
      window.removeEventListener('project-add-trigger', handleProjectAdd)
      window.removeEventListener('agent-add-trigger', handleAgentAdd)
    }
  }, [])

  if (!state.authChecked || !state.user) {
    return null
  }

  return (
    <>
      <header className="shrink-0 z-40 w-full max-w-lg mx-auto bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark min-[512px]:rounded-b-2xl pad:max-w-none pad:rounded-none">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div className="text-left">
              <h1 className="text-xl font-bold leading-none">
                <span className="text-[#22c55e]">Spring</span><span className="text-ive-amber">ware</span>{' '}
                <span className="text-ive-cyan">IVE</span>
              </h1>
              <p className="text-xs text-ive-text-dim mt-0.5">{tn((isMainPage ? activeTab : (tabForPath(pathname) ?? activeTab)) as 'projects' | 'agents' | 'issues' | 'reports' | 'admin')}</p>
            </div>
          </button>
          {/* 메뉴 위치 「위」(기본) — 패드·PC 폭에서 로고와 오른쪽 버튼 사이 남은 자리 가운데 */}
          {(state.user.navPosition ?? 'top') === 'top' && (
            <nav aria-label={mainTabs.navLabel} className="hidden pad:flex flex-1 min-w-0 justify-center items-center gap-1">
              {mainTabs.tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => mainTabs.go(tab.key)}
                  aria-current={mainTabs.activeTab === tab.key ? 'page' : undefined}
                  title={tab.label}
                  aria-label={tab.label}
                  className={`h-9 px-2.5 desk:px-3 rounded-lg flex items-center gap-1.5 text-sm font-bold whitespace-nowrap transition-colors ${
                    mainTabs.activeTab === tab.key ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim hover:text-ive-text-secondary hover:bg-white/[0.03]'
                  }`}
                >
                  <i className={`${tab.icon} text-base`} />
                  {/* 패드 세로(768~1023px)는 자리가 모자라(영어 5개 기준 9px 넘침) 아이콘만 — 이름은 title·로고 아래 현재 메뉴로 */}
                  <span className="hidden lg:inline">{tab.label}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-1.5">
            {/* 메인 페이지 탭별 추가 버튼 */}
            {isMainPage && activeTab === 'projects' && (
              <button
                data-tour={state.projects.length > 0 ? 'add-project' : undefined}
                onClick={() => setShowNewProject(true)}
                className="w-8 h-8 rounded-lg bg-ive-green flex items-center justify-center text-ive-bg-deep hover:brightness-110 active:scale-95 transition-all"
              >
                <i className="fa-solid fa-plus text-sm" />
              </button>
            )}

            {isMainPage && activeTab === 'agents' && (
              <button
                data-tour={state.agents.length > 0 ? 'add-agent' : undefined}
                onClick={async () => {
                  const maxAgents = state.user?.maxAgents || 0
                  if (maxAgents > 0 && state.agents.length >= maxAgents) {
                    await showAlert({ title: td('limitExceededTitle'), message: '', variant: 'error' })
                    return
                  }
                  setShowNewAgent(true)
                }}
                className="w-8 h-8 rounded-lg bg-ive-green flex items-center justify-center text-ive-bg-deep hover:brightness-110 active:scale-95 transition-all"
              >
                <i className="fa-solid fa-plus text-sm" />
              </button>
            )}

            {isMainPage && activeTab === 'issues' && issuesProjectId && (() => {
              const proj = state.projects.find(p => p.id === issuesProjectId)
              const canEdit = proj ? !proj.shareRole || proj.shareRole === 'editor' : false
              return canEdit ? (
                <button
                  data-tour="add-issue"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('issue-add-trigger'))
                  }}
                  className="w-8 h-8 rounded-lg bg-ive-green flex items-center justify-center text-ive-bg-deep hover:brightness-110 active:scale-95 transition-all"
                >
                  <i className="fa-solid fa-plus text-sm" />
                </button>
              ) : null
            })()}

            {/* 새 판 알림 — 이 탭이 옛 번들을 돌고 있으면. 누르면 페이지를 다시 연다 */}
            {appVersion.stale && (
              <button
                onClick={appVersion.reload}
                className="relative w-8 h-8 rounded-lg bg-ive-green/20 border border-ive-green/40 flex items-center justify-center text-ive-green hover:bg-ive-green/30 active:scale-95 transition-all"
                title={`${tc('appUpdate.title')}${appVersion.latestVersion ? ` (v${appVersion.latestVersion})` : ''}`}
                aria-label={tc('appUpdate.title')}
              >
                <i className="fa-solid fa-arrows-rotate text-sm" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-ive-red" />
              </button>
            )}

            {/* 내 검증 대기 뱃지 */}
            {myVerifyCount > 0 && (
              <button
                onClick={() => setShowVerifyQueue(true)}
                className="relative w-8 h-8 rounded-lg bg-ive-amber/20 border border-ive-amber/40 flex items-center justify-center text-ive-amber hover:bg-ive-amber/30 active:scale-95 transition-all"
                title={tVerify('badgeTitle', { count: myVerifyCount })}
                aria-label={tVerify('badgeTitle', { count: myVerifyCount })}
              >
                <i className="fa-solid fa-user-check text-sm" />
                <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-ive-red text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {myVerifyCount > 99 ? '99+' : myVerifyCount}
                </span>
              </button>
            )}

            {/* 도움말 */}
            <button
              onClick={() => setShowHelp(true)}
              className="w-8 h-8 rounded-lg bg-ive-cyan/20 border border-ive-cyan/40 flex items-center justify-center text-ive-cyan hover:bg-ive-cyan/30 active:scale-95 transition-all"
              aria-label={t('title')}
            >
              <i className="fa-solid fa-circle-question text-sm" />
            </button>

            {/* 아바타 + 로그아웃 */}
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden transition-all hover:scale-110 active:scale-95"
              style={state.user!.avatar !== 'photo' ? { backgroundColor: (() => { const av = DEFAULT_AVATARS.find(a => a.id === state.user!.avatar); return av ? `${av.color}20` : '#4ade8020' })() } : undefined}
              title={state.user!.name}
            >
              {state.user!.avatar === 'photo' ? (
                <img src={`/api/auth/avatar/image?id=${state.user!.id}&t=${avatarTs}`} alt="" className="w-full h-full object-cover" />
              ) : (() => {
                const av = DEFAULT_AVATARS.find(a => a.id === state.user!.avatar)
                return av ? <i className={`${av.icon} text-sm`} style={{ color: av.color }} /> : <i className="fa-solid fa-user text-sm text-ive-green" />
              })()}
            </button>
            <button
              onClick={async () => {
                const ok = await showConfirm({ title: td('logoutTitle'), message: td('logoutMessage'), confirmText: tAuth('logout'), cancelText: tc('cancel'), variant: 'info' })
                if (ok) { await logout(); router.push('/login') }
              }}
              className="w-8 h-8 rounded-lg bg-ive-bg-card border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text active:scale-95 transition-all"
              aria-label={tAuth('logout')}
            >
              <i className="fa-solid fa-right-from-bracket text-sm" />
            </button>
          </div>
        </div>
      </header>

      <Modal open={showChangePassword} onClose={() => setShowChangePassword(false)} title={tAuth('myInfo')}>
        <UserProfileForm
          userId={state.user.id}
          email={state.user.email}
          name={state.user.name}
          avatar={state.user.avatar}
          locale={state.user.locale}
          timezone={state.user.timezone}
          navPosition={state.user.navPosition}
          currency={state.user.currency}
          currencyRate={state.user.currencyRate}
          slackUserId={state.user.slackUserId}
          slackNotify={state.user.slackNotify}
          gitlabUsername={state.user.gitlabUsername}
          githubUsername={state.user.githubUsername}
          mailUnsubscribed={state.user.mailUnsubscribed}
          reportMailUnsubscribed={state.user.reportMailUnsubscribed}
          onSuccess={() => setShowChangePassword(false)}
          onCancel={() => setShowChangePassword(false)}
          onEmailChanged={() => refreshUser()}
          onAvatarChanged={() => { setAvatarTs(Date.now()); refreshUser() }}
          onSettingsChanged={() => refreshUser()}
        />
      </Modal>

      <Modal
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
        title={tp('newProject')}
        closeOnBackdrop={false}
      >
        <ProjectForm
          onSuccess={() => setShowNewProject(false)}
          onCancel={() => setShowNewProject(false)}
        />
      </Modal>

      <Modal
        open={showNewAgent}
        onClose={() => setShowNewAgent(false)}
        title={ta('addDeveloper')}
        closeOnBackdrop={false}
      >
        <AgentForm
          onSuccess={() => {
            setShowNewAgent(false)
            setActiveTab('agents')
            if (!isMainPage) router.push('/')
          }}
          onCancel={() => setShowNewAgent(false)}
        />
      </Modal>

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        onShowIntro={() => setShowIntro(true)}
        onStartTour={(tabKey) => {
          setShowHelp(false)
          setActiveTab(tabKey as any)
          if (!isMainPage) router.push('/')
          setTimeout(() => setTourTab(tabKey), 300)
        }}
      />

      {tourTab && tourSteps[tourTab] && (
        <TourOverlay
          steps={tourSteps[tourTab]}
          onClose={() => setTourTab(null)}
        />
      )}

      {showIntro && (
        <IntroSlides onComplete={() => setShowIntro(false)} />
      )}

      <VerifyQueueModal open={showVerifyQueue} onClose={() => setShowVerifyQueue(false)} />
    </>
  )
}
