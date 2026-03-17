'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import IntroSlides from '@/components/auth/IntroSlides'
import { useStore } from '@/lib/store'

export default function LoginPage() {
  const router = useRouter()
  const { refreshUser } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showIntro, setShowIntro] = useState(true)

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

    await refreshUser()
    router.push('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-ive-green mb-1">Spring IVE</h1>
          <p className="text-base text-ive-text-muted">Integrated Value Environment</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-base font-semibold text-ive-text-muted mb-1.5">이메일</label>
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
            <label className="block text-base font-semibold text-ive-text-muted mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••"
              required
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
            {loading ? (<><i className="fa-solid fa-spinner fa-spin mr-1.5" />로그인 중...</>) : (<><i className="fa-solid fa-right-to-bracket mr-1.5" />로그인</>)}
          </button>
        </form>

        <div className="flex justify-center gap-4 mt-6 text-base text-ive-text-muted">
          <Link href="/register" className="text-ive-green font-semibold">회원가입</Link>
          <button onClick={() => setShowChangePassword(true)} className="text-ive-cyan font-semibold">비밀번호 변경</button>
        </div>

        {showChangePassword && (
          <div className="mt-6 bg-ive-bg-card border border-ive-border-subtle rounded-xl p-4">
            <h3 className="text-sm font-bold text-ive-text mb-3">비밀번호 변경</h3>
            <ChangePasswordForm onSuccess={() => setShowChangePassword(false)} onCancel={() => setShowChangePassword(false)} />
          </div>
        )}

        <div className="mt-4 text-center">
          <button
            onClick={() => setShowIntro(true)}
            className="text-sm text-ive-text-muted hover:text-ive-green transition-colors"
          >
            <i className="fa-solid fa-circle-info mr-1" />Spring IVE가 처음이신가요?
          </button>
        </div>
      </div>

      {showIntro && <IntroSlides onComplete={() => setShowIntro(false)} />}
    </div>
  )
}
