'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { DEFAULT_AVATARS } from '@/types'
import { locales, localeNames, Locale } from '@/i18n/config'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'
import AvatarCropEditor from './AvatarCropEditor'
import { useDialog } from '@/components/ui/ConfirmDialog'
import CustomSelect from '@/components/ui/CustomSelect'
import { DEFAULT_ADMIN_EMAIL } from '@/lib/constants'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Seoul', label: '🇰🇷 서울 (KST, UTC+9)' },
  { value: 'Asia/Tokyo', label: '🇯🇵 도쿄 (JST, UTC+9)' },
  { value: 'Asia/Shanghai', label: '🇨🇳 상하이 (CST, UTC+8)' },
  { value: 'Asia/Singapore', label: '🇸🇬 싱가포르 (SGT, UTC+8)' },
  { value: 'Asia/Kolkata', label: '🇮🇳 콜카타 (IST, UTC+5:30)' },
  { value: 'Asia/Dubai', label: '🇦🇪 두바이 (GST, UTC+4)' },
  { value: 'Europe/London', label: '🇬🇧 런던 (GMT/BST)' },
  { value: 'Europe/Paris', label: '🇫🇷 파리 (CET/CEST)' },
  { value: 'Europe/Berlin', label: '🇩🇪 베를린 (CET/CEST)' },
  { value: 'America/New_York', label: '🇺🇸 뉴욕 (EST/EDT)' },
  { value: 'America/Chicago', label: '🇺🇸 시카고 (CST/CDT)' },
  { value: 'America/Denver', label: '🇺🇸 덴버 (MST/MDT)' },
  { value: 'America/Los_Angeles', label: '🇺🇸 LA (PST/PDT)' },
  { value: 'Pacific/Auckland', label: '🇳🇿 오클랜드 (NZST, UTC+12)' },
  { value: 'Australia/Sydney', label: '🇦🇺 시드니 (AEST, UTC+10)' },
  { value: 'UTC', label: 'UTC (협정 세계시)' },
]

interface Props {
  userId: string
  email: string
  name: string
  avatar: string
  locale?: string
  timezone?: string
  currency?: string | null
  currencyRate?: number | null
  slackUserId?: string
  slackNotify?: boolean
  onSuccess?: () => void
  onCancel?: () => void
  onEmailChanged?: () => void
  onAvatarChanged?: () => void
  onSettingsChanged?: () => void
}

type ActiveSection = 'none' | 'avatar' | 'email' | 'password' | 'preferences' | 'slack'

type SlackWorkspaceRow = {
  id: string
  teamId: string
  name: string
  teamUrl: string
  enabled: boolean
}

export default function UserProfileForm({ userId, email, name, avatar, locale: userLocale, timezone: userTimezone, currency: userCurrency, currencyRate: userCurrencyRate, slackUserId: userSlackUserId, slackNotify: userSlackNotify, onSuccess, onCancel, onEmailChanged, onAvatarChanged, onSettingsChanged }: Props) {
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const currentLocale = useLocale()
  const router = useRouter()
  const { alert: dialogAlert, confirm: dialogConfirm } = useDialog()
  const popup = (message: string) => { void dialogAlert({ message }) }
  // 기본 사용자(admin@ive.local)는 메일 인증 없이 비밀번호 변경 가능
  const skipPwVerification = email === DEFAULT_ADMIN_EMAIL
  const [activeSection, setActiveSection] = useState<ActiveSection>('none')
  const [selectedLocale, setSelectedLocale] = useState<Locale>((userLocale || currentLocale) as Locale)
  const [selectedTimezone, setSelectedTimezone] = useState(userTimezone || 'Asia/Seoul')
  const [selectedCurrency, setSelectedCurrency] = useState(userCurrency || 'USD')
  const [manualRate, setManualRate] = useState<string>(userCurrencyRate != null ? String(userCurrencyRate) : '')
  const [autoRate, setAutoRate] = useState<{ rate: number; updatedAt: string | null } | null>(null)
  const [currencySaving, setCurrencySaving] = useState(false)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoTs, setPhotoTs] = useState(() => Date.now())
  const [cropFile, setCropFile] = useState<File | null>(null)

  // Slack 워크스페이스 — Slack으로 로그인한 사용자에게만 노출(eligible). 원클릭 설치/제거.
  const [slackEligible, setSlackEligible] = useState(false)
  const [slackWorkspaces, setSlackWorkspaces] = useState<SlackWorkspaceRow[]>([])
  const [slackMsg, setSlackMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 작업완료 Slack 알림 — 본인 member ID 연결 + 수신 on/off (blur 자동저장)
  const [slackMemberId, setSlackMemberId] = useState(userSlackUserId ?? '')
  const [slackNotifyOn, setSlackNotifyOn] = useState(userSlackNotify ?? true)
  const [slackAcctSaved, setSlackAcctSaved] = useState(false)
  const [slackAcctErr, setSlackAcctErr] = useState(false)

  const saveSlackAccount = useCallback(async (memberId: string, notify: boolean) => {
    setSlackAcctSaved(false)
    setSlackAcctErr(false)
    try {
      const res = await fetch('/api/settings/slack-account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackUserId: memberId.trim(), slackNotify: notify }),
      })
      if (!res.ok) { setSlackAcctErr(true); return }
      onSettingsChanged?.()
      setSlackAcctSaved(true)
      setTimeout(() => setSlackAcctSaved(false), 2000)
    } catch { setSlackAcctErr(true) }
  }, [onSettingsChanged])

  const loadSlack = useCallback(async () => {
    try {
      const res = await fetch('/api/slack/my-workspaces')
      if (res.ok) {
        const d = await res.json()
        setSlackEligible(!!d.eligible)
        setSlackWorkspaces(Array.isArray(d.workspaces) ? d.workspaces : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadSlack() }, [loadSlack])

  // 설치 실패 코드 → 사람이 읽고 행동할 수 있는 메시지 (raw 코드 노출 금지)
  function friendlySlackError(code: string): string {
    switch (code) {
      case 'already_claimed': return t('slackErrAlreadyClaimed')
      case 'access_denied': return t('slackErrCancelled')
      case 'app_credentials_missing': return t('slackErrAppCfg')
      case 'missing_code_or_state':
      case 'state_cookie_missing':
      case 'state_malformed':
      case 'state_mismatch': return t('slackErrExpired')
      default: return `${t('slackErrGeneric')} (${code})`
    }
  }

  // Add to Slack 설치 결과 (콜백이 ?slack_install_ok / ?slack_install_error 로 복귀)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const ok = p.get('slack_install_ok')
    const err = p.get('slack_install_error')
    if (!ok && !err) return
    setActiveSection('slack')
    if (ok) { setSlackMsg({ kind: 'ok', text: t('slackInstalled') }); loadSlack() }
    else setSlackMsg({ kind: 'error', text: friendlySlackError(err!) })
    p.delete('slack_install_ok'); p.delete('slack_install_error')
    const qs = p.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [loadSlack, t])

  async function removeSlackWorkspace(id: string) {
    const res = await fetch(`/api/slack/my-workspaces/${id}`, { method: 'DELETE' })
    if (res.ok) loadSlack()
  }

  // 환경 설정 자동 저장
  async function savePreferences(locale: Locale, timezone: string) {
    setPrefsSaving(true)
    setPrefsSaved(false)
    try {
      if (locale !== currentLocale) {
        document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000`
      }
      await fetch('/api/settings/locale', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, timezone }),
      })
      onSettingsChanged?.()
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2000)
      if (locale !== currentLocale) {
        router.refresh()
      }
    } catch { /* ignore */ } finally {
      setPrefsSaving(false)
    }
  }

  // 표시 통화 설정 저장 (USD = 환산 안 함, rate 비우면 자동 환율 사용)
  async function saveCurrency(code: string, rate: string) {
    setCurrencySaving(true)
    setPrefsSaved(false)
    try {
      const res = await fetch('/api/settings/currency', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: code === 'USD' ? null : code, rate: rate.trim() ? parseFloat(rate) : null }),
      })
      if (res.ok) {
        const d = await res.json()
        if (d.source === 'auto') setAutoRate({ rate: d.rate, updatedAt: d.updatedAt })
        onSettingsChanged?.()
        setPrefsSaved(true)
        setTimeout(() => setPrefsSaved(false), 2000)
      }
    } catch { /* ignore */ } finally {
      setCurrencySaving(false)
    }
  }

  // 자동 환율 즉시 갱신 ("지금 갱신")
  async function refreshAutoRate(code: string) {
    if (code === 'USD') return
    setCurrencySaving(true)
    try {
      const res = await fetch('/api/settings/currency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: code }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.ok) setAutoRate({ rate: d.rate, updatedAt: d.updatedAt })
      else if (d?.cached) setAutoRate(d.cached)
    } catch { /* ignore */ } finally {
      setCurrencySaving(false)
    }
  }

  // 마운트 시 현재 적용 중인 자동 환율 표시용으로 1회 로드
  useEffect(() => {
    fetch('/api/settings/currency')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.source === 'auto') setAutoRate({ rate: d.rate, updatedAt: d.updatedAt }) })
      .catch(() => {})
  }, [])

  // 이메일 변경
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailSendingCode, setEmailSendingCode] = useState(false)
  const [emailPassword, setEmailPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState(false)

  // 비밀번호 변경
  const [pwCode, setPwCode] = useState('')
  const [pwCodeSent, setPwCodeSent] = useState(false)
  const [pwSendingCode, setPwSendingCode] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
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
        let errorMsg = t('uploadFailed')
        try {
          const data = await res.json()
          errorMsg = data.error || errorMsg
        } catch {
          if (res.status === 413) errorMsg = t('fileTooLarge')
          else errorMsg = `${t('uploadFailed')} (${res.status})`
        }
        popup(errorMsg)
      }
    } catch {
      popup(t('networkError'))
    } finally {
      setUploading(false)
    }
  }

  // 이메일 인증 코드 전송
  async function handleEmailSendCode() {
    if (!newEmail) { popup(t('newEmailRequired')); return }
    setEmailSendingCode(true)
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, purpose: 'change-email' }),
      })
      const data = await res.json()
      if (!res.ok) { popup(data.error); return }
      setEmailCodeSent(true)
    } finally {
      setEmailSendingCode(false)
    }
  }

  // 이메일 변경 제출
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!emailCodeSent || emailCode.length < 6) { popup(t('verifyRequiredNotice')); return }
    setEmailLoading(true)
    try {
      const res = await fetch('/api/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail, currentPassword: emailPassword, code: emailCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { popup(data.error); return }
      setEmailSuccess(true)
      onEmailChanged?.()
      setTimeout(() => onSuccess?.(), 1500)
    } finally {
      setEmailLoading(false)
    }
  }

  // 비밀번호 인증 코드 전송
  async function handlePwSendCode() {
    setPwSendingCode(true)
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'change-password' }),
      })
      const data = await res.json()
      if (!res.ok) { popup(data.error); return }
      setPwCodeSent(true)
    } finally {
      setPwSendingCode(false)
    }
  }

  // 비밀번호 변경 제출
  async function handlePwSubmit(e: React.FormEvent) {
    e.preventDefault()
    // 검증 실패는 모두 팝업으로 (인라인 메시지 안 씀)
    if (newPassword !== newPasswordConfirm) { popup(t('newPasswordMismatch')); return }
    if (!skipPwVerification && (!pwCodeSent || pwCode.length < 6)) { popup(t('verifyRequiredNotice')); return }
    setPwLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, currentPassword, newPassword, code: pwCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { popup(data.error); return }
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
        <p className="text-sm text-ive-text font-bold">{t('emailChanged')}</p>
      </div>
    )
  }
  if (pwSuccess) {
    return (
      <div className="text-center py-6">
        <i className="fa-solid fa-circle-check text-ive-green text-3xl mb-3" />
        <p className="text-sm text-ive-text font-bold">{t('passwordChanged')}</p>
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
            <i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('uploading')}
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
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all hover:scale-110 overflow-hidden"
            style={avatar !== 'photo' ? { backgroundColor: (() => { const av = DEFAULT_AVATARS.find(a => a.id === avatar); return av ? `${av.color}20` : undefined })() } : undefined}
            title={t('changeAvatar')}
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
                    const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
                    popup(t('fileSizeWarning', { size: sizeMB }))
                    if (fileInputRef.current) fileInputRef.current.value = ''
                    return
                  }
                  setCropFile(file)
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 rounded-lg text-sm font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text hover:border-ive-green transition-colors flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-camera text-ive-green" />
                {t('uploadPhoto')}
              </button>
            </div>
            <p className="text-xs font-bold text-ive-text-muted mb-2">{t('orSelectIcon')}</p>
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
                    } else {
                      const data = await res.json().catch(() => ({}))
                      popup(data.error || t('avatarSaveFailed'))
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
            <span className="text-sm font-bold text-ive-text">{t('changeEmail')}</span>
          </div>
          <i className={`fa-solid fa-chevron-${activeSection === 'email' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>
        {activeSection === 'email' && (
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
            <button type="submit" disabled={emailLoading || !newEmail || !emailPassword} className="w-full py-2.5 rounded-lg text-sm font-bold bg-ive-cyan/80 text-white disabled:opacity-50">
              {emailLoading ? t('changingPassword') : t('changeEmail')}
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
            <span className="text-sm font-bold text-ive-text">{t('changePassword')}</span>
          </div>
          <i className={`fa-solid fa-chevron-${activeSection === 'password' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>
        {activeSection === 'password' && (
          <form onSubmit={handlePwSubmit} className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-ive-border">
            {!skipPwVerification && (
              <div>
                <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('emailVerification')}</label>
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
                    {pwSendingCode ? <i className="fa-solid fa-circle-notch fa-spin" /> : pwCodeSent ? t('resend') : t('verify')}
                  </button>
                </div>
              </div>
            )}
            {!skipPwVerification && pwCodeSent && (
              <div>
                <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('verificationCode')}</label>
                <input
                  type="text"
                  value={pwCode}
                  onChange={e => setPwCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('sixDigits')}
                  maxLength={6}
                  required
                  className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text font-mono tracking-widest text-center focus:outline-none focus:border-ive-green"
                />
                <p className="text-xs text-ive-text-dim mt-1">{t('emailCodeHint')}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('currentPassword')}</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text focus:outline-none focus:border-ive-green"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('newPassword')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder={t('minSixChars')}
                className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('newPasswordConfirm')}</label>
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
            </div>
            <button type="submit" disabled={pwLoading || !currentPassword || !newPassword || !newPasswordConfirm} className="w-full py-2.5 rounded-lg text-sm font-bold bg-ive-green-dark text-white disabled:opacity-50">
              {pwLoading ? t('changingPassword') : t('changePassword')}
            </button>
          </form>
        )}
      </div>

      {/* 환경 설정 섹션 (언어 + 타임존) */}
      <div className="border border-ive-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setActiveSection(activeSection === 'preferences' ? 'none' : 'preferences')}
          className="w-full flex items-center justify-between px-4 py-3 bg-ive-bg-card hover:bg-ive-bg-input transition-colors"
        >
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-gear text-sm text-ive-text-muted" />
            <span className="text-sm font-bold text-ive-text">{t('preferences')}</span>
          </div>
          <i className={`fa-solid fa-chevron-${activeSection === 'preferences' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>
        {activeSection === 'preferences' && (
          <div className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-ive-border">
            {/* 언어 선택 */}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">
                <i className="fa-solid fa-globe mr-1 text-xs" />{t('language')}
              </label>
              <div className="flex gap-2">
                {locales.map((l) => (
                  <button
                    key={l}
                    type="button"
                    disabled={prefsSaving}
                    onClick={() => {
                      setSelectedLocale(l)
                      savePreferences(l, selectedTimezone)
                    }}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      selectedLocale === l
                        ? 'bg-ive-green/15 text-ive-green border border-ive-green/30'
                        : 'bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim hover:border-ive-green/30'
                    }`}
                  >
                    {localeNames[l]}
                  </button>
                ))}
              </div>
            </div>
            {/* 타임존 선택 */}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">
                <i className="fa-solid fa-clock mr-1 text-xs" />{t('timezone')}
              </label>
              <CustomSelect
                value={selectedTimezone}
                disabled={prefsSaving}
                onChange={(tz) => {
                  setSelectedTimezone(tz)
                  savePreferences(selectedLocale, tz)
                }}
                options={TIMEZONE_OPTIONS.map((tz) => ({ value: tz.value, label: tz.label }))}
              />
              <p className="text-xs text-ive-text-dim mt-1">{t('timezoneDescription')}</p>
            </div>
            {/* 표시 통화 선택 */}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1">
                <i className="fa-solid fa-coins mr-1 text-xs" />{t('currency')}
              </label>
              <CustomSelect
                value={selectedCurrency}
                disabled={currencySaving}
                onChange={(code) => {
                  setSelectedCurrency(code)
                  if (code === 'USD') setManualRate('')
                  saveCurrency(code, code === 'USD' ? '' : manualRate)
                }}
                options={SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol} ${c.code} — ${c.label}` }))}
              />
              <p className="text-xs text-ive-text-dim mt-1">{t('currencyDescription')}</p>
            </div>
            {/* 수동 환율 입력 (USD가 아닐 때만) */}
            {selectedCurrency !== 'USD' && (
              <div>
                <label className="block text-sm font-bold text-ive-text-muted mb-1">
                  <i className="fa-solid fa-money-bill-transfer mr-1 text-xs" />{t('exchangeRate')}
                </label>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-ive-text-dim shrink-0">1 USD =</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={manualRate}
                    disabled={currencySaving}
                    placeholder={autoRate ? String(autoRate.rate) : t('exchangeRateAuto')}
                    onChange={(e) => setManualRate(e.target.value)}
                    onBlur={() => saveCurrency(selectedCurrency, manualRate)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text text-right focus:outline-none focus:border-ive-green"
                  />
                  <span className="text-xs text-ive-text-dim shrink-0">{selectedCurrency}</span>
                  <button
                    type="button"
                    onClick={() => refreshAutoRate(selectedCurrency)}
                    disabled={currencySaving}
                    title={t('refreshRate')}
                    className="shrink-0 px-2.5 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan disabled:opacity-40"
                  >
                    <i className={`fa-solid fa-rotate ${currencySaving ? 'fa-spin' : ''}`} />
                  </button>
                </div>
                <p className="text-xs text-ive-text-dim mt-1">
                  {manualRate.trim()
                    ? t('exchangeRateManualHint')
                    : autoRate
                      ? t('exchangeRateAutoHint', { rate: autoRate.rate.toLocaleString(), at: autoRate.updatedAt ? new Date(autoRate.updatedAt).toLocaleDateString() : '—' })
                      : t('exchangeRateNoneHint')}
                </p>
              </div>
            )}

            {/* 작업완료 Slack 알림 — 본인 member ID 연결 + 수신 on/off */}
            <div className="border-t border-ive-border-dark pt-3">
              <label className="block text-xs font-bold text-ive-text-muted mb-1.5 uppercase">
                <i className="fa-brands fa-slack mr-1.5" />{t('slackNotifyLabel')}
              </label>
              <p className="text-xs text-ive-text-dim mb-2 leading-relaxed">{t('slackNotifyDesc')}</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={slackMemberId}
                  onChange={e => setSlackMemberId(e.target.value)}
                  onBlur={() => saveSlackAccount(slackMemberId, slackNotifyOn)}
                  placeholder="U01ABCDEF"
                  className="flex-1 min-w-0 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text font-mono focus:outline-none focus:border-ive-green"
                />
                <button
                  type="button"
                  onClick={() => { const next = !slackNotifyOn; setSlackNotifyOn(next); saveSlackAccount(slackMemberId, next) }}
                  title={t('slackNotifyToggle')}
                  className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${slackNotifyOn ? 'bg-ive-green/15 border-ive-green/40 text-ive-green' : 'bg-ive-bg-deep border-ive-border-subtle text-ive-text-dim'}`}
                >
                  <i className={`fa-solid ${slackNotifyOn ? 'fa-bell' : 'fa-bell-slash'} mr-1`} />
                  {slackNotifyOn ? t('slackNotifyReceiveOn') : t('slackNotifyReceiveOff')}
                </button>
              </div>
              <p className="text-[10px] text-ive-text-dim/70 mt-1.5 leading-relaxed">{t('slackMemberIdHint')}</p>
              {slackAcctSaved && (
                <p className="text-xs text-ive-green mt-1"><i className="fa-solid fa-circle-check mr-1" />{t('settingsSaved')}</p>
              )}
              {slackAcctErr && (
                <p className="text-xs text-ive-red mt-1"><i className="fa-solid fa-triangle-exclamation mr-1" />{t('slackMemberIdInvalid')}</p>
              )}
            </div>

            {/* 자동 저장 피드백 */}
            {prefsSaving && (
              <div className="text-center text-sm text-ive-text-muted py-1">
                <i className="fa-solid fa-circle-notch fa-spin mr-1" />{tc('save')}...
              </div>
            )}
            {prefsSaved && (
              <div className="text-center text-sm text-ive-green py-1 animate-fade-in">
                <i className="fa-solid fa-circle-check mr-1" />{t('settingsSaved')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Slack 워크스페이스 — Slack 로그인 사용자만. 원클릭 'Add to Slack' (입력 없음, Slack 동의가 확인) */}
      {slackEligible && (
        <div className="border border-ive-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setActiveSection(activeSection === 'slack' ? 'none' : 'slack')}
            className="w-full flex items-center justify-between px-4 py-3 bg-ive-bg-card hover:bg-ive-bg-input transition-colors"
          >
            <div className="flex items-center gap-2">
              <i className="fa-brands fa-slack text-sm text-ive-cyan" />
              <span className="text-sm font-bold text-ive-text">{t('slackWorkspaces')}</span>
              {slackWorkspaces.length > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-ive-green/15 text-ive-green">{slackWorkspaces.length}</span>
              )}
            </div>
            <i className={`fa-solid fa-chevron-${activeSection === 'slack' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
          </button>
          {activeSection === 'slack' && (
            <div className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-ive-border">
              {slackMsg && (
                <div className={`text-sm rounded-lg px-3 py-2 ${slackMsg.kind === 'ok' ? 'text-ive-green bg-ive-green/10' : 'text-ive-red bg-ive-red/10'}`}>
                  <i className={`fa-solid ${slackMsg.kind === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-1`} />{slackMsg.text}
                </div>
              )}
              <p className="text-xs text-ive-text-dim leading-relaxed">{t('slackOwnerHint')}</p>

              {slackWorkspaces.length > 0 && (
                <div className="flex flex-col gap-2">
                  {slackWorkspaces.map(w => {
                    const urlText = w.teamUrl ? w.teamUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : ''
                    return (
                      <div key={w.id} className="flex items-center gap-2 bg-ive-bg-deep border border-ive-border-subtle rounded-lg px-3 py-2">
                        <i className="fa-brands fa-slack text-ive-cyan shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-ive-text truncate">{w.name}</div>
                          {urlText && <div className="text-xs text-ive-text-dim truncate">{urlText}</div>}
                        </div>
                        <button
                          type="button"
                          onClick={async () => { if (await dialogConfirm({ title: t('slackRemove'), message: t('slackRemoveConfirm'), variant: 'danger', confirmText: t('slackRemove') })) removeSlackWorkspace(w.id) }}
                          className="text-ive-red text-xs font-bold px-2 py-1 shrink-0"
                        >
                          <i className="fa-solid fa-trash mr-1" />{t('slackRemove')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {slackWorkspaces.length === 0 && (
                <p className="text-xs text-ive-text-dim">{t('slackNoWorkspaces')}</p>
              )}
              {/* 원클릭: 클릭 → Slack 동의 화면(확인) → 설치 완료. 사용자 입력 0 */}
              <a
                href="/api/slack/install/start?from=profile"
                className="w-full inline-flex items-center justify-center gap-2 bg-ive-green-dark text-white font-bold py-2.5 rounded-lg text-sm active:bg-ive-green/80 transition-colors"
              >
                <i className="fa-brands fa-slack" />{t('slackAddWorkspace')}
              </a>
            </div>
          )}
        </div>
      )}

      {onCancel && (
        <button type="button" onClick={onCancel} className="w-full py-2.5 rounded-lg text-sm font-bold text-ive-text-dim bg-ive-bg-card border border-ive-border-subtle">
          {tc('close')}
        </button>
      )}

    </div>
  )
}
