'use client'

import { DEFAULT_AVATARS } from '@/types'
import type { ToolCategory } from '@/lib/tool-activity'
import CliLogo, { CLI_LOGO_NAMES } from '@/components/ui/CliLogo'

interface Props {
  /**
   * 다음 형태 중 하나:
   *  - 'av-01'~'av-20': 프리셋 아이콘 아바타
   *  - URL ('http...', '/api/...', 'data:...'): 직접 이미지 표시
   *  - 'photo': 사용자가 업로드/OAuth 다운로드한 사진. 이 경우 `userId` 필요
   *    (userId가 있으면 `/api/auth/avatar/{userId}`로 자동 변환, 없으면 av-01 fallback)
   *  - 'person': 아바타가 없는 사람 — 기본 사람 아이콘
   */
  avatar: string
  /** avatar==='photo' 일 때만 사용. 사진 fetch URL 생성용 */
  userId?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  /** 진행 중 배지 — 에이전트는 도구 종류, 사람은 'human'(사람이 작업 중) */
  toolBadge?: BadgeKind | null
}

type BadgeKind = ToolCategory | 'human'

const sizeMap = {
  xs: 'w-4 h-4 text-[10px]',
  sm: 'w-7 h-7 text-sm',
  md: 'w-9 h-9 text-lg',
  lg: 'w-12 h-12 text-2xl',
}

const badgeSizeMap = {
  xs: 'w-2.5 h-2.5 text-[6px] -bottom-0 -right-0',
  sm: 'w-3.5 h-3.5 text-[7px] -bottom-0.5 -right-0.5',
  md: 'w-4 h-4 text-[8px] -bottom-0.5 -right-0.5',
  lg: 'w-5 h-5 text-xs -bottom-0.5 -right-0.5',
}

// 도구 종류는 아이콘 형태로만 구분. 색은 통일 (브랜드 cyan).
// '진행 중'을 알리는 게 목적이고, 어떤 도구인지는 아이콘 자체로 구분 가능.
const TOOL_BADGE: Record<ToolCategory, { icon: string }> = {
  thinking: { icon: 'fa-solid fa-brain' },
  file:     { icon: 'fa-solid fa-file-code' },
  terminal: { icon: 'fa-solid fa-terminal' },
  search:   { icon: 'fa-solid fa-magnifying-glass' },
  web:      { icon: 'fa-solid fa-globe' },
  agent:    { icon: 'fa-solid fa-users' },
  db:       { icon: 'fa-solid fa-database' },
  idle:     { icon: 'fa-solid fa-clock' },
}

export { TOOL_BADGE }

// 사람은 도구 활동이 없다 — 사람 아이콘 하나로 「작업 중」만 알린다
const BADGE_ICON: Record<BadgeKind, string> = {
  ...Object.fromEntries(Object.entries(TOOL_BADGE).map(([k, v]) => [k, v.icon])) as Record<ToolCategory, string>,
  human: 'fa-solid fa-user-pen',
}

function ToolBadge({ category, size }: { category: BadgeKind; size: 'xs' | 'sm' | 'md' | 'lg' }) {
  // 배지는 항상 불투명·아바타 위(z-10). 'thinking' 표시는 배지 자체를 흔들지 않고
  // 외곽으로 퍼지는 별도 ring(animate-ping)으로 표현해야 아이콘이 사라지지 않음.
  return (
    <div className={`absolute ${badgeSizeMap[size]} z-10`}>
      {(category === 'thinking' || category === 'human') && (
        <span className="absolute inset-0 rounded-full ring-2 ring-ive-cyan/70 animate-ping pointer-events-none" />
      )}
      <span className="absolute inset-0 rounded-full bg-ive-bg-deep border border-ive-cyan flex items-center justify-center text-ive-cyan">
        <i className={BADGE_ICON[category]} />
      </span>
    </div>
  )
}

export default function AgentAvatar({ avatar, userId, size = 'md', className = '', toolBadge }: Props) {
  const wh = sizeMap[size].split(' ').slice(0, 2).join(' ')

  // 'photo' (업로드 사진) → userId가 있으면 사진 URL로 변환
  let resolved = avatar
  if (resolved === 'photo' && userId) {
    resolved = `/api/auth/avatar/image?id=${userId}`
  }

  // CLI 회사 브랜드 로고 아바타 ('cli-claude' | 'cli-agy' | 'cli-codex' | 'cli-opencode')
  if (resolved.startsWith('cli-') && CLI_LOGO_NAMES.includes(resolved.slice(4))) {
    return (
      <div className={`relative shrink-0 ${wh} ${className}`}>
        <div className="w-full h-full rounded-lg flex items-center justify-center bg-ive-bg-deep border border-ive-border-subtle">
          <CliLogo cli={resolved.slice(4)} className="w-[80%] h-[80%]" />
        </div>
        {toolBadge && <ToolBadge category={toolBadge} size={size} />}
      </div>
    )
  }

  // 아바타가 없는 사람
  if (resolved === 'person') {
    return (
      <div className={`relative shrink-0 ${wh} ${className}`}>
        <div className="w-full h-full rounded-lg flex items-center justify-center bg-ive-bg-deep border border-ive-border-subtle">
          <i className={`fa-solid fa-user ${size === 'xs' ? 'text-[8px]' : 'text-[10px]'} text-ive-text-dim`} />
        </div>
        {toolBadge && <ToolBadge category={toolBadge} size={size} />}
      </div>
    )
  }

  // URL인 경우 (GitLab 아바타, 업로드된 IVE 사용자 사진, data URL)
  if (resolved.startsWith('http') || resolved.startsWith('/') || resolved.startsWith('data:')) {
    return (
      <div className={`relative shrink-0 ${wh} ${className}`}>
        <img
          src={resolved}
          alt=""
          className={`w-full h-full rounded-lg object-cover bg-ive-bg-deep border border-ive-border-subtle`}
        />
        {toolBadge && <ToolBadge category={toolBadge} size={size} />}
      </div>
    )
  }

  // 기본 아바타 ID — cyan 톤 그라디언트 배경 + 흰색 아이콘
  // ('photo' 인데 userId 없으면 여기로 fallback)
  const av = DEFAULT_AVATARS.find(a => a.id === resolved) || DEFAULT_AVATARS[0]
  return (
    <div className={`relative shrink-0 ${wh} ${className}`}>
      <div
        className={`w-full h-full ${sizeMap[size].split(' ').slice(2).join(' ')} rounded-lg flex items-center justify-center text-white`}
        style={{
          background: `linear-gradient(135deg, ${av.color}, ${av.color}b0)`,
          boxShadow: `inset 0 0 0 1px ${av.color}80`,
        }}
      >
        <i className={av.icon} />
      </div>
      {toolBadge && <ToolBadge category={toolBadge} size={size} />}
    </div>
  )
}

interface SelectorProps {
  value: string
  onChange: (avatar: string) => void
  /** 지정 시 해당 CLI 회사 브랜드 로고를 첫 옵션으로 추가 */
  cliName?: string
}

export function AvatarSelector({ value, onChange, cliName }: SelectorProps) {
  const cliAvatarId = cliName && CLI_LOGO_NAMES.includes(cliName) ? `cli-${cliName}` : null
  return (
    <div className="grid grid-cols-10 gap-1.5">
      {cliAvatarId && (
        <button
          key={cliAvatarId}
          type="button"
          onClick={() => onChange(cliAvatarId)}
          title={cliName}
          className={`w-9 h-9 rounded-lg flex items-center justify-center bg-ive-bg-deep transition-all ${
            value === cliAvatarId
              ? 'ring-2 ring-ive-cyan ring-offset-2 ring-offset-ive-bg-deep scale-110'
              : 'border border-ive-border-subtle hover:scale-105 opacity-80 hover:opacity-100'
          }`}
        >
          <CliLogo cli={cliName!} className="w-4/5 h-4/5" />
        </button>
      )}
      {DEFAULT_AVATARS.map(av => {
        const selected = value === av.id
        return (
          <button
            key={av.id}
            type="button"
            onClick={() => onChange(av.id)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg text-white transition-all ${
              selected ? 'ring-2 ring-ive-cyan ring-offset-2 ring-offset-ive-bg-deep scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100'
            }`}
            style={{
              background: `linear-gradient(135deg, ${av.color}, ${av.color}b0)`,
              boxShadow: selected ? undefined : `inset 0 0 0 1px ${av.color}80`,
            }}
          >
            <i className={av.icon} />
          </button>
        )
      })}
    </div>
  )
}
