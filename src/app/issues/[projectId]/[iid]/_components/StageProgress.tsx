'use client'

import { Fragment, useState, useEffect, useRef, useLayoutEffect } from 'react'
import { useTranslations } from 'next-intl'
import { formatDateShort } from '@/lib/format-date'
import { useStore } from '@/lib/store'
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
  // 'waiting' (IVE-S, 처리대기) 는 처리 macro 의 wait sub-stage 로 본다.
  // 유입(1) 은 IVE 라벨이 아직 붙지 않은 신규 이슈 상태(stage='none')에 해당.
  waiting: 2,
  dev: 2, dev_fail: 2,
  verify_waiting: 3, verifying: 3,
  confirm_waiting: 4, confirming: 4,
  done: 5, closed: 5,
}

export function macroIndexFromStage(stage: string | null | undefined): MacroIndex {
  if (!stage) return 0
  return STAGE_TO_MACRO[stage] ?? 0
}

interface StageTimes {
  firstDevStartedAt: string | null
  devStartedAt: string | null
  devEndedAt: string | null
  verifyStartedAt: string | null
  verifyEndedAt: string | null
  confirmedAt: string | null
}

interface RetryCounts {
  fromVerify: number
  fromConfirm: number
  fromDone: number
}
interface ForwardCounts {
  toProcess: number
  toVerify: number
  toConfirm: number
  toDone: number
}

interface StageProgressProps {
  stage: string
  /** 이슈 생성 시각 — 유입 단계 시작점 */
  createdAt?: string | null
  /** 이슈 종료 시각 — 완료 단계 도달점 */
  closedAt?: string | null
  /** 단계별 타임스탬프 — 마지막 execution 기준 */
  stageTimes?: StageTimes | null
  /** 재실행 횟수 — 검증/확인/완료에서 처리로 되돌아간 횟수 */
  retryCounts?: RetryCounts | null
  /** 정방향 진입 횟수 — 각 단계로 들어간 횟수 */
  forwardCounts?: ForwardCounts | null
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

export default function StageProgress({ stage, createdAt, closedAt, stageTimes, retryCounts, forwardCounts, roles }: StageProgressProps) {
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const current = macroIndexFromStage(stage)

  // 단계별 시간 계산 — 칩(=stage 지속/경과)과 커넥터(=stage 사이 대기)
  // 진행 중일 때만 1초 타이머로 now 갱신 (현재 단계 경과시간 라이브 업데이트)
  const [now, setNow] = useState(() => Date.now())
  const isLive = current > 0 && current < 5 && stage !== 'done' && stage !== 'closed' && stage !== 'rejected'
  useEffect(() => {
    if (!isLive) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isLive])
  const ms = (a: string | null | undefined, b: string | null | undefined): number | null => {
    if (!a || !b) return null
    const d = new Date(b).getTime() - new Date(a).getTime()
    return d > 0 ? d : null
  }
  const isClosed = stage === 'closed' || stage === 'done'
  const stageEnd = isClosed && closedAt ? new Date(closedAt).getTime() : now
  // 칩 표시 시간 — 유입은 "이벤트"라 표시 안 함 (대기시간은 1→2 커넥터에)
  // 처리/검증/확인: 지나간 단계 = 수행시간, 현재 단계 = 경과시간
  const stageDur: Record<MacroIndex, number | null> = {
    0: null,
    1: null,
    2: stageTimes?.devStartedAt ? (current === 2 ? stageEnd - new Date(stageTimes.devStartedAt).getTime() : ms(stageTimes.devStartedAt, stageTimes?.devEndedAt)) : null,
    3: stageTimes?.verifyStartedAt ? (current === 3 ? stageEnd - new Date(stageTimes.verifyStartedAt).getTime() : ms(stageTimes.verifyStartedAt, stageTimes?.verifyEndedAt)) : null,
    4: stageTimes?.verifyEndedAt ? (current === 4 ? stageEnd - new Date(stageTimes.verifyEndedAt).getTime() : ms(stageTimes.verifyEndedAt, stageTimes?.confirmedAt)) : null,
    5: null,
  }
  // 커넥터 대기시간 (i 번째 → i+1 번째 사이)
  //   1→2: createdAt → devStartedAt (유입 후 에이전트 픽업 대기) — 진행 중이면 elapsed
  //   2→3: devEndedAt → verifyStartedAt (처리 완료 후 검증 대기) — 진행 중이면 elapsed
  //   3→4: 검증→확인은 시작 시각이 verifyEndedAt 과 동일 (대기 0)
  //   4→5: confirmedAt → closedAt
  const elapsedFrom = (t: string | null | undefined): number | null => t ? Math.max(0, now - new Date(t).getTime()) : null
  const waitDur: Record<number, number | null> = {
    // 유입 → 처리 대기는 "처음 유입된 후 첫 픽업까지" — 재처리 대기를 더하면 안 됨.
    1: stageTimes?.firstDevStartedAt
      ? ms(createdAt, stageTimes.firstDevStartedAt)
      : (current === 1 ? elapsedFrom(createdAt) : null),
    2: stageTimes?.verifyStartedAt
      ? ms(stageTimes?.devEndedAt, stageTimes.verifyStartedAt)
      : (stage === 'verify_waiting' ? elapsedFrom(stageTimes?.devEndedAt) : null),
    3: null,
    4: ms(stageTimes?.confirmedAt, closedAt),
  }

  // 검증자/확인자 모달 — 로컬 AssigneePickerModal 통일 사용
  const [verifierModalOpen, setVerifierModalOpen] = useState(false)
  const [confirmerModalOpen, setConfirmerModalOpen] = useState(false)

  // 재실행 화살표 — 단계별 picker 위에 SVG 로 오버레이
  const containerRef = useRef<HTMLDivElement>(null)
  const pillRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const [pillCenters, setPillCenters] = useState<Record<number, number>>({})
  // 재실행 화살표 — 각 step-back 은 이전 macro 의 waiting 상태로 보낸다.
  //   - 검증 reject → 스케줄(처리 재요청): macro 3 → macro 1 (유입)
  //   - 확인 return_to_dev → 검증대기 (검증 재요청): macro 4 → macro 3
  //   - 완료 reopen → 확인대기 (확인 재요청): macro 5 → macro 4
  // 재실행 화살표는 정방향 ─→ 화살표와 비슷한 정도로 절제. 색상은 라벨 식별용으로만
  // 살짝 톤만 다르게 두고, stroke 자체는 단일 dim gray 로 통일.
  const ARROW_STROKE = '#6b7280'  // gray-500
  const arrows: { sourceIdx: number; targetIdx: number; count: number; color: string }[] = []
  const rc = retryCounts || { fromVerify: 0, fromConfirm: 0, fromDone: 0 }
  const fc = forwardCounts || { toProcess: 0, toVerify: 0, toConfirm: 0, toDone: 0 }
  // 칩별 진입 횟수 (정방향 + step-back 진입 모두 합산)
  const stageCount: Record<MacroIndex, number> = {
    0: 0,
    1: 0,
    2: fc.toProcess,
    3: fc.toVerify + rc.fromConfirm,
    4: fc.toConfirm + rc.fromDone,
    5: fc.toDone,
  }
  // 커넥터(정방향) 횟수.
  // 유입은 이슈 생성 시 1회 일어나는 이벤트라 1로 고정 (이후 처리 진입은 step-back 화살표가 따로 표시).
  const connectorCount: Record<number, number> = {
    1: 1,
    2: fc.toVerify,
    3: fc.toConfirm,
    4: fc.toDone,
  }
  if (rc.fromVerify > 0) arrows.push({ sourceIdx: 3, targetIdx: 2, count: rc.fromVerify, color: '#fbbf24' })
  if (rc.fromConfirm > 0) arrows.push({ sourceIdx: 4, targetIdx: 3, count: rc.fromConfirm, color: '#fb923c' })
  if (rc.fromDone > 0) arrows.push({ sourceIdx: 5, targetIdx: 4, count: rc.fromDone, color: '#f87171' })
  const overhead = arrows.length > 0 ? 24 : 0
  useLayoutEffect(() => {
    if (!containerRef.current || arrows.length === 0) return
    const measure = () => {
      if (!containerRef.current) return
      const baseLeft = containerRef.current.getBoundingClientRect().left
      const next: Record<number, number> = {}
      Object.entries(pillRefs.current).forEach(([k, el]) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        next[Number(k)] = r.left + r.width / 2 - baseLeft
      })
      setPillCenters(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [arrows.length])

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
      <div className="relative" ref={containerRef} style={{ paddingTop: overhead }}>
        {overhead > 0 && (
          <svg className="absolute left-0 top-0 pointer-events-none" width="100%" height={overhead} style={{ overflow: 'visible' }}>
            <defs>
              {arrows.map((_, i) => (
                <marker key={i} id={`stage-retry-arrow-${i}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill={ARROW_STROKE} />
                </marker>
              ))}
            </defs>
            {arrows.map((a, i) => {
              const sxCenter = pillCenters[a.sourceIdx]
              const txCenter = pillCenters[a.targetIdx]
              if (sxCenter == null || txCenter == null) return null
              // 모든 step-back 화살표가 자기 source/target gap 안에 머물러 겹치지 않으므로
              // 모두 같은 높이로 그려도 무방.
              const ty = overhead - 14
              const by = overhead
              // 모든 step-back 화살표는 오른쪽 source pill → 왼쪽 target pill 로 향한다.
              // 인접한 두 pill(예: 검증) 이 한 화살표의 source 이면서 다른 화살표의 target 일 때
              // 같은 자리에 수직선이 겹치지 않도록, 수직선을 다음과 같이 배치:
              //   - source(오른쪽 pill) 의 수직선은 pill 의 왼쪽 가장자리쪽 (-offset)  → 가로선이 가까운 gap 안에서 출발
              //   - target(왼쪽 pill) 의 수직선은 pill 의 오른쪽 가장자리쪽 (+offset) → 같은 gap 안에 도착
              // → 각 화살표가 자기 source/target 사이의 gap 안에 머물러 인접 화살표와 겹치지 않는다.
              const offset = 9
              const sx = sxCenter - offset
              const txEnd = txCenter + offset
              // 모서리를 라운딩한 꺾은선 (╭──╮) — source 가 항상 처리 오른쪽이라 좌측 진행
              const r = 5
              const dir = sx > txEnd ? -1 : 1   // 가로선 진행 방향
              const path = `M ${sx} ${by} L ${sx} ${ty + r} Q ${sx} ${ty} ${sx + dir * r} ${ty} L ${txEnd - dir * r} ${ty} Q ${txEnd} ${ty} ${txEnd} ${ty + r} L ${txEnd} ${by}`
              return (
                <g key={i} opacity="0.55">
                  <path d={path} stroke={ARROW_STROKE} strokeWidth="1.2" fill="none" strokeLinejoin="round" strokeLinecap="round" markerEnd={`url(#stage-retry-arrow-${i})`} />
                  <text x={(sx + txEnd) / 2} y={ty - 3} textAnchor="middle" fontSize="10" fontWeight="700" fill={ARROW_STROKE}>{a.count}회</text>
                </g>
              )
            })}
          </svg>
        )}
      <div className="flex items-start min-w-0">
        {macros.map((m, i) => {
          // waiting sub-state (처리대기/검증대기/확인대기) 는 아직 macro 에 진입한 게 아니다.
          // 도착 macro pill 은 dim 으로 두고, 직전 → 화살표를 amber + 애니메이션으로 강조.
          const isWaitingSubstate = stage === 'waiting' || stage === 'verify_waiting' || stage === 'confirm_waiting'
          const isCurrent = m.idx === current && !isWaitingSubstate
          const isPast = current > 0 && m.idx < current

          // 가본 적 있는 단계 — 현재보다 앞에 있지만 재실행 등으로 한 번 이상 도달했던 경우.
          // (이미 지나간 단계 isPast 와 별개로, 미래 idx 인데 흔적이 남아 있는 단계만 별색 처리)
          const visitedAhead = !isCurrent && !isPast && (
            (m.idx === 2 && !!stageTimes?.devStartedAt)
            || (m.idx === 3 && (rc.fromVerify > 0 || !!stageTimes?.verifyStartedAt))
            || (m.idx === 4 && (rc.fromConfirm > 0 || !!stageTimes?.confirmedAt))
            || (m.idx === 5 && rc.fromDone > 0)
          )

          let chipCls = ''
          if (isCurrent) chipCls = 'bg-ive-amber/15 text-ive-amber border-ive-amber/40 ring-1 ring-ive-amber/20'
          else if (isPast) chipCls = 'bg-ive-green/10 text-ive-green/70 border-ive-green/20'
          else if (visitedAhead) chipCls = 'bg-ive-cyan/5 text-ive-cyan/30 border-ive-cyan/15'
          else chipCls = 'bg-white/[0.02] text-ive-text-dim border-ive-border-subtle'

          // 커넥터 (이 pill 직전 화살표) 상태:
          //   - incoming: 현재 stage 가 waiting 이고 도착 macro 가 이 pill — 이동 중. amber + 애니메이션.
          //   - past: 이미 통과한 화살표 (m.idx < current 또는 active sub-stage 의 m.idx === current)
          //   - visitedAhead: 가본 적 있는 단계로 향함
          //   - else: 미방문
          const connectorIncoming = m.idx === current && isWaitingSubstate
          const connectorPast = (m.idx < current) || (m.idx === current && !isWaitingSubstate && current > 0)
          const connectorCls = connectorIncoming ? 'bg-ive-amber/70 animate-pulse'
            : connectorPast ? 'bg-ive-green/40'
            : visitedAhead ? 'bg-ive-cyan/15'
            : 'bg-ive-border-subtle'
          const arrowCls = connectorIncoming ? 'border-l-ive-amber/70 animate-pulse'
            : connectorPast ? 'border-l-ive-green/40'
            : visitedAhead ? 'border-l-ive-cyan/15'
            : 'border-l-ive-border-subtle'

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
          // 아직 도달하지 않은 단계 — 한 번도 가보지 않은 미래의 단계는 아바타도 흐리게
          const unreached = !isCurrent && !isPast && !visitedAhead
          const avatarRing = `ring-2 ${slot.ringCls} ${isInProgress ? 'animate-pulse' : ''} ${unreached ? 'opacity-40' : ''}`

          // 유입(1) 칩 하단: 이슈 생성 일시
          // 완료(5) 칩 하단: 완료 상태(current=5)일 때만 완료 일시 표시 (우측 정렬)
          //   완료 일시 우선순위: closedAt(이슈 close 됨) → confirmedAt(마지막 accept 시각, fallback)
          const isCompleted = current === 5
          const completionTime = closedAt || stageTimes?.confirmedAt || null
          let stageLabel: string | null
          if (m.idx === 1 && createdAt) {
            stageLabel = formatDateShort(createdAt, userLocale, userTz)
          } else if (m.idx === 5 && isCompleted && completionTime) {
            stageLabel = formatDateShort(completionTime, userLocale, userTz)
          } else {
            stageLabel = withCount(formatDur(stageDur[m.idx]), stageCount[m.idx])
          }
          const stageLabelAlign = m.idx === 5 ? 'text-right self-end' : 'text-center'
          const waitLabel = i > 0 ? withCount(formatDur(waitDur[i]), connectorCount[i]) : null

          return (
            <Fragment key={m.idx}>
              {i > 0 && (
                <div className="flex-1 min-w-3 flex flex-col items-center pt-[10px]">
                  <div className="w-full flex items-center">
                    <div
                      className={`flex-1 ${connectorIncoming ? 'animate-pulse' : ''}`}
                      style={connectorIncoming ? { height: '2px', backgroundColor: 'rgba(245, 158, 11, 0.75)' } : undefined}
                    >
                      {!connectorIncoming && <div className={`h-0.5 w-full ${connectorCls}`} />}
                    </div>
                    <div
                      className={`w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] ${connectorIncoming ? 'animate-pulse' : arrowCls}`}
                      style={connectorIncoming ? { borderLeftColor: 'rgba(245, 158, 11, 0.95)' } : undefined}
                    />
                  </div>
                  <span className="hidden sm:block text-[9px] mt-1 leading-none text-ive-text-dim truncate w-full text-center">{waitLabel ?? ''}</span>
                </div>
              )}
              <div className="flex flex-col items-center shrink-0" ref={el => { pillRefs.current[m.idx] = el }}>
              <div
                className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 h-7 rounded-full border text-[11px] font-bold transition-all ${chipCls}`}
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
              <span className={`text-[9px] mt-1 leading-none text-ive-text-dim h-3 whitespace-nowrap ${stageLabelAlign}`}>{stageLabel ?? ''}</span>
              </div>
            </Fragment>
          )
        })}
      </div>
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

/** 시간 + 횟수 라벨 합치기. count > 1 일 때만 "·N회" 부착. */
function withCount(time: string | null, count: number): string | null {
  if (!time && count <= 1) return time
  if (!time && count > 1) return `${count}회`
  if (count > 1) return `${time} · ${count}회`
  return time
}

/** ms 를 짧은 단위(초/분/시간/일)로 포맷. null/0 이하면 null. */
function formatDur(ms: number | null): string | null {
  if (ms == null || ms <= 0) return null
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분`
  const hour = Math.floor(min / 60)
  const remMin = min % 60
  if (hour < 24) return remMin ? `${hour}시간 ${remMin}분` : `${hour}시간`
  const day = Math.floor(hour / 24)
  const remHour = hour % 24
  return remHour ? `${day}일 ${remHour}시간` : `${day}일`
}
