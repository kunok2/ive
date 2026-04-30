'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { DEFAULT_AVATARS } from '@/types'
import AvatarCropEditor from './AvatarCropEditor'

interface ProfileAvatarSectionProps {
  userId: string
  avatar: string
  name: string
  email: string
  photoTs: number
  activeSection: string
  onToggle: () => void
  cropFile: File | null
  setCropFile: (f: File | null) => void
  uploading: boolean
  onUploadCroppedImage: (blob: Blob) => void
  onAvatarChanged?: () => void
  onActiveSection: (s: 'none') => void
}

export default function ProfileAvatarSection({
  userId, avatar, name, email, photoTs, activeSection, onToggle,
  cropFile, setCropFile, uploading, onUploadCroppedImage, onAvatarChanged, onActiveSection,
}: ProfileAvatarSectionProps) {
  const t = useTranslations('auth')
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (cropFile) {
    return (
      <div className="flex flex-col gap-4">
        <AvatarCropEditor
          imageFile={cropFile}
          onConfirm={(blob) => onUploadCroppedImage(blob)}
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
    <div className="bg-ive-bg-input rounded-lg px-4 py-3 border border-ive-border">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
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
                  alert(t('fileSizeWarning', { size: sizeMB }))
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
                    onActiveSection('none')
                  } else {
                    const data = await res.json().catch(() => ({}))
                    alert(data.error || t('avatarSaveFailed'))
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
  )
}
