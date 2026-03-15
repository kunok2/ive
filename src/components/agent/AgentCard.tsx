import { Agent, CliName } from '@/types'

interface Props {
  agent: Agent
  onDelete?: (id: string) => void
  compact?: boolean
  assignedCount?: number
}

const cliConfig: Record<CliName, { label: string; icon: string; color: string; desc: string }> = {
  claude: { label: 'Claude Code', icon: 'fa-solid fa-atom', color: 'text-ive-amber', desc: 'Anthropic' },
  gemini: { label: 'Gemini CLI', icon: 'fa-brands fa-google', color: 'text-ive-cyan', desc: 'Google' },
  codex: { label: 'Codex CLI', icon: 'fa-solid fa-brain', color: 'text-ive-green-light', desc: 'OpenAI' },
}

const statusConfig = {
  available: { label: '대기', dot: 'bg-ive-green' },
  busy: { label: '작업 중', dot: 'bg-ive-amber' },
  offline: { label: '오프라인', dot: 'bg-ive-text-dim' },
}

export default function AgentCard({ agent, onDelete, compact, assignedCount }: Props) {
  const cli = cliConfig[agent.cliName]
  const status = statusConfig[agent.status]

  if (compact) {
    return (
      <div className="flex items-center gap-3 bg-ive-bg-card rounded-lg p-3 border border-ive-border-subtle">
        <div className="w-8 h-8 rounded-lg bg-ive-bg flex items-center justify-center shrink-0">
          <i className={`${cli.icon} ${cli.color} text-base`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-ive-green-pale truncate">{agent.name}</div>
          <div className="text-sm text-ive-text-muted truncate">{cli.label}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className="text-sm text-ive-text-muted">{status.label}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-ive-bg-card rounded-xl border border-ive-border-subtle overflow-hidden">
      {/* 헤더 */}
      <div className="p-3 flex items-center justify-between border-b border-ive-border-dark">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-ive-bg flex items-center justify-center shrink-0">
            <i className={`${cli.icon} ${cli.color} text-lg`} />
          </div>
          <div>
            <div className="text-base font-bold text-ive-green-pale">{agent.name}</div>
            <div className="text-sm text-ive-text-muted">{cli.label} · {cli.desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className="text-sm text-ive-text-muted">{status.label}</span>
        </div>
      </div>

      {/* 정보 */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-base">
          <span className="text-ive-text-muted"><i className="fa-solid fa-folder w-4 text-center" /> 경로</span>
          <code className="text-base text-ive-text-dim bg-ive-bg-deep px-2 py-0.5 rounded font-mono truncate">
            {agent.cliPath}
          </code>
        </div>

        {agent.cliVersion && (
          <div className="flex items-center gap-2 text-base">
            <span className="text-ive-text-muted"><i className="fa-solid fa-code-branch w-4 text-center" /> 버전</span>
            <span className="text-ive-text font-semibold">{agent.cliVersion}</span>
          </div>
        )}

        {assignedCount !== undefined && (
          <div className="flex items-center gap-2 text-base">
            <span className="text-ive-text-muted"><i className="fa-solid fa-plug w-4 text-center" /> 배정</span>
            <span className={`font-semibold ${assignedCount > 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>
              {assignedCount > 0 ? `${assignedCount}개 슬롯` : '미배정'}
            </span>
          </div>
        )}
      </div>

      {/* 삭제 */}
      {onDelete && (
        <div className="px-3 pb-3">
          <button
            onClick={() => onDelete(agent.id)}
            className="w-full text-base text-ive-red/60 py-1.5 rounded border border-ive-red/20 active:bg-ive-red/10 transition-colors"
          >
            <i className="fa-solid fa-trash-can mr-1" /> Agent 삭제
          </button>
        </div>
      )}
    </div>
  )
}

export { cliConfig, statusConfig }
