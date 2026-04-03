'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useStore } from '@/lib/store'
import { useTranslations } from 'next-intl'

export default function RegisterPage() {
  const router = useRouter()
  const { refreshUser } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const tAuth = useTranslations('auth')
  const tc = useTranslations('common')

  // 재발송 쿨다운 타이머
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleSendCode() {
    if (!email) { setError(tAuth('emailRequired')); return }
    setError('')
    setSendingCode(true)
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setCodeSent(true)
      setCooldown(60)
    } catch {
      setError(tAuth('verificationEmailFailed'))
    } finally {
      setSendingCode(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!codeSent || !code) {
      setError(tAuth('completeEmailVerification'))
      return
    }
    if (password !== passwordConfirm) {
      setError(tAuth('passwordMismatch'))
      return
    }
    setLoading(true)

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password, code }),
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
          <h1 className="text-3xl font-bold text-ive-green mb-1">Spring <span className="text-ive-amber">IVE</span></h1>
          <p className="text-base text-ive-text-muted">{tAuth('createAccount')}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
          <div>
            <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('name')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={tAuth('namePlaceholder')}
              required
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('email')}</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (codeSent) setCodeSent(false) }}
                placeholder="you@example.com"
                required
                autoComplete="new-email"
                disabled={codeSent && cooldown > 0}
                className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendingCode || cooldown > 0 || !email}
                className="shrink-0 w-20 py-3 rounded-lg text-sm font-bold bg-ive-green-dark text-white active:bg-ive-green/80 transition-colors disabled:opacity-40 text-center"
              >
                {sendingCode ? tAuth('sendingCode') : cooldown > 0 ? `${cooldown}s` : codeSent ? tAuth('resend') : tAuth('verify')}
              </button>
            </div>
          </div>

          {codeSent && (
            <div>
              <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('verificationCode')}</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={tAuth('sixDigits')}
                required
                maxLength={6}
                inputMode="numeric"
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green tracking-[0.3em] text-center font-mono"
              />
              <p className="text-xs text-ive-text-dim mt-1">{tAuth('emailCodeHint')} ({tAuth('codeValidityHint')})</p>
            </div>
          )}

          <div>
            <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={tAuth('minSixChars')}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-ive-text-muted mb-1.5">{tAuth('passwordConfirm')}</label>
            <input
              type="password"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder={tAuth('reenterPassword')}
              required
              minLength={6}
              autoComplete="new-password"
              className={`w-full bg-ive-bg-input border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none ${
                passwordConfirm && password !== passwordConfirm
                  ? 'border-ive-red focus:border-ive-red'
                  : 'border-ive-border focus:border-ive-green'
              }`}
            />
            {passwordConfirm && password !== passwordConfirm && (
              <p className="text-xs text-ive-red mt-1">{tAuth('passwordMismatch')}</p>
            )}
          </div>

          {error && (
            <div className="text-base text-ive-red bg-ive-red/10 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !codeSent || !code}
            className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-base active:bg-ive-green/80 transition-colors disabled:opacity-50"
          >
            {loading ? tc('creating') : tAuth('register')}
          </button>
        </form>

        <p className="text-center text-base text-ive-text-muted mt-6">
          {tAuth('alreadyHaveAccount')}{' '}
          <Link href="/login" className="text-ive-green font-bold">{tAuth('login')}</Link>
        </p>
      </div>
    </div>
  )
}
