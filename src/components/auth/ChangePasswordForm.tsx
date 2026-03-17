'use client'

import { useState } from 'react'

interface Props {
  email?: string  // 로그인 상태에서는 email prop 전달
  onSuccess?: () => void
  onCancel?: () => void
}

export default function ChangePasswordForm({ email, onSuccess, onCancel }: Props) {
  const [inputEmail, setInputEmail] = useState(email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const targetEmail = email || inputEmail

  async function handleSendCode() {
    if (!targetEmail) { setError('이메일을 입력해주세요.'); return }
    setError('')
    setSendingCode(true)
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, purpose: 'change-password' }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setCodeSent(true)
    } finally {
      setSendingCode(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== newPasswordConfirm) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }
    if (!code.trim()) {
      setError('인증 코드를 입력해주세요.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, currentPassword, newPassword, code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSuccess(true)
      setTimeout(() => onSuccess?.(), 1500)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="text-center py-6">
        <i className="fa-solid fa-circle-check text-ive-green text-3xl mb-3" />
        <p className="text-sm text-ive-text font-bold">비밀번호가 변경되었습니다.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* 이메일 + 인증 버튼 */}
      <div>
        <label className="block text-sm font-semibold text-ive-text-muted mb-1">이메일</label>
        <div className="flex gap-2">
          <input
            type="email"
            value={targetEmail}
            onChange={e => !email && setInputEmail(e.target.value)}
            readOnly={!!email}
            required
            className={`flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text focus:outline-none focus:border-ive-green ${email ? 'opacity-60' : ''}`}
          />
          <button
            type="button"
            onClick={handleSendCode}
            disabled={sendingCode || !targetEmail}
            className={`w-20 shrink-0 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 ${
              codeSent ? 'bg-ive-green/15 text-ive-green' : 'bg-ive-cyan/15 text-ive-cyan'
            }`}
          >
            {sendingCode ? <i className="fa-solid fa-circle-notch fa-spin" /> : codeSent ? '재전송' : '인증'}
          </button>
        </div>
      </div>

      {/* 인증 코드 입력 */}
      {codeSent && (
        <div>
          <label className="block text-sm font-semibold text-ive-text-muted mb-1">인증 코드</label>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6자리 숫자"
            maxLength={6}
            required
            className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text font-mono tracking-widest text-center focus:outline-none focus:border-ive-green"
          />
          <p className="text-xs text-ive-text-dim mt-1">이메일로 전송된 6자리 코드를 입력하세요.</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-ive-text-muted mb-1">현재 비밀번호</label>
        <input
          type="password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          required
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text focus:outline-none focus:border-ive-green"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-ive-text-muted mb-1">새 비밀번호</label>
        <input
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          required
          minLength={6}
          placeholder="6자 이상"
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-ive-text-muted mb-1">새 비밀번호 확인</label>
        <input
          type="password"
          value={newPasswordConfirm}
          onChange={e => setNewPasswordConfirm(e.target.value)}
          required
          minLength={6}
          className={`w-full bg-ive-bg-input border rounded-lg px-3 py-2.5 text-sm text-ive-text focus:outline-none ${
            newPasswordConfirm && newPassword !== newPasswordConfirm ? 'border-ive-red' : 'border-ive-border focus:border-ive-green'
          }`}
        />
        {newPasswordConfirm && newPassword !== newPasswordConfirm && (
          <p className="text-xs text-ive-red mt-1">비밀번호가 일치하지 않습니다.</p>
        )}
      </div>
      {error && <div className="text-sm text-ive-red bg-ive-red/10 rounded-lg px-3 py-2"><i className="fa-solid fa-circle-exclamation mr-1" />{error}</div>}
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-lg text-sm font-bold text-ive-text-dim bg-ive-bg-card border border-ive-border-subtle">
            취소
          </button>
        )}
        <button type="submit" disabled={loading || !codeSent || code.length < 6} className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-ive-green-dark text-white disabled:opacity-50">
          {loading ? '변경 중...' : '비밀번호 변경'}
        </button>
      </div>
    </form>
  )
}
