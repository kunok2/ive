'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface ProfileEmailSectionProps {
  email: string
  expanded: boolean
  onToggle: () => void
  onEmailChanged?: () => void
  onSuccess?: () => void
}

export default function ProfileEmailSection({ email, expanded, onToggle, onEmailChanged, onSuccess }: ProfileEmailSectionProps) {
  const t = useTranslations('auth')

  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailSendingCode, setEmailSendingCode] = useState(false)
  const [emailPassword, setEmailPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState(false)

  async function handleEmailSendCode() {
    if (!newEmail) { setEmailError(t('newEmailRequired')); return }
    setEmailError('')
    setEmailSendingCode(true)
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, purpose: 'change-email' }),
      })
      const data = await res.json()
      if (!res.ok) { setEmailError(data.error); return }
      setEmailCodeSent(true)
    } finally {
      setEmailSendingCode(false)
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailError('')
    if (!emailCode.trim()) { setEmailError(t('verificationCodeRequired')); return }
    if (!emailPassword) { setEmailError(t('emailRequired')); return }
    setEmailLoading(true)
    try {
      const res = await fetch('/api/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail, currentPassword: emailPassword, code: emailCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setEmailError(data.error); return }
      setEmailSuccess(true)
      onEmailChanged?.()
      setTimeout(() => onSuccess?.(), 1500)
    } finally {
      setEmailLoading(false)
    }
  }

  if (emailSuccess) {
    return (
      <div className="text-center py-6">
        <i className="fa-solid fa-circle-check text-ive-green text-3xl mb-3" />
        <p className="text-sm text-ive-text font-bold">{t('emailChanged')}</p>
      </div>
    )
  }

  return (
    <div className="border border-ive-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-ive-bg-card hover:bg-ive-bg-input transition-colors"
      >
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-envelope text-sm text-ive-cyan" />
          <span className="text-sm font-bold text-ive-text">{t('changeEmail')}</span>
        </div>
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>
      {expanded && (
        <form onSubmit={handleEmailSubmit} className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-ive-border">
          <div>
            <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('newEmail')}</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="new@example.com"
                required
                className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
              />
              <button
                type="button"
                onClick={handleEmailSendCode}
                disabled={emailSendingCode || !newEmail}
                className={`w-20 shrink-0 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 ${
                  emailCodeSent ? 'bg-ive-green/15 text-ive-green' : 'bg-ive-cyan/15 text-ive-cyan'
                }`}
              >
                {emailSendingCode ? <i className="fa-solid fa-circle-notch fa-spin" /> : emailCodeSent ? t('resend') : t('verify')}
              </button>
            </div>
          </div>
          {emailCodeSent && (
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('verificationCode')}</label>
              <input
                type="text"
                value={emailCode}
                onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('sixDigits')}
                maxLength={6}
                required
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text font-mono tracking-widest text-center focus:outline-none focus:border-ive-green"
              />
              <p className="text-xs text-ive-text-dim mt-1">{t('newEmailCodeHint')}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('currentPassword')}</label>
            <input
              type="password"
              value={emailPassword}
              onChange={e => setEmailPassword(e.target.value)}
              required
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text focus:outline-none focus:border-ive-green"
            />
          </div>
          {emailError && <div className="text-sm text-ive-red bg-ive-red/10 rounded-lg px-3 py-2"><i className="fa-solid fa-circle-exclamation mr-1" />{emailError}</div>}
          <button type="submit" disabled={emailLoading || !emailCodeSent || emailCode.length < 6} className="w-full py-2.5 rounded-lg text-sm font-bold bg-ive-cyan/80 text-white disabled:opacity-50">
            {emailLoading ? t('changingPassword') : t('changeEmail')}
          </button>
        </form>
      )}
    </div>
  )
}
