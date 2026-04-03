'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import IntroSlides from '@/components/auth/IntroSlides'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'

export default function LoginPage() {
  const router = useRouter()
  const { refreshUser } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showIntro, setShowIntro] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const tAuth = useTranslations('auth')

  useEffect(() => {
    if (!localStorage.getItem('ive-intro-seen')) {
      setShowIntro(true)
    }
    // 세션 만료로 리다이렉트된 경우 메시지 표시
    if (typeof window !== 'undefined' && sessionStorage.getItem('ive-session-expired')) {
      setSessionExpired(true)
      sessionStorage.removeItem('ive-session-expired')
    }
  }, [])

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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-ive-green mb-1">Spring <span className="text-ive-amber">IVE</span></h1>
          <p className="text-base text-ive-text-muted">Integrated Value Environment</p>
        </div>

        {sessionExpired && (
          <div className="mb-4 text-base text-ive-amber bg-ive-amber/10 border border-ive-amber/20 rounded-lg px-3 py-2">
            <i className="fa-solid fa-clock mr-1.5" />{tAuth('sessionExpired')}
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

        <div className="flex justify-center gap-4 mt-6 text-base text-ive-text-muted">
          <Link href="/register" className="text-ive-green font-bold">{tAuth('register')}</Link>
          <button onClick={() => setShowChangePassword(true)} className="text-ive-cyan font-bold">{tAuth('changePassword')}</button>
        </div>

        {showChangePassword && (
          <div className="mt-6 bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4">
            <h3 className="text-sm font-bold text-ive-text mb-3">{tAuth('changePassword')}</h3>
            <ChangePasswordForm onSuccess={() => setShowChangePassword(false)} onCancel={() => setShowChangePassword(false)} />
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => setShowIntro(true)}
            className="text-sm text-ive-text-muted hover:text-ive-green transition-colors"
          >
            <i className="fa-solid fa-circle-info mr-1" />{tAuth('introPrompt')}
          </button>
          <LanguageSwitcher />
        </div>

        <div className="mt-6 flex justify-center">
          <a href="https://www.producthunt.com/products/spring-ive?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-spring-ive" target="_blank" rel="noopener noreferrer">
            <img alt="Spring IVE on Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1107541&theme=dark&t=1774503857741" />
          </a>
        </div>
      </div>

      {showIntro && <IntroSlides onComplete={() => { setShowIntro(false); localStorage.setItem('ive-intro-seen', '1') }} />}
    </div>
  )
}
