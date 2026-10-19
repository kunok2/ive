'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import AgentAvatar from '@/components/agent/AgentAvatar'
import CliLogo from '@/components/ui/CliLogo'
import { useTranslations } from 'next-intl'
import { CLI_CONFIG } from './types'
import type { ProjectAgent } from './types'
import { isAgentAvailableNow } from '@/types'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

interface AgentPickerModalProps {
  iid: number | null
  /** 제목 — 없으면 「#번호 처리 담당」. 일괄(여러 작업)일 때 넘긴다 */
  title?: string
  /** 현재 이슈의 assignMode (없으면 'auto'). null 이면 현재 표시 없음 — 일괄은 작업마다 달라 하나로 표시할 수 없다 */
  currentMode?: 'auto' | 'assignee' | 'agent' | null
  /** 현재 지정된 에이전트 id (없으면 null) */
  currentAgentId?: string | null
  /** 현재 지정된 git 담당자 id 목록 (사람 직접 지정 표시용) */
  currentAssigneeIds?: number[]
  projectAgents: ProjectAgent[]
  /** Git 멤버 목록 — 담당자(사람) 직접 처리 옵션. 빈 배열이면 멤버 옵션 미노출. */
  gitMembers?: GitMember[]
  saving: boolean
  /**
   * 선택 결과 콜백.
   *   - mode='auto'    : assignMode='auto', agentId=null
   *   - mode='agent'   : assignMode='agent', agentId=<선택된 에이전트>
   *   - mode='assignee': assignMode='assignee'. assignee 가 있으면 그 git 멤버를 이슈의 담당자로도 설정.
   */
  onSelect: (
    iid: number,
    mode: 'auto' | 'assignee' | 'agent',
    agentId: string | null,
    assignee?: GitMember | null,
  ) => void
  onClose: () => void
}

/**
 * 처리자(처리할 주체) picker.
 *   - AI 에이전트(특정/자동) 또는 사람(담당자) 중에서 선택.
 *   - 클릭 시 즉시 onSelect 호출 (모달 닫힘은 호출 측에서 처리).
 */
export default function AgentPickerModal({
  iid,
  title,
  currentMode = 'auto',
  currentAgentId = null,
  currentAssigneeIds = [],
  projectAgents,
  gitMembers = [],
  saving,
  onSelect,
  onClose,
}: AgentPickerModalProps) {
  const tIssue = useTranslations('issue')

  const effectiveMode = currentMode === null ? null : (currentMode || 'auto')
  const assigneeIdSet = new Set(currentAssigneeIds)

  const [search, setSearch] = useState('')

  // 모달이 새로 열릴 때마다 검색어 초기화
  useEffect(() => { if (iid !== null) setSearch('') }, [iid])

  const q = search.trim().toLowerCase()
  const filteredAgents = q
    ? projectAgents.filter(pa => pa.agent.name.toLowerCase().includes(q))
    : projectAgents
  const filteredMembers = q
    ? gitMembers.filter(m => (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
    : gitMembers

  // "담당자가 처리" 행 — 특정 멤버 미지정 (현재 git assignee 가 처리) 상태.
  const isGenericAssignee = effectiveMode === 'assignee' && assigneeIdSet.size === 0

  return (
    <Modal open={iid !== null} onClose={onClose} title={title ?? `#${iid ?? ''} ${tIssue('preferredAgent')}`} size="sm">
      {/* 검색 — 에이전트/멤버 이름 또는 username 으로 동시 필터 */}
      <div className="sticky top-0 z-10 bg-ive-bg-card p-1.5 border-b border-ive-border-dark">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tIssue('searchMember')}
          className="w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
          autoFocus
        />
      </div>

      <div>
        {/* 자동 — 라운드로빈 AI 에이전트 */}
        <button
          disabled={saving}
          onClick={() => iid !== null && onSelect(iid, 'auto', null)}
          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
            effectiveMode === 'auto' ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          {effectiveMode === 'auto'
            ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" />
            : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
          <div className="w-7 h-7 rounded-lg bg-ive-bg-deep flex items-center justify-center shrink-0">
            <i className="fa-solid fa-shuffle text-ive-green text-xs" />
          </div>
          <span className="font-bold">{tIssue('noPreference')}</span>
        </button>

        {/* AI 에이전트 섹션 */}
        {filteredAgents.length > 0 && (
          <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-ive-text-dim uppercase tracking-wider border-t border-ive-border-subtle">
            <i className="fa-solid fa-bolt mr-1" />AI {tIssue('pickerAgents')}
          </div>
        )}
        {filteredAgents.map(pa => {
          const cli = CLI_CONFIG[pa.agent.cliName]
          const isDisabled = !isAgentAvailableNow(pa.agent)
          const isOffline = pa.agent.status === 'offline'
          const isPicked = effectiveMode === 'agent' && currentAgentId === pa.agentId
          return (
            <button
              key={pa.agentId}
              disabled={saving}
              onClick={() => iid !== null && onSelect(iid, 'agent', pa.agentId)}
              className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
                isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
              }`}
            >
              {isPicked
                ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" />
                : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
              <AgentAvatar avatar={pa.agent.avatar} size="xs" />
              <span className="font-bold">{pa.agent.name}</span>
              <span className={`text-xs inline-flex items-center gap-0.5 ${cli.color}`}><CliLogo cli={pa.agent.cliName} className="w-3 h-3" />{cli.label}</span>
              {isDisabled ? (
                <span className="text-xs text-ive-amber ml-auto inline-flex items-center gap-0.5"><i className="fa-solid fa-power-off mr-0.5" />{tIssue('agentDisabled')}</span>
              ) : isOffline ? (
                <span className="text-xs text-ive-red ml-auto"><i className="fa-solid fa-circle-exclamation mr-0.5" />{tIssue('agentOfflineWarning')}</span>
              ) : pa.agent.status === 'busy' ? (
                <span className="ml-auto w-2 h-2 rounded-full bg-ive-cyan animate-pulse" />
              ) : pa.agent.status === 'available' ? (
                <span className="ml-auto w-2 h-2 rounded-full bg-ive-green" />
              ) : null}
            </button>
          )
        })}

        {/* 담당자(사람) 섹션 */}
        <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-ive-text-dim uppercase tracking-wider border-t border-ive-border-subtle">
          <i className="fa-solid fa-user mr-1" />{tIssue('assigneeHandles')}
        </div>
        {/* "담당자(사람) 가 처리" — 특정 멤버 미지정. 현재 git assignee 가 처리. */}
        {(!q || tIssue('assigneeHandles').toLowerCase().includes(q)) && (
          <button
            disabled={saving}
            onClick={() => iid !== null && onSelect(iid, 'assignee', null, null)}
            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
              isGenericAssignee ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
            }`}
          >
            {isGenericAssignee
              ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" />
              : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
            <div className="w-7 h-7 rounded-lg bg-ive-bg-deep flex items-center justify-center shrink-0">
              <i className="fa-solid fa-user text-ive-cyan text-xs" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{tIssue('assigneeHandles')}</div>
              <div className="text-xs text-ive-text-dim truncate">{tIssue('assigneeHandlesDesc')}</div>
            </div>
          </button>
        )}
        {filteredMembers.map(m => {
          const isPicked = effectiveMode === 'assignee' && assigneeIdSet.has(m.id)
          return (
            <button
              key={m.id}
              disabled={saving}
              onClick={() => iid !== null && onSelect(iid, 'assignee', null, m)}
              className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
                isPicked ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
              }`}
            >
              {isPicked
                ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" />
                : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
              {m.avatarUrl
                ? <img src={m.avatarUrl} className="w-7 h-7 rounded-lg shrink-0" alt="" />
                : <div className="w-7 h-7 rounded-lg bg-ive-bg-deep flex items-center justify-center shrink-0"><i className="fa-solid fa-user text-ive-text-dim text-xs" /></div>}
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">{m.name || m.username}</div>
                {m.name && m.name !== m.username && <div className="text-xs text-ive-text-dim truncate">@{m.username}</div>}
              </div>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
