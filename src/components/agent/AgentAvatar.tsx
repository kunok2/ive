'use client'

import { DEFAULT_AVATARS } from '@/types'
import type { ToolCategory } from '@/lib/tool-activity'

interface Props {
  avatar: string          // 'av-01'~'av-20' or URL
  size?: 'sm' | 'md' | 'lg'
  className?: string
  toolBadge?: ToolCategory | null
}

const sizeMap = {
  sm: 'w-7 h-7 text-sm',
  md: 'w-9 h-9 text-lg',
  lg: 'w-12 h-12 text-2xl',
}

const badgeSizeMap = {
  sm: 'w-3.5 h-3.5 text-[7px] -bottom-0.5 -right-0.5',
  md: 'w-4 h-4 text-[8px] -bottom-0.5 -right-0.5',
  lg: 'w-5 h-5 text-[10px] -bottom-0.5 -right-0.5',
}

const TOOL_BADGE: Record<ToolCategory, { icon: string; color: string; bg: string }> = {
  thinking: { icon: 'fa-solid fa-brain',        color: '#c084fc', bg: 'bg-purple-500/90' },
  file:     { icon: 'fa-solid fa-file-code',     color: '#60a5fa', bg: 'bg-blue-500/90' },
  terminal: { icon: 'fa-solid fa-terminal',      color: '#fbbf24', bg: 'bg-amber-500/90' },
  search:   { icon: 'fa-solid fa-magnifying-glass', color: '#4ade80', bg: 'bg-green-500/90' },
  web:      { icon: 'fa-solid fa-globe',         color: '#22d3ee', bg: 'bg-cyan-500/90' },
  agent:    { icon: 'fa-solid fa-users',         color: '#f472b6', bg: 'bg-pink-500/90' },
  db:       { icon: 'fa-solid fa-database',      color: '#fb923c', bg: 'bg-orange-500/90' },
  idle:     { icon: 'fa-solid fa-clock',         color: '#94a3b8', bg: 'bg-slate-500/90' },
}

export { TOOL_BADGE }

function ToolBadge({ category, size }: { category: ToolCategory; size: 'sm' | 'md' | 'lg' }) {
  const badge = TOOL_BADGE[category]
  return (
    <div className={`absolute ${badgeSizeMap[size]} rounded-full ${badge.bg} border border-ive-bg-deep flex items-center justify-center ${category === 'thinking' ? 'animate-pulse' : ''}`}>
      <i className={badge.icon} style={{ color: '#fff' }} />
    </div>
  )
}

export default function AgentAvatar({ avatar, size = 'md', className = '', toolBadge }: Props) {
  const wh = sizeMap[size].split(' ').slice(0, 2).join(' ')

  // URL인 경우 (GitLab 아바타)
  if (avatar.startsWith('http')) {
    return (
      <div className={`relative shrink-0 ${wh} ${className}`}>
        <img
          src={avatar}
          alt="avatar"
          className={`w-full h-full rounded-lg object-cover bg-ive-bg-deep border border-ive-border`}
        />
        {toolBadge && <ToolBadge category={toolBadge} size={size} />}
      </div>
    )
  }

  // 기본 아바타 ID
  const av = DEFAULT_AVATARS.find(a => a.id === avatar) || DEFAULT_AVATARS[0]
  return (
    <div className={`relative shrink-0 ${wh} ${className}`}>
      <div
        className={`w-full h-full ${sizeMap[size].split(' ').slice(2).join(' ')} rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center`}
        style={{ borderColor: `${av.color}40` }}
      >
        <i className={av.icon} style={{ color: av.color }} />
      </div>
      {toolBadge && <ToolBadge category={toolBadge} size={size} />}
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
