'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import IntroSlides from '@/components/auth/IntroSlides'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'

type PublicOAuthProvider = {
  id: string
  type: 'github' | 'gitlab'
  name: string
  baseUrl: string
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshUser } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showIntro, setShowIntro] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [oauthProviders, setOauthProviders] = useState<PublicOAuthProvider[]>([])
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [oauthRedirecting, setOauthRedirecting] = useState<string | null>(null)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [isIos, setIsIos] = useState(false)
  const [isFirefox, setIsFirefox] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [isSafari, setIsSafari] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const tAuth = useTranslations('auth')

  useEffect(() => {
    // PWA 설치 프롬프트
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
    setIsStandalone(!!standalone)
    const ua = navigator.userAgent
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
    setIsIos(ios)
    setIsFirefox(/Firefox/i.test(ua))
    setIsMobile(/Android|iPhone|iPad|iPod|Mobile/i.test(ua))
    setIsSafari(/Safari/i.test(ua) && !/Chrome/i.test(ua))
    setIsAndroid(/Android/i.test(ua))
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    if (!localStorage.getItem('ive-intro-seen')) {
      setShowIntro(true)
    }
    // 세션 만료로 리다이렉트된 경우 메시지 표시
    if (typeof window !== 'undefined' && sessionStorage.getItem('ive-session-expired')) {
      setSessionExpired(true)
      sessionStorage.removeItem('ive-session-expired')
    }
    // OAuth 콜백 에러 표시
    const oauthErr = searchParams?.get('oauth_error')
    if (oauthErr) setOauthError(oauthErr)
    // 활성 OAuth provider 조회
    fetch('/api/auth/oauth/providers')
      .then(r => r.ok ? r.json() : [])
      .then((data: PublicOAuthProvider[]) => setOauthProviders(Array.isArray(data) ? data : []))
      .catch(() => setOauthProviders([]))
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error)
      return
    }

    // 이전 세션 캐시 제거
    sessionStorage.removeItem('issues-cache')
    sessionStorage.removeItem('issues-scroll')
    const user = await refreshUser()
    if (user) router.push('/')
  }

  return (
    <div className="h-full flex justify-center overflow-hidden">
      <div className="w-full max-w-lg overflow-y-auto px-4">
        <div className="min-h-full flex items-center justify-center py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-1"><span className="text-[#22c55e]">Spring</span><span className="text-ive-amber">ware</span> <span className="text-ive-cyan">IVE</span></h1>
          <p className="text-base text-ive-text-muted">Integrated Value Environment</p>
        </div>

        {sessionExpired && (
          <div className="mb-4 text-base text-ive-amber bg-ive-amber/10 border border-ive-amber/20 rounded-lg px-3 py-2">
            <i className="fa-solid fa-clock mr-1.5" />{tAuth('sessionExpired')}
          </div>
        )}

        {oauthError && (
          <div className="mb-4 text-base text-ive-red bg-ive-red/10 border border-ive-red/20 rounded-lg px-3 py-2">
            <i className="fa-solid fa-circle-exclamation mr-1.5" />{oauthError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••"
              required
              autoComplete="current-password"
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
            />
          </div>

          {error && (
            <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">
              <i className="fa-solid fa-circle-exclamation mr-1" />{error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-base active:bg-ive-green/80 transition-colors disabled:opacity-50"
          >
            {loading ? (<><i className="fa-solid fa-spinner fa-spin mr-1.5" />{tAuth('loggingIn')}</>) : (<><i className="fa-solid fa-right-to-bracket mr-1.5" />{tAuth('login')}</>)}
          </button>
        </form>

        {oauthProviders.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-ive-border" />
              <span className="text-sm text-ive-text-dim">OR</span>
              <div className="flex-1 h-px bg-ive-border" />
            </div>
            {oauthProviders.map(p => {
              const redirecting = oauthRedirecting === p.id
              const anyRedirecting = !!oauthRedirecting
              return (
                <a
                  key={p.id}
                  href={`/api/auth/oauth/${p.id}/start`}
                  onClick={() => setOauthRedirecting(p.id)}
                  aria-disabled={anyRedirecting}
                  className={`w-full flex items-center justify-center gap-2 bg-ive-bg-input border border-ive-border hover:border-ive-green text-ive-text font-bold py-3 rounded-lg text-base transition-colors ${anyRedirecting && !redirecting ? 'opacity-40 pointer-events-none' : ''}`}
                >
                  {redirecting ? (
                    <><i className="fa-solid fa-spinner fa-spin" /><span>이동 중...</span></>
                  ) : (
                    <><i className={`fa-brands ${p.type === 'github' ? 'fa-github' : 'fa-gitlab'}`} /><span>{p.name}</span></>
                  )}
                </a>
              )
            })}
          </div>
        )}

        <div className="flex justify-center gap-4 mt-6 text-base text-ive-text-muted">
          <Link href="/register" className="text-ive-green font-bold">{tAuth('register')}</Link>
          <Link href="/change-password" className="text-ive-cyan font-bold">{tAuth('changePassword')}</Link>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => setShowIntro(true)}
            className="text-sm text-ive-text-muted hover:text-ive-green transition-colors"
          >
            <i className="fa-solid fa-circle-info mr-1" />{tAuth('introPrompt')}
          </button>
          <LanguageSwitcher />
        </div>

        {!isStandalone && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              onClick={async () => {
                if (installPrompt) {
                  installPrompt.prompt()
                  const { outcome } = await installPrompt.userChoice
                  if (outcome === 'accepted') setInstallPrompt(null)
                } else {
                  setShowGuide(v => !v)
                }
              }}
              className="flex items-center gap-2 bg-ive-cyan/10 border border-ive-cyan/30 text-ive-cyan font-bold py-2.5 px-5 rounded-lg text-sm hover:bg-ive-cyan/20 active:scale-95 transition-all"
            >
              <i className="fa-solid fa-download" />{tAuth('installApp')}
            </button>
            {showGuide && !installPrompt && (
              <p className="text-xs text-ive-text-muted text-center">
                {isIos
                  ? isSafari
                    ? <>{tAuth('installSafariIosGuide', { icon: '' })}<i className="fa-solid fa-share-nodes mx-1 text-ive-cyan" /></>
                    : <>{tAuth('installIosGuide', { icon: '' })}<i className="fa-solid fa-arrow-up-from-bracket mx-1 text-ive-cyan" /></>
                  : isFirefox && !isMobile
                  ? tAuth('installFirefoxGuide')
                  : isFirefox && isMobile
                  ? <>{tAuth('installFirefoxMobileGuide', { icon: '' })}<i className="fa-solid fa-ellipsis-vertical mx-1 text-ive-cyan" /></>
                  : isAndroid
                  ? <>{tAuth('installAndroidGuide', { icon: '' })}<i className="fa-solid fa-ellipsis-vertical mx-1 text-ive-cyan" /></>
                  : <>{tAuth('installChromeGuide', { icon: '' })}<i className="fa-solid fa-ellipsis-vertical mx-1 text-ive-cyan" /></>
                }
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-center">
          <a href="https://www.producthunt.com/products/spring-ive?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-spring-ive" target="_blank" rel="noopener noreferrer">
            <img alt="Springware IVE on Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1107541&theme=dark&t=1774503857741" />
          </a>
        </div>
      </div>

      {showIntro && <IntroSlides onComplete={() => { setShowIntro(false); localStorage.setItem('ive-intro-seen', '1') }} />}
    </div>
    </div>
    </div>
  )
}
