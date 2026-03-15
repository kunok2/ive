import { ProjectRole, Agent, RoleAssignment } from '@/types'
import RoleBadge from './RoleBadge'
import { maskToken } from '@/lib/store'
import { cliConfig } from '@/components/agent/AgentCard'

interface Props {
  role: ProjectRole & { assignedAgents?: (RoleAssignment & { agent: Agent })[] }
  onDelete?: (id: string) => void
  onManageAgents?: (roleId: string) => void
  onEdit?: (role: ProjectRole) => void
}

export default function RoleCard({ role, onDelete, onManageAgents, onEdit }: Props) {
  const statusConfig = {
    active: { label: '활성', bg: 'bg-ive-green-dark', text: 'text-white' },
    idle: { label: '대기', bg: 'bg-ive-text-dim/50', text: 'text-ive-text-secondary' },
    paused: { label: '중지', bg: 'bg-ive-red/30', text: 'text-ive-red' },
  }

  const status = statusConfig[role.status]
  const assignedAgents = role.assignedAgents || []

  return (
    <div className="bg-ive-bg-card rounded-xl border border-ive-border-subtle overflow-hidden transition-all hover:border-ive-green/30">
      {/* 헤더 */}
      <div className="p-3 flex items-center justify-between border-b border-ive-border-dark">
        <div className="flex items-center gap-2">
          <RoleBadge category={role.category} />
          <span className="text-base font-bold text-ive-green-pale">{role.name}</span>
          {onEdit && (
            <button
              onClick={() => onEdit(role)}
              className="px-2.5 py-1.5 hover:bg-ive-green/10 rounded-lg transition-all text-ive-text-dim hover:text-ive-green group/edit"
              title="역할 수정"
            >
              <i className="fa-solid fa-pen-to-square text-base" />
            </button>
          )}
        </div>
        <span className={`text-sm px-2 py-0.5 rounded-full font-semibold ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>

      {/* 정보 */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-base">
          <span className="text-ive-text-muted"><i className="fa-solid fa-robot w-4 text-center" /> 최대 Agent</span>
          <span className="text-ive-text font-semibold">{role.maxAgents}개</span>
        </div>

        <div className="flex items-center gap-2 text-base">
          <span className="text-ive-text-muted"><i className="fa-solid fa-key w-4 text-center" /> 토큰</span>
          {role.accessToken ? (
            <code className="text-base text-ive-text-dim bg-ive-bg-deep px-2 py-0.5 rounded font-mono">
              {maskToken(role.accessToken)}
            </code>
          ) : (
            <span className="text-sm text-ive-text-dim italic">프로젝트 기본 토큰 사용</span>
          )}
        </div>
      </div>

      {/* 배정된 Agent */}
      <div className="px-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ive-text-muted font-semibold">
            <i className="fa-solid fa-user-gear mr-1" />배정된 Agent ({assignedAgents.length}/{role.maxAgents})
          </span>
          {onManageAgents && (
            <button
              onClick={() => onManageAgents(role.id)}
              className="text-base text-ive-green font-bold bg-ive-green/5 border border-ive-green/20 px-3.5 py-1.5 rounded-lg active:opacity-70 transition-all hover:bg-ive-green/10"
            >
              <i className="fa-solid fa-gear mr-1" />관리
            </button>
          )}
        </div>

        {assignedAgents.length === 0 ? (
          <button
            onClick={() => onManageAgents?.(role.id)}
            className="w-full py-2.5 rounded-lg border border-dashed border-ive-border text-base text-ive-text-dim active:bg-ive-bg-deep transition-colors"
          >
            <i className="fa-solid fa-plus mr-1" />Agent 배정하기
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            {assignedAgents.map(ra => {
              const cli = cliConfig[ra.agent.cliName]
              return (
                <div key={ra.id} className="flex items-center gap-2 bg-ive-bg-deep/60 rounded-lg px-2.5 py-2">
                  <i className={`${cli.icon} ${cli.color} text-base`} />
                  <span className="text-base font-semibold text-ive-green-pale flex-1 truncate">{ra.agent.name}</span>
                  <span className="text-sm text-ive-text-dim">{cli.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 삭제 */}
      {onDelete && (
        <div className="px-3 pb-3 pt-1">
          <button
            onClick={() => onDelete(role.id)}
            className="w-full text-base font-bold text-ive-red/60 py-2.5 rounded-lg border border-ive-red/20 active:bg-ive-red/10 transition-colors"
          >
            <i className="fa-solid fa-trash-can mr-1.5" />역할 삭제
          </button>
        </div>
      )}
    </div>
  )
}
