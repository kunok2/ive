'use client'

import { Fragment, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  type CreatorInfo,
  type ProcessorInfo,
  type GitMember,
  type PresetRole,
  type ActualProcessor,
  type ActualPerson,
  renderAvatar,
  renderProcessorContent,
  renderPresetContent,
  getProcessorDisplay,
  presetTooltip,
} from '@/components/issue/RoleAvatarBar'
import AssigneePickerModal from './AssigneePickerModal'

/**
 * 5단계 워크플로우 진행 막대 — 단계별 담당자 아바타와 단계 라벨을 한 줄로 표시.
 *   유입(생성자) → 처리(처리자) → 검증(검증자) → 확인(확인자) → 완료
 */
type MacroIndex = 0 | 1 | 2 | 3 | 4 | 5

const STAGE_TO_MACRO: Record<string, MacroIndex> = {
  waiting: 1,
  dev: 2, dev_fail: 2,
  verify_waiting: 3, verifying: 3,
  confirm_waiting: 4, confirming: 4,
  done: 5, closed: 5,
}

export function macroIndexFromStage(stage: string | null | undefined): MacroIndex {
  if (!stage) return 0
  return STAGE_TO_MACRO[stage] ?? 0
}

interface StageProgressProps {
  stage: string
  /** 역할 데이터 — 제공 시 각 칩에 담당자 아바타 표시 */
  roles?: {
    creator: CreatorInfo
    processor: ProcessorInfo
    verifier: PresetRole
    confirmer: PresetRole
    actualProcessor?: ActualProcessor | null
    actualVerifier?: ActualPerson | null
    actualConfirmer?: ActualPerson | null
    gitMembers: GitMember[]
    canEdit: boolean
    onProcessorClick?: () => void
    onVerifierChange?: (preset: PresetRole) => Promise<void> | void
    onConfirmerChange?: (preset: PresetRole) => Promise<void> | void
  }
}

export default function StageProgress({ stage, roles }: StageProgressProps) {
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')
  const current = macroIndexFromStage(stage)

  // 검증자/확인자 모달 — 로컬 AssigneePickerModal 통일 사용
  const [verifierModalOpen, setVerifierModalOpen] = useState(false)
  const [confirmerModalOpen, setConfirmerModalOpen] = useState(false)

  function initialPickFor(preset: PresetRole | undefined): GitMember | null {
    if (!roles || !preset) return null
    if (preset.mode === 'specific' && preset.userId) {
      return roles.gitMembers.find(m => String(m.id) === preset.userId) || null
    }
    return null
  }
  async function confirmVerifier(pick: GitMember | null, auto: boolean) {
    if (!roles) return
    let next: PresetRole
    if (auto) next = { mode: 'auto', userId: null, username: null }
    else if (pick) next = { mode: 'specific', userId: String(pick.id), username: pick.username }
    else next = { mode: 'creator', userId: null, username: null }
    await roles.onVerifierChange?.(next)
    setVerifierModalOpen(false)
  }
  async function confirmConfirmer(pick: GitMember | null, auto: boolean) {
    if (!roles) return
    let next: PresetRole
    if (auto) next = { mode: 'auto', userId: null, username: null }
    else if (pick) next = { mode: 'specific', userId: String(pick.id), username: pick.username }
    else next = { mode: 'creator', userId: null, username: null }
    await roles.onConfirmerChange?.(next)
    setConfirmerModalOpen(false)
  }

  const macros: { idx: MacroIndex; label: string }[] = [
    { idx: 1, label: tStage('macroInflow') },
    { idx: 2, label: tStage('macroProcess') },
    { idx: 3, label: tStage('macroVerify') },
    { idx: 4, label: tStage('macroConfirm') },
    { idx: 5, label: tStage('macroComplete') },
  ]

  // macro 인덱스별 칩의 아바타 슬롯 렌더 — roles 가 있을 때만
  function renderRoleSlot(idx: MacroIndex): { node: React.ReactNode; title: string; clickable: boolean; onClick?: () => void; ringCls: string } {
    const dim = 'w-[18px] h-[18px]'
    const iconSize = 'text-[9px]'
    if (!roles) {
      return { node: null, title: '', clickable: false, ringCls: '' }
    }
    if (idx === 1) {
      return {
        node: renderAvatar(roles.creator.avatar || roles.creator.avatarUrl, roles.creator.name, dim),
        title: tIssue('roleTooltipFormat', { role: tIssue('roleAuthor'), value: roles.creator.name || '-' }),
        clickable: false,
        ringCls: 'ring-ive-green/40',
      }
    }
    // 단계 진행에 따른 게이팅: 이미 지나간 단계(m.idx < current)는 편집 불가
    const stageEditable = roles.canEdit && idx >= current
    if (idx === 2) {
      return {
        node: roles.actualProcessor?.agentName
          ? renderAvatar(roles.actualProcessor.agentAvatar, roles.actualProcessor.agentName, dim)
          : renderProcessorContent(roles.processor, roles.creator, dim, iconSize),
        title: tIssue('roleTooltipFormat', {
          role: tIssue('processor'),
          value: roles.actualProcessor?.agentName ?? getProcessorDisplay(roles.processor, roles.creator, tIssue),
        }),
        clickable: stageEditable && !!roles.onProcessorClick,
        onClick: roles.onProcessorClick,
        ringCls: 'ring-ive-cyan/40',
      }
    }
    if (idx === 3) {
      return {
        node: roles.actualVerifier?.userId
          ? renderAvatar(roles.actualVerifier.avatar, roles.actualVerifier.name, dim)
          : renderPresetContent(roles.verifier, roles.gitMembers, roles.creator, dim, iconSize),
        title: roles.actualVerifier?.userId
          ? tIssue('roleTooltipFormat', { role: tIssue('verifier'), value: roles.actualVerifier.name || '-' })
          : presetTooltip(tIssue('verifier'), roles.verifier, roles.gitMembers, roles.creator, tIssue),
        clickable: stageEditable,
        onClick: () => setVerifierModalOpen(true),
        ringCls: 'ring-ive-amber/40',
      }
    }
    if (idx === 4) {
      return {
        node: roles.actualConfirmer?.userId
          ? renderAvatar(roles.actualConfirmer.avatar, roles.actualConfirmer.name, dim)
          : renderPresetContent(roles.confirmer, roles.gitMembers, roles.creator, dim, iconSize),
        title: roles.actualConfirmer?.userId
          ? tIssue('roleTooltipFormat', { role: tIssue('confirmer'), value: roles.actualConfirmer.name || '-' })
          : presetTooltip(tIssue('confirmer'), roles.confirmer, roles.gitMembers, roles.creator, tIssue),
        clickable: stageEditable,
        onClick: () => setConfirmerModalOpen(true),
        ringCls: 'ring-orange-400/50',
      }
    }
    // idx === 5 → 완료: 아이콘만
    return { node: null, title: '', clickable: false, ringCls: '' }
  }

  return (
    <>
      <div className="flex items-center min-w-0">
        {macros.map((m, i) => {
          const isCurrent = m.idx === current
          const isPast = current > 0 && m.idx < current

          let chipCls = ''
          if (isCurrent) chipCls = 'bg-ive-amber/15 text-ive-amber border-ive-amber/40 ring-1 ring-ive-amber/20'
          else if (isPast) chipCls = 'bg-ive-green/10 text-ive-green/70 border-ive-green/20'
          else chipCls = 'bg-white/[0.02] text-ive-text-dim border-ive-border-subtle'

          const connectorActive = current > 0 && m.idx <= current
          const connectorCls = connectorActive ? 'bg-ive-green/40' : 'bg-ive-border-subtle'

          const slot = renderRoleSlot(m.idx)
          const showAvatar = roles && m.idx < 5
          // 진행 중 단계 — 현재 stage 와 macro idx 가 일치하고 작업이 진행 중인 sub-stage 일 때 pulse
          //   dev: 처리자(agent) 가 코드 작성 중
          //   verifying: 검증자가 검증 중
          //   confirming: 확인자가 확인 중
          const isInProgress = !!roles && isCurrent && (
            (m.idx === 2 && stage === 'dev')
            || (m.idx === 3 && stage === 'verifying')
            || (m.idx === 4 && stage === 'confirming')
          )
          const avatarRing = `ring-2 ${slot.ringCls} ${isInProgress ? 'animate-pulse' : ''}`

          return (
            <Fragment key={m.idx}>
              {i > 0 && <div className={`h-px flex-1 min-w-3 mx-1.5 ${connectorCls}`} />}
              <div
                className={`shrink-0 inline-flex items-center gap-1.5 pl-1 pr-2.5 h-7 rounded-full border text-[11px] font-bold transition-all ${chipCls}`}
                title={!showAvatar ? m.label : undefined}
              >
                {showAvatar ? (
                  slot.clickable && slot.onClick ? (
                    <button
                      type="button"
                      onClick={slot.onClick}
                      title={slot.title}
                      aria-label={slot.title}
                      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full overflow-hidden bg-ive-bg-deep ${avatarRing} hover:ring-ive-green transition-all`}
                    >
                      {slot.node}
                    </button>
                  ) : (
                    <span
                      title={slot.title}
                      aria-label={slot.title}
                      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full overflow-hidden bg-ive-bg-deep ${avatarRing} hover:ring-ive-green transition-all`}
                    >
                      {slot.node}
                    </span>
                  )
                ) : (
                  <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[10px] ring-2 ${
                    isPast || isCurrent ? 'bg-ive-green/15 ring-ive-green/40 text-ive-green' : 'bg-white/5 ring-ive-border-subtle text-ive-text-dim'
                  }`}>
                    <i className="fa-solid fa-flag-checkered" />
                  </span>
                )}
                <span>{m.label}</span>
              </div>
            </Fragment>
          )
        })}
      </div>

      {roles && (
        <>
          <AssigneePickerModal
            open={verifierModalOpen}
            onClose={() => setVerifierModalOpen(false)}
            gitMembers={roles.gitMembers}
            initialPick={initialPickFor(roles.verifier)}
            initialAuto={roles.verifier.mode === 'auto'}
            withAuto
            onConfirm={confirmVerifier}
            title={tIssue('verifier')}
            noneLabel={tIssue('roleModeCreator')}
          />
          <AssigneePickerModal
            open={confirmerModalOpen}
            onClose={() => setConfirmerModalOpen(false)}
            gitMembers={roles.gitMembers}
            initialPick={initialPickFor(roles.confirmer)}
            initialAuto={roles.confirmer.mode === 'auto'}
            withAuto
            onConfirm={confirmConfirmer}
            title={tIssue('confirmer')}
            noneLabel={tIssue('roleModeCreator')}
          />
        </>
      )}
    </>
  )
}
