'use client'

import { DEFAULT_AVATARS } from '@/types'

interface Props {
  avatar: string          // 'av-01'~'av-20' or URL
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'w-7 h-7 text-sm',
  md: 'w-9 h-9 text-lg',
  lg: 'w-12 h-12 text-2xl',
}

export default function AgentAvatar({ avatar, size = 'md', className = '' }: Props) {
  // URL인 경우 (GitLab 아바타)
  if (avatar.startsWith('http')) {
    return (
      <img
        src={avatar}
        alt="avatar"
        className={`${sizeMap[size].split(' ').slice(0, 2).join(' ')} rounded-lg object-cover bg-ive-bg-deep border border-ive-border ${className}`}
      />
    )
  }

  // 기본 아바타 ID
  const av = DEFAULT_AVATARS.find(a => a.id === avatar) || DEFAULT_AVATARS[0]
  return (
    <div
      className={`${sizeMap[size]} rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0 ${className}`}
      style={{ borderColor: `${av.color}40` }}
    >
      <i className={av.icon} style={{ color: av.color }} />
    </div>
  )
}

interface SelectorProps {
  value: string
  onChange: (avatar: string) => void
}

export function AvatarSelector({ value, onChange }: SelectorProps) {
  return (
    <div className="grid grid-cols-10 gap-1.5">
      {DEFAULT_AVATARS.map(av => (
        <button
          key={av.id}
          type="button"
          onClick={() => onChange(av.id)}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all ${
            value === av.id
              ? 'ring-2 ring-ive-green bg-ive-green/10 scale-110'
              : 'bg-ive-bg-deep border border-ive-border-subtle hover:scale-105'
          }`}
          style={{ borderColor: value === av.id ? undefined : `${av.color}30` }}
        >
          <i className={av.icon} style={{ color: av.color }} />
        </button>
      ))}
    </div>
  )
}
