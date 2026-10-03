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
  type RoleAgentCandidate,
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
  // 유입(1) 은 IVE 라벨만 붙은 신규 이슈 상태(stage='none').
  // 'waiting' (IVE-S, 처리대기) 는 처리 macro 의 wait sub-stage 로 본다.
  none: 1,
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
  /** IVE-S 부착(처리대기 진입) 시각 — 1→2 커넥터 시작점 */
  scheduledAt: string | null
  firstDevStartedAt: string | null
  devStartedAt: string | null
  devEndedAt: string | null
  verifyStartedAt: string | null
  verifyEndedAt: string | null
  confirmedAt: string | null
}

/** 되돌림 — 칸(1 유입 … 5 완료) 사이를 뒤로 간 이동과 횟수 */
type RetryCounts = { from: number; to: number; count: number }[]
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
  /** 되돌림 — 검증 반려·확인 실패·재검증 요청·재오픈 등 뒤 칸으로 간 이동 (사람·에이전트 모두) */
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
    /** 확인자 후보 — 검증자(프로젝트 멤버)와 달리 provider 로 식별되는 모든 IVE 사용자. 미지정 시 gitMembers fallback. */
    confirmerMembers?: GitMember[]
    canEdit: boolean
    onProcessorClick?: () => void
    onVerifierChange?: (preset: PresetRole) => Promise<void> | void
    onConfirmerChange?: (preset: PresetRole) => Promise<void> | void
    /** 검증·확인을 맡길 수 있는 에이전트 (역할 명부) */
    verifierAgents?: RoleAgentCandidate[]
    confirmerAgents?: RoleAgentCandidate[]
  }
}

export default function StageProgress({ stage, createdAt, closedAt, stageTimes, retryCounts, forwardCounts, roles }: StageProgressProps) {
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const current = macroIndexFromStage(stage)
  const isDevFail = stage === 'dev_fail'

  // 단계별 시간 계산 — 칩(=stage 지속/경과)과 커넥터(=stage 사이 대기)
  // 진행 중일 때만 1초 타이머로 now 갱신 (현재 단계 경과시간 라이브 업데이트)
  const [now, setNow] = useState(() => Date.now())
  const isLive = current > 0 && current < 5 && stage !== 'done' && stage !== 'closed' && stage !== 'rejected' && stage !== 'dev_fail'
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
  //   1→2: scheduledAt → firstDevStartedAt (처리대기 진입 후 픽업까지) — 진행 중이면 elapsed
  //         stage='none'(IVE-S 미부착) 일 때는 시간 카운트 안 함.
  //   2→3: devEndedAt → verifyStartedAt (처리 완료 후 검증 대기) — 진행 중이면 elapsed
  //   3→4: 검증→확인은 시작 시각이 verifyEndedAt 과 동일 (대기 0)
  //   4→5: confirmedAt → closedAt
  const elapsedFrom = (t: string | null | undefined): number | null => t ? Math.max(0, now - new Date(t).getTime()) : null
  const waitDur: Record<number, number | null> = {
    // 처리대기 → 처리 픽업: scheduledAt 기준. stage='none' 이면 scheduledAt=null → 표시 안 함.
    1: stageTimes?.firstDevStartedAt
      ? ms(stageTimes.scheduledAt, stageTimes.firstDevStartedAt)
      : (stage === 'waiting' ? elapsedFrom(stageTimes?.scheduledAt) : null),
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
  // 되돌림 화살표 — 뒤 칸(source)에서 앞 칸(target)으로 간 이동마다 하나씩.
  //   예: 검증 반려 3→2, 유입 전환 3→1, 확인 실패(에이전트) 4→2, 재검증 요청 4→3, 재오픈 5→4
  // 정방향 ─→ 화살표와 비슷한 정도로 절제 — stroke 는 단일 dim gray.
  const ARROW_STROKE = '#6b7280'  // gray-500
  const fc = forwardCounts || { toProcess: 0, toVerify: 0, toConfirm: 0, toDone: 0 }
  const arrows = (retryCounts || [])
    .filter(m => m.count > 0 && m.to >= 1 && m.from <= 5 && m.to < m.from)
    .map(m => ({ sourceIdx: m.from, targetIdx: m.to, count: m.count }))
    // 짧은 화살표가 안쪽(낮은 줄), 긴 화살표가 바깥쪽(높은 줄)
    .sort((a, b) => (a.sourceIdx - a.targetIdx) - (b.sourceIdx - b.targetIdx) || a.targetIdx - b.targetIdx)
  const backInto = (idx: number) => arrows.reduce((n, a) => n + (a.targetIdx === idx ? a.count : 0), 0)
  // 칩별 진입 횟수 (정방향 + 되돌림 진입 합산). 처리(2)는 처리 실행 수가 이미 되돌림 뒤 재처리를 포함한다.
  const stageCount: Record<MacroIndex, number> = {
    0: 0,
    1: 0,
    2: fc.toProcess,
    3: fc.toVerify + backInto(3),
    4: fc.toConfirm + backInto(4),
    5: fc.toDone,
  }
  // 커넥터(정방향) 횟수.
  // 유입은 이슈 생성 시 1회 일어나는 이벤트라 1로 고정 (이후 처리 진입은 되돌림 화살표가 따로 표시).
  const connectorCount: Record<number, number> = {
    1: 1,
    2: fc.toVerify,
    3: fc.toConfirm,
    4: fc.toDone,
  }
  // 화살표가 가로로 겹치지 않도록 줄(높이)을 나눈다 — 두 화살표가 같은 칸 사이 간격을 지나면 다른 줄.
  // 같은 칸에서 나가거나 들어오는 화살표가 여럿이면 수직선도 8px 씩 어긋나게 한다.
  const { sourceShifts, targetShifts, yShifts } = (() => {
    const lanes: number[] = []
    const outN = new Map<number, number>()
    const inN = new Map<number, number>()
    const sx: number[] = [], tx: number[] = [], sy: number[] = []
    arrows.forEach((a, i) => {
      let lane = 0
      while (arrows.some((b, j) => j < i && lanes[j] === lane
        && Math.max(a.targetIdx, b.targetIdx) < Math.min(a.sourceIdx, b.sourceIdx))) lane++
      lanes.push(lane)
      const o = outN.get(a.sourceIdx) ?? 0; outN.set(a.sourceIdx, o + 1)
      const n = inN.get(a.targetIdx) ?? 0; inN.set(a.targetIdx, n + 1)
      sx.push(o * 8)
      tx.push(-n * 8)
      sy.push(lane * 16)
    })
    return { sourceShifts: sx, targetShifts: tx, yShifts: sy }
  })()
  const maxYShift = arrows.length > 0 ? Math.max(0, ...yShifts) : 0
  const overhead = arrows.length > 0 ? 24 + maxYShift : 0
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

  // 확인자 picker/표시 목록 — IVE 사용자 후보(미지정 시 프로젝트 멤버 fallback). 검증자는 항상 gitMembers.
  const confirmerList = roles?.confirmerMembers ?? roles?.gitMembers ?? []
  function initialPickFor(preset: PresetRole | undefined, members?: GitMember[]): GitMember | null {
    if (!roles || !preset) return null
    if (preset.mode === 'specific' && preset.userId) {
      return (members ?? roles.gitMembers).find(m => String(m.id) === preset.userId) || null
    }
    return null
  }
  async function confirmVerifier(pick: GitMember | null, auto: boolean, agentId?: string | null) {
    if (!roles) return
    let next: PresetRole
    if (agentId) next = { mode: 'agent', userId: null, username: null, agentId }
    else if (auto) next = { mode: 'auto', userId: null, username: null }
    else if (pick) next = { mode: 'specific', userId: String(pick.id), username: pick.username }
    else next = { mode: 'creator', userId: null, username: null }
    await roles.onVerifierChange?.(next)
    setVerifierModalOpen(false)
  }
  async function confirmConfirmer(pick: GitMember | null, auto: boolean, agentId?: string | null) {
    if (!roles) return
    let next: PresetRole
    if (agentId) next = { mode: 'agent', userId: null, username: null, agentId }
    else if (auto) next = { mode: 'auto', userId: null, username: null }
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
          : renderPresetContent(roles.confirmer, confirmerList, roles.creator, dim, iconSize),
        title: roles.actualConfirmer?.userId
          ? tIssue('roleTooltipFormat', { role: tIssue('confirmer'), value: roles.actualConfirmer.name || '-' })
          : presetTooltip(tIssue('confirmer'), roles.confirmer, confirmerList, roles.creator, tIssue),
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
              // 줄(yShifts)이 다른 화살표는 높이를 달리해 가로선이 겹치지 않는다.
              const ty = overhead - 14 - (yShifts[i] || 0)
              const by = overhead
              // 되돌림 화살표는 오른쪽 source pill → 왼쪽 target pill 로 향한다.
              // 한 pill 이 어떤 화살표의 source 이면서 다른 화살표의 target 일 때 수직선이 겹치지 않도록:
              //   - source 의 수직선은 pill 의 왼쪽 가장자리쪽 (-offset), 여럿이면 오른쪽으로 어긋남
              //   - target 의 수직선은 pill 의 오른쪽 가장자리쪽 (+offset), 여럿이면 왼쪽으로 어긋남
              const offset = 9
              const sx = sxCenter - offset + (sourceShifts[i] || 0)
              const txEnd = txCenter + offset + (targetShifts[i] || 0)
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

          // dev_fail 상태: 처리 단계(macro 2)에서 에러 발생 — 빨간색 강조
          const isError = isDevFail && m.idx === 2

          // 가본 적 있는 단계 — 현재보다 앞에 있지만 재실행 등으로 한 번 이상 도달했던 경우.
          // (이미 지나간 단계 isPast 와 별개로, 미래 idx 인데 흔적이 남아 있는 단계만 별색 처리)
          const visitedAhead = !isCurrent && !isPast && !isError && (
            (m.idx === 2 && !!stageTimes?.devStartedAt)
            || (m.idx === 3 && (arrows.some(a => a.sourceIdx === 3) || !!stageTimes?.verifyStartedAt))
            || (m.idx === 4 && (arrows.some(a => a.sourceIdx === 4) || !!stageTimes?.confirmedAt))
            || (m.idx === 5 && arrows.some(a => a.sourceIdx === 5))
          )

          let chipCls = ''
          if (isError) chipCls = 'bg-ive-red/15 text-ive-red border-ive-red/40 ring-1 ring-ive-red/20'
          else if (isCurrent) chipCls = 'bg-ive-amber/15 text-ive-amber border-ive-amber/40 ring-1 ring-ive-amber/20'
          else if (isPast) chipCls = 'bg-ive-green/10 text-ive-green/70 border-ive-green/20'
          else if (visitedAhead) chipCls = 'bg-ive-cyan/5 text-ive-cyan/30 border-ive-cyan/15'
          else chipCls = 'bg-white/[0.02] text-ive-text-dim border-ive-border-subtle'

          // 커넥터 (이 pill 직전 화살표) 상태:
          //   - incoming: 현재 stage 가 waiting 이고 도착 macro 가 이 pill — 이동 중. amber + 애니메이션.
          //   - past: 이미 통과한 화살표 (m.idx < current 또는 active sub-stage 의 m.idx === current)
          //   - visitedAhead: 가본 적 있는 단계로 향함
          //   - error: dev_fail 상태일 때 처리 단계로 향하는 커넥터 — 빨간색
          //   - else: 미방문
          const connectorIncoming = m.idx === current && isWaitingSubstate
          const connectorPast = (m.idx < current) || (m.idx === current && !isWaitingSubstate && current > 0)
          const connectorError = isError && m.idx === 2
          const connectorCls = connectorError ? 'bg-ive-red/50'
            : connectorIncoming ? 'bg-ive-amber/70 animate-pulse'
            : connectorPast ? 'bg-ive-green/40'
            : visitedAhead ? 'bg-ive-cyan/15'
            : 'bg-ive-border-subtle'
          const arrowCls = connectorError ? 'border-l-ive-red/50'
            : connectorIncoming ? 'border-l-ive-amber/70 animate-pulse'
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
                       className={`flex-1 ${connectorIncoming || connectorError ? 'animate-pulse' : ''}`}
                       style={connectorIncoming ? { height: '2px', backgroundColor: 'rgba(245, 158, 11, 0.75)' } : connectorError ? { height: '2px', backgroundColor: 'rgba(239, 68, 68, 0.5)' } : undefined}
                     >
                       {!connectorIncoming && !connectorError && <div className={`h-0.5 w-full ${connectorCls}`} />}
                       {connectorError && <div className={`h-0.5 w-full ${connectorCls}`} />}
                     </div>
                     <div
                       className={`w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] ${connectorIncoming || connectorError ? 'animate-pulse' : arrowCls}`}
                       style={connectorIncoming ? { borderLeftColor: 'rgba(245, 158, 11, 0.95)' } : connectorError ? { borderLeftColor: 'rgba(239, 68, 68, 0.5)' } : undefined}
                     />
                   </div>
                   <span className="hidden sm:block text-[9px] mt-1 leading-none text-ive-text-dim truncate w-full text-center">{waitLabel ?? ''}</span>
                 </div>
               )}
              <div className="flex flex-col items-center shrink-0" ref={el => { pillRefs.current[m.idx] = el }}>
               <div
                 className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 h-7 rounded-lg border text-[11px] font-bold transition-all ${chipCls}`}
                 title={!showAvatar ? m.label : undefined}
               >
                 {isError ? (
                   <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-lg text-[10px] bg-ive-red/15 ring-2 ring-ive-red/40">
                     <i className="fa-solid fa-circle-xmark text-ive-red" />
                   </span>
                 ) : showAvatar ? (
                   slot.clickable && slot.onClick ? (
                     <button
                       type="button"
                       onClick={slot.onClick}
                       title={slot.title}
                       aria-label={slot.title}
                       className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-lg overflow-hidden bg-ive-bg-deep ${avatarRing} hover:ring-ive-green transition-all`}
                     >
                       {slot.node}
                     </button>
                   ) : (
                     <span
                       title={slot.title}
                       aria-label={slot.title}
                       className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-lg overflow-hidden bg-ive-bg-deep ${avatarRing} hover:ring-ive-green transition-all`}
                     >
                       {slot.node}
                     </span>
                   )
                 ) : (
                  <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-lg text-[10px] ring-2 ${
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
            agents={roles.verifierAgents}
            initialAgentId={roles.verifier.mode === 'agent' ? (roles.verifier.agentId ?? null) : null}
            onConfirm={confirmVerifier}
            title={tIssue('verifier')}
            noneLabel={tIssue('roleModeCreator')}
          />
          <AssigneePickerModal
            open={confirmerModalOpen}
            onClose={() => setConfirmerModalOpen(false)}
            gitMembers={confirmerList}
            initialPick={initialPickFor(roles.confirmer, confirmerList)}
            initialAuto={roles.confirmer.mode === 'auto'}
            withAuto
            agents={roles.confirmerAgents}
            initialAgentId={roles.confirmer.mode === 'agent' ? (roles.confirmer.agentId ?? null) : null}
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
