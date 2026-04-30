'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { DEFAULT_AVATARS } from '@/types'
import AssigneePickerModal from '@/components/tabs/issues/AssigneePickerModal'

export type RoleMode = 'creator' | 'auto' | 'specific'

export interface PresetRole {
  mode: RoleMode
  userId: string | null
  username: string | null
}

export interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

export interface CreatorInfo {
  name: string | null
  avatar: string | null      // URL or 'av-XX' or null
  avatarUrl: string | null   // URL fallback
}

/**
 * 처리자 = AI 에이전트가 작업을 처리한다는 IVE 모델.
 *   - assignMode='agent' + agentId  → 특정 에이전트
 *   - assignMode='auto'             → 라운드로빈 (agent 풀에서 자동 선택)
 *   - assignMode='assignee'         → 사람이 처리 (그 사람이 dev 단계 Git assignee)
 *   - assignMode='none'             → 처리 안 함 (단순 이슈, IVE-S 미부착)
 */
export interface ProcessorInfo {
  assignMode: 'agent' | 'auto' | 'assignee' | 'none' | null
  /** 에이전트 정보 — assignMode='agent' 일 때 사용 */
  agentName?: string | null
  agentAvatar?: string | null   // 'av-XX' 또는 URL
  /** assignMode='assignee' 일 때 현재 Git assignee */
  username?: string | null
  name?: string | null
  avatarUrl?: string | null
  /** 레거시 assigneeAuto flag (처리 마무리 시 가장 한가한 사람을 다음 담당자로 자동 배정 대기) */
  pendingAuto?: boolean
}

/**
 * 실제 수행자 — 단계가 진행되었을 때 그 단계를 수행한 사람/에이전트.
 * 있으면 preset/규칙보다 우선해서 표시한다 (이미 일어난 일은 사람 정보로).
 */
export interface ActualProcessor { agentId: string | null; agentName: string | null; agentAvatar: string | null; cliName: string | null }
export interface ActualPerson { userId: string | null; name: string | null; avatar: string | null }

export interface RoleAvatarBarProps {
  /** 작성자 — 항상 표시, 읽기 전용 */
  creator: CreatorInfo
  /** 처리자 — 현재 Git assignee. 클릭 시 기존 assignee picker 열림 */
  processor: ProcessorInfo
  /** 검증자 preset */
  verifier: PresetRole
  /** 확인자 preset */
  confirmer: PresetRole
  /** 단계가 진행되어 실제 수행한/수행 중인 사람·에이전트 — 있으면 preset 보다 우선 */
  actualProcessor?: ActualProcessor | null
  actualVerifier?: ActualPerson | null
  actualConfirmer?: ActualPerson | null
  gitMembers: GitMember[]
  /** 편집 권한 */
  canEdit: boolean
  /** 처리자(Git assignee) 변경 — 기존 onOpenAssigneePicker 핸들러 위임 */
  onProcessorClick?: () => void
  /** 검증자/확인자 preset 변경 핸들러 */
  onVerifierChange?: (preset: PresetRole) => Promise<void> | void
  onConfirmerChange?: (preset: PresetRole) => Promise<void> | void
  /** 사이즈 — 'sm'(카드용 18px) / 'md'(상세 22px) */
  size?: 'sm' | 'md'
  /** 현재 단계 macro index (1=유입,2=처리,3=검증,4=확인,5=완료). 제공 시 해당 단계 미만의 슬롯은 편집 잠금 */
  currentMacro?: 0 | 1 | 2 | 3 | 4 | 5
}

/**
 * 4개 역할 아바타를 stage 흐름 순서로 보여준다 — 작성자 › 처리자 › 검증자 › 확인자.
 * 미배정 역할은 placeholder 아이콘. 클릭 시 모달.
 */
export default function RoleAvatarBar({
  creator, processor, verifier, confirmer,
  actualProcessor, actualVerifier, actualConfirmer,
  gitMembers, canEdit,
  onProcessorClick, onVerifierChange, onConfirmerChange,
  size = 'md',
  currentMacro = 0,
}: RoleAvatarBarProps) {
  const tIssue = useTranslations('issue')

  // 단계별 게이팅: 이미 지나간 단계(macro idx < currentMacro)는 편집 불가
  // currentMacro=0 (정보 없음) → 모든 슬롯 편집 가능 (canEdit 만 따름)
  function stageEditableFor(idx: 2 | 3 | 4): boolean {
    if (!canEdit) return false
    if (currentMacro === 0) return true
    return idx >= currentMacro
  }

  const [verifierModalOpen, setVerifierModalOpen] = useState(false)
  const [verifierSearch, setVerifierSearch] = useState('')
  const [verifierPick, setVerifierPick] = useState<GitMember | null>(null)
  const [verifierAuto, setVerifierAuto] = useState(false)

  const [confirmerModalOpen, setConfirmerModalOpen] = useState(false)
  const [confirmerSearch, setConfirmerSearch] = useState('')
  const [confirmerPick, setConfirmerPick] = useState<GitMember | null>(null)
  const [confirmerAuto, setConfirmerAuto] = useState(false)

  const dim = size === 'sm' ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]'
  const iconSize = size === 'sm' ? 'text-[8px]' : 'text-[10px]'

  function openVerifier() {
    if (!canEdit) return
    setVerifierAuto(verifier.mode === 'auto')
    setVerifierPick(verifier.mode === 'specific' && verifier.userId
      ? (gitMembers.find(m => String(m.id) === verifier.userId) || null)
      : null)
    setVerifierSearch('')
    setVerifierModalOpen(true)
  }

  function openConfirmer() {
    if (!canEdit) return
    setConfirmerAuto(confirmer.mode === 'auto')
    setConfirmerPick(confirmer.mode === 'specific' && confirmer.userId
      ? (gitMembers.find(m => String(m.id) === confirmer.userId) || null)
      : null)
    setConfirmerSearch('')
    setConfirmerModalOpen(true)
  }

  async function confirmVerifier() {
    let next: PresetRole
    if (verifierAuto) next = { mode: 'auto', userId: null, username: null }
    else if (verifierPick) next = { mode: 'specific', userId: String(verifierPick.id), username: verifierPick.username }
    else next = { mode: 'creator', userId: null, username: null }
    await onVerifierChange?.(next)
    setVerifierModalOpen(false)
  }

  async function confirmConfirmer() {
    let next: PresetRole
    if (confirmerAuto) next = { mode: 'auto', userId: null, username: null }
    else if (confirmerPick) next = { mode: 'specific', userId: String(confirmerPick.id), username: confirmerPick.username }
    else next = { mode: 'creator', userId: null, username: null }
    await onConfirmerChange?.(next)
    setConfirmerModalOpen(false)
  }

  return (
    <>
      <div className="flex items-center">
        {/* 작성자 — 항상 avatar, 읽기 전용 */}
        <RoleSlot
          dim={dim}
          ringClass="ring-ive-green/40"
          isCurrent={currentMacro === 1}
          title={tIssue('roleTooltipFormat', { role: tIssue('roleAuthor'), value: creator.name || '-' })}
          interactive={false}
          content={renderAvatar(creator.avatar || creator.avatarUrl, creator.name, dim)}
        />

        <Chevron size={size} />

        {/* 처리자 — 실제 처리 에이전트가 있으면 그걸, 없으면 preset(assignMode) */}
        <RoleSlot
          dim={dim}
          ringClass="ring-ive-cyan/40"
          isCurrent={currentMacro === 2}
          title={tIssue('roleTooltipFormat', {
            role: tIssue('processor'),
            value: actualProcessor?.agentName
              ? actualProcessor.agentName
              : getProcessorDisplay(processor, creator, tIssue),
          })}
          interactive={stageEditableFor(2) && !!onProcessorClick}
          onClick={onProcessorClick}
          content={actualProcessor?.agentName
            ? renderAvatar(actualProcessor.agentAvatar, actualProcessor.agentName, dim)
            : renderProcessorContent(processor, creator, dim, iconSize)}
        />

        <Chevron size={size} />

        {/* 검증자 — 실제 검증자(시작/완료) 우선, 없으면 preset */}
        <RoleSlot
          dim={dim}
          ringClass="ring-ive-amber/40"
          isCurrent={currentMacro === 3}
          title={actualVerifier?.userId
            ? tIssue('roleTooltipFormat', { role: tIssue('verifier'), value: actualVerifier.name || '-' })
            : presetTooltip(tIssue('verifier'), verifier, gitMembers, creator, tIssue)}
          interactive={stageEditableFor(3)}
          onClick={openVerifier}
          content={actualVerifier?.userId
            ? renderAvatar(actualVerifier.avatar, actualVerifier.name, dim)
            : renderPresetContent(verifier, gitMembers, creator, dim, iconSize)}
        />

        <Chevron size={size} />

        {/* 확인자 — 실제 확인자(시작/완료) 우선, 없으면 preset */}
        <RoleSlot
          dim={dim}
          ringClass="ring-orange-400/50"
          isCurrent={currentMacro === 4}
          title={actualConfirmer?.userId
            ? tIssue('roleTooltipFormat', { role: tIssue('confirmer'), value: actualConfirmer.name || '-' })
            : presetTooltip(tIssue('confirmer'), confirmer, gitMembers, creator, tIssue)}
          interactive={stageEditableFor(4)}
          onClick={openConfirmer}
          content={actualConfirmer?.userId
            ? renderAvatar(actualConfirmer.avatar, actualConfirmer.name, dim)
            : renderPresetContent(confirmer, gitMembers, creator, dim, iconSize)}
        />
      </div>

      <AssigneePickerModal
        open={verifierModalOpen}
        onClose={() => setVerifierModalOpen(false)}
        iids={[-1]}
        gitMembers={gitMembers}
        search={verifierSearch}
        onSearchChange={setVerifierSearch}
        pick={verifierPick}
        onPickChange={setVerifierPick}
        autoMode={verifierAuto}
        onAutoModeChange={setVerifierAuto}
        onConfirm={confirmVerifier}
        title={tIssue('verifier') || '검증자'}
        noneLabel={tIssue('roleModeCreator') || '미배정 (생성자)'}
      />

      <AssigneePickerModal
        open={confirmerModalOpen}
        onClose={() => setConfirmerModalOpen(false)}
        iids={[-1]}
        gitMembers={gitMembers}
        search={confirmerSearch}
        onSearchChange={setConfirmerSearch}
        pick={confirmerPick}
        onPickChange={setConfirmerPick}
        autoMode={confirmerAuto}
        onAutoModeChange={setConfirmerAuto}
        onConfirm={confirmConfirmer}
        title={tIssue('confirmer') || '확인자'}
        noneLabel={tIssue('roleModeCreator') || '미배정 (생성자)'}
      />
    </>
  )
}

// ── helpers ──

/**
 * 역할 사이의 화살표 — 선+삼각형. 작업 상세의 StageProgress 와 동일 스타일.
 * size='sm' 카드용은 짧고 얇게, 'md' 상세는 조금 더 길게.
 */
function Chevron({ size = 'md' }: { size?: 'sm' | 'md' }) {
  // 화살표 자체는 짧게, 양옆에 약간의 숨 공간(mx-1).
  const lineW = size === 'sm' ? 'w-1.5' : 'w-2'
  const triBorder = size === 'sm'
    ? 'border-y-[3px] border-l-[4px]'
    : 'border-y-[4px] border-l-[5px]'
  return (
    <span className="inline-flex items-center mx-1 shrink-0" aria-hidden>
      <span className={`h-0.5 ${lineW} bg-ive-text-dim/40`} />
      <span className={`w-0 h-0 ${triBorder} border-y-transparent border-l-ive-text-dim/40`} />
    </span>
  )
}

interface RoleSlotProps {
  dim: string
  ringClass: string
  title: string
  interactive: boolean
  /** 현재 진행 중인 단계의 슬롯이면 ring pulse 애니메이션. */
  isCurrent?: boolean
  onClick?: () => void
  content: React.ReactNode
}

function RoleSlot({ dim, ringClass, title, interactive, isCurrent, onClick, content }: RoleSlotProps) {
  const animCls = isCurrent ? 'animate-pulse' : ''
  const baseCls = `inline-flex items-center justify-center ${dim} rounded-full overflow-hidden ring-2 ${ringClass} ${animCls} bg-ive-bg-deep shrink-0`
  if (interactive && onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-label={title} className={`${baseCls} hover:ring-ive-green transition-all`}>
        {content}
      </button>
    )
  }
  return (
    <span title={title} aria-label={title} className={`${baseCls} hover:ring-ive-green transition-all`}>
      {content}
    </span>
  )
}

/**
 * 아바타 렌더링 — 다음 형식 지원:
 *   - URL ('http...', '/api/...', 'data:...')  → img
 *   - 'av-XX' (DEFAULT_AVATARS 프리셋)        → 그라디언트 배경 + 아이콘
 *   - 그 외 / null                              → 일반 user 아이콘
 */
export function renderAvatar(src: string | null | undefined, alt: string | null, dim: string, dimmed = false): React.ReactNode {
  const opacityCls = dimmed ? 'opacity-60' : ''

  // URL 직접 표시
  if (src && (src.startsWith('http') || src.startsWith('/') || src.startsWith('data:'))) {
    return <img src={src} alt={alt || ''} className={`${dim} object-cover pointer-events-none ${opacityCls}`} />
  }

  // av-XX 프리셋 — 그라디언트 배경 + 폰트어썸 아이콘
  if (src && src.startsWith('av-')) {
    const av = DEFAULT_AVATARS.find(a => a.id === src) || DEFAULT_AVATARS[0]
    return (
      <span
        className={`${dim} flex items-center justify-center text-white text-[9px] pointer-events-none ${opacityCls}`}
        style={{
          background: `linear-gradient(135deg, ${av.color}, ${av.color}b0)`,
          boxShadow: `inset 0 0 0 1px ${av.color}80`,
        }}
      >
        <i className={av.icon} />
      </span>
    )
  }

  // fallback — 일반 user 아이콘
  return <i className={`fa-solid fa-user text-ive-text-dim text-[10px] pointer-events-none ${opacityCls}`} />
}

/**
 * 처리자 표시 텍스트 (툴팁용).
 *   - assignMode='agent' + agentName  → 에이전트 이름
 *   - assignMode='auto'               → "자동 배정 (라운드로빈)"
 *   - assignMode='assignee' + 사람     → 사람 이름
 *   - assignMode='assignee' + pendingAuto → "자동배정 (대기)"
 *   - assignMode='assignee' + 미배정    → "미배정 (생성자가 처리)"
 *   - assignMode='none'               → "처리 안 함"
 */
export function getProcessorDisplay(
  p: ProcessorInfo,
  creator: CreatorInfo,
  t: ReturnType<typeof useTranslations<'issue'>>,
): string {
  if (p.assignMode === 'none') return t('processorNone') || '처리 안 함'
  if (p.assignMode === 'agent' && p.agentName) return p.agentName
  if (p.assignMode === 'auto') return t('roleModeAutoAgent') || '자동 배정 (라운드로빈)'
  // assignee 모드 또는 fallback
  if (p.username) return p.name || p.username
  if (p.pendingAuto) return t('roleModeAuto')
  return `${t('roleModeCreator')} · ${creator.name || '-'}`
}

export function renderProcessorContent(
  p: ProcessorInfo,
  creator: CreatorInfo,
  dim: string,
  iconSize: string,
): React.ReactNode {
  // assignMode='none' → 처리 안 함 (ban)
  if (p.assignMode === 'none') {
    return <i className={`fa-solid fa-ban text-ive-text-dim ${iconSize}`} />
  }
  // 특정 에이전트
  if (p.assignMode === 'agent' && p.agentName) {
    return renderAvatar(p.agentAvatar, p.agentName, dim)
  }
  // 라운드로빈 (에이전트 자동)
  if (p.assignMode === 'auto') {
    return <i className={`fa-solid fa-shuffle text-ive-cyan ${iconSize}`} />
  }
  // assignee 모드 (담당자가 처리)
  if (p.username) {
    return renderAvatar(p.avatarUrl, p.name || p.username, dim)
  }
  // 레거시 자동배정 대기 플래그
  if (p.pendingAuto) {
    return <i className={`fa-solid fa-shuffle text-ive-cyan ${iconSize}`} />
  }
  // 어디에도 해당 안 되면 생성자 fallback (dimmed)
  return renderAvatar(creator.avatar || creator.avatarUrl, creator.name, dim, true)
}

function renderPlaceholder(dim: string, iconSize: string): React.ReactNode {
  return <i className={`fa-solid fa-user-plus text-ive-text-dim ${iconSize}`} />
}

export function renderPresetContent(preset: PresetRole, members: GitMember[], creator: CreatorInfo, dim: string, iconSize: string): React.ReactNode {
  if (preset.mode === 'auto') {
    return <i className={`fa-solid fa-shuffle text-ive-cyan ${iconSize}`} />
  }
  if (preset.mode === 'specific') {
    const m = preset.userId ? members.find(x => String(x.id) === preset.userId) : null
    if (m?.avatarUrl) {
      return <img src={m.avatarUrl} alt={m.username} className={`${dim} object-cover`} />
    }
    return <i className={`fa-solid fa-user text-ive-text-dim ${iconSize}`} />
  }
  // creator → placeholder (아직 도래하지 않음 / 미배정)
  return renderPlaceholder(dim, iconSize)
}

export function presetTooltip(
  roleName: string,
  preset: PresetRole,
  members: GitMember[],
  creator: CreatorInfo,
  t: ReturnType<typeof useTranslations<'issue'>>,
): string {
  if (preset.mode === 'auto') return t('roleTooltipFormat', { role: roleName, value: t('roleModeAuto') })
  if (preset.mode === 'specific') {
    const m = preset.userId ? members.find(x => String(x.id) === preset.userId) : null
    const value = m?.name || m?.username || preset.username || preset.userId || ''
    return t('roleTooltipFormat', { role: roleName, value })
  }
  return t('roleTooltipFormat', { role: roleName, value: t('roleModeCreator') })
}
