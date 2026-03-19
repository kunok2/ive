'use client'

import { useState, useRef } from 'react'
import { DEFAULT_AVATARS } from '@/types'
import AvatarCropEditor from './AvatarCropEditor'

interface Props {
  userId: string
  email: string
  name: string
  avatar: string
  onSuccess?: () => void
  onCancel?: () => void
  onEmailChanged?: () => void
  onAvatarChanged?: () => void
}

type ActiveSection = 'none' | 'avatar' | 'email' | 'password'

export default function UserProfileForm({ userId, email, name, avatar, onSuccess, onCancel, onEmailChanged, onAvatarChanged }: Props) {
  const [activeSection, setActiveSection] = useState<ActiveSection>('none')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoTs, setPhotoTs] = useState(() => Date.now())
  const [cropFile, setCropFile] = useState<File | null>(null)

  // 이메일 변경
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailSendingCode, setEmailSendingCode] = useState(false)
  const [emailPassword, setEmailPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState(false)

  // 비밀번호 변경
  const [pwCode, setPwCode] = useState('')
  const [pwCodeSent, setPwCodeSent] = useState(false)
  const [pwSendingCode, setPwSendingCode] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwSuccess, setPwSuccess] = useState(false)

  // 크롭된 이미지 업로드
  async function uploadCroppedImage(blob: Blob) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', new File([blob], 'avatar.png', { type: 'image/png' }))
      const res = await fetch('/api/auth/avatar/upload', { method: 'POST', body: fd })
      if (res.ok) {
        setPhotoTs(Date.now())
        onAvatarChanged?.()
        setCropFile(null)
        setActiveSection('none')
      } else {
        const data = await res.json()
        alert(data.error || '업로드 실패')
      }
    } finally {
      setUploading(false)
    }
  }

  // 이메일 인증 코드 전송
  async function handleEmailSendCode() {
    if (!newEmail) { setEmailError('새 이메일을 입력해주세요.'); return }
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

  // 이메일 변경 제출
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailError('')
    if (!emailCode.trim()) { setEmailError('인증 코드를 입력해주세요.'); return }
    if (!emailPassword) { setEmailError('현재 비밀번호를 입력해주세요.'); return }
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

  // 비밀번호 인증 코드 전송
  async function handlePwSendCode() {
    setPwError('')
    setPwSendingCode(true)
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'change-password' }),
      })
      const data = await res.json()
      if (!res.ok) { setPwError(data.error); return }
      setPwCodeSent(true)
    } finally {
      setPwSendingCode(false)
    }
  }

  // 비밀번호 변경 제출
  async function handlePwSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    if (newPassword !== newPasswordConfirm) { setPwError('새 비밀번호가 일치하지 않습니다.'); return }
    if (!pwCode.trim()) { setPwError('인증 코드를 입력해주세요.'); return }
    setPwLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, currentPassword, newPassword, code: pwCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setPwError(data.error); return }
      setPwSuccess(true)
      setTimeout(() => onSuccess?.(), 1500)
    } finally {
      setPwLoading(false)
    }
  }

  // 성공 메시지
  if (emailSuccess) {
    return (
      <div className="text-center py-6">
        <i className="fa-solid fa-circle-check text-ive-green text-3xl mb-3" />
        <p className="text-sm text-ive-text font-bold">이메일이 변경되었습니다.</p>
      </div>
    )
  }
  if (pwSuccess) {
    return (
      <div className="text-center py-6">
        <i className="fa-solid fa-circle-check text-ive-green text-3xl mb-3" />
        <p className="text-sm text-ive-text font-bold">비밀번호가 변경되었습니다.</p>
      </div>
    )
  }

  // 크롭 편집기 모드
  if (cropFile) {
    return (
      <div className="flex flex-col gap-4">
        <AvatarCropEditor
          imageFile={cropFile}
          onConfirm={(blob) => uploadCroppedImage(blob)}
          onCancel={() => {
            setCropFile(null)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        {uploading && (
          <div className="text-center text-sm text-ive-text-muted">
            <i className="fa-solid fa-circle-notch fa-spin mr-1" />업로드 중...
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 사용자 정보 + 아바타 */}
      <div className="bg-ive-bg-input rounded-lg px-4 py-3 border border-ive-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveSection(activeSection === 'avatar' ? 'none' : 'avatar')}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all hover:scale-110 overflow-hidden"
            style={avatar !== 'photo' ? { backgroundColor: (() => { const av = DEFAULT_AVATARS.find(a => a.id === avatar); return av ? `${av.color}20` : undefined })() } : undefined}
            title="아바타 변경"
          >
            {avatar === 'photo' ? (
              <img src={`/api/auth/avatar/image?id=${userId}&t=${photoTs}`} alt="" className="w-full h-full object-cover" />
            ) : (() => {
              const av = DEFAULT_AVATARS.find(a => a.id === avatar)
              return av ? <i className={`${av.icon} text-lg`} style={{ color: av.color }} /> : <i className="fa-solid fa-user text-ive-green" />
            })()}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-ive-text truncate">{name}</p>
            <p className="text-xs text-ive-text-muted truncate">{email}</p>
          </div>
        </div>
        {activeSection === 'avatar' && (
          <div className="mt-3 pt-3 border-t border-ive-border">
            {/* 사진 업로드 */}
            <div className="mb-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 5 * 1024 * 1024) {
                    alert('파일 크기는 5MB 이하여야 합니다.')
                    return
                  }
                  setCropFile(file)
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 rounded-lg text-sm font-semibold bg-ive-bg-deep border border-ive-border-subtle text-ive-text hover:border-ive-green transition-colors flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-camera text-ive-green" />
                사진 업로드
              </button>
            </div>
            <p className="text-xs font-bold text-ive-text-muted mb-2">또는 아이콘 선택</p>
            <div className="grid grid-cols-5 gap-2">
              {DEFAULT_AVATARS.map(av => (
                <button
                  key={av.id}
                  type="button"
                  onClick={async () => {
                    const res = await fetch('/api/auth/avatar', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ avatar: av.id }),
                    })
                    if (res.ok) {
                      onAvatarChanged?.()
                      setActiveSection('none')
                    }
                  }}
                  className={`w-full aspect-square rounded-lg flex items-center justify-center transition-all ${
                    avatar === av.id ? 'ring-2 ring-ive-green scale-110' : 'hover:scale-105 bg-ive-bg-deep'
                  }`}
                  style={avatar === av.id ? { backgroundColor: `${av.color}20` } : undefined}
                >
                  <i className={`${av.icon} text-lg`} style={{ color: av.color }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 이메일 변경 섹션 */}
      <div className="border border-ive-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveSection(activeSection === 'email' ? 'none' : 'email')}
          className="w-full flex items-center justify-between px-4 py-3 bg-ive-bg-card hover:bg-ive-bg-input transition-colors"
        >
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-envelope text-sm text-ive-cyan" />
            <span className="text-sm font-semibold text-ive-text">이메일 변경</span>
          </div>
          <i className={`fa-solid fa-chevron-${activeSection === 'email' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>
        {activeSection === 'email' && (
          <form onSubmit={handleEmailSubmit} className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-ive-border">
            <div>
              <label className="block text-sm font-semibold text-ive-text-muted mb-1">새 이메일</label>
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
                  {emailSendingCode ? <i className="fa-solid fa-circle-notch fa-spin" /> : emailCodeSent ? '재전송' : '인증'}
                </button>
              </div>
            </div>
            {emailCodeSent && (
              <div>
                <label className="block text-sm font-semibold text-ive-text-muted mb-1">인증 코드</label>
                <input
                  type="text"
                  value={emailCode}
                  onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6자리 숫자"
                  maxLength={6}
                  required
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text font-mono tracking-widest text-center focus:outline-none focus:border-ive-green"
                />
                <p className="text-xs text-ive-text-dim mt-1">새 이메일로 전송된 6자리 코드를 입력하세요.</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-ive-text-muted mb-1">현재 비밀번호</label>
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
              {emailLoading ? '변경 중...' : '이메일 변경'}
            </button>
          </form>
        )}
      </div>

      {/* 비밀번호 변경 섹션 */}
      <div className="border border-ive-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveSection(activeSection === 'password' ? 'none' : 'password')}
          className="w-full flex items-center justify-between px-4 py-3 bg-ive-bg-card hover:bg-ive-bg-input transition-colors"
        >
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-key text-sm text-ive-amber" />
            <span className="text-sm font-semibold text-ive-text">비밀번호 변경</span>
          </div>
          <i className={`fa-solid fa-chevron-${activeSection === 'password' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>
        {activeSection === 'password' && (
          <form onSubmit={handlePwSubmit} className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-ive-border">
            <div>
              <label className="block text-sm font-semibold text-ive-text-muted mb-1">이메일 인증</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text opacity-60"
                />
                <button
                  type="button"
                  onClick={handlePwSendCode}
                  disabled={pwSendingCode}
                  className={`w-20 shrink-0 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 ${
                    pwCodeSent ? 'bg-ive-green/15 text-ive-green' : 'bg-ive-cyan/15 text-ive-cyan'
                  }`}
                >
                  {pwSendingCode ? <i className="fa-solid fa-circle-notch fa-spin" /> : pwCodeSent ? '재전송' : '인증'}
                </button>
              </div>
            </div>
            {pwCodeSent && (
              <div>
                <label className="block text-sm font-semibold text-ive-text-muted mb-1">인증 코드</label>
                <input
                  type="text"
                  value={pwCode}
                  onChange={e => setPwCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
            {pwError && <div className="text-sm text-ive-red bg-ive-red/10 rounded-lg px-3 py-2"><i className="fa-solid fa-circle-exclamation mr-1" />{pwError}</div>}
            <button type="submit" disabled={pwLoading || !pwCodeSent || pwCode.length < 6} className="w-full py-2.5 rounded-lg text-sm font-bold bg-ive-green-dark text-white disabled:opacity-50">
              {pwLoading ? '변경 중...' : '비밀번호 변경'}
            </button>
          </form>
        )}
      </div>

      {onCancel && (
        <button type="button" onClick={onCancel} className="w-full py-2.5 rounded-lg text-sm font-bold text-ive-text-dim bg-ive-bg-card border border-ive-border-subtle">
          닫기
        </button>
      )}
    </div>
  )
}
