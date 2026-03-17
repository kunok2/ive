'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useStore } from '@/lib/store'

export default function RegisterPage() {
  const router = useRouter()
  const { refreshUser } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    setLoading(true)

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password }),
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
          <p className="text-base text-ive-text-muted">새 계정 만들기</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-base font-semibold text-ive-text-muted mb-1.5">이름</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동"
              required
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
            />
          </div>

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
              placeholder="6자 이상"
              required
              minLength={6}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
            />
          </div>

          <div>
            <label className="block text-base font-semibold text-ive-text-muted mb-1.5">비밀번호 확인</label>
            <input
              type="password"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호 재입력"
              required
              minLength={6}
              className={`w-full bg-ive-bg-input border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none ${
                passwordConfirm && password !== passwordConfirm
                  ? 'border-ive-red focus:border-ive-red'
                  : 'border-ive-border focus:border-ive-green'
              }`}
            />
            {passwordConfirm && password !== passwordConfirm && (
              <p className="text-xs text-ive-red mt-1">비밀번호가 일치하지 않습니다.</p>
            )}
          </div>

          {error && (
            <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-base active:bg-ive-green/80 transition-colors disabled:opacity-50"
          >
            {loading ? '생성 중...' : '회원가입'}
          </button>
        </form>

        <p className="text-center text-base text-ive-text-muted mt-6">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="text-ive-green font-semibold">로그인</Link>
        </p>
      </div>
    </div>
  )
}
