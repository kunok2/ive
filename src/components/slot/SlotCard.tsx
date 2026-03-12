import { Slot } from '@/types'
import SlotRoleBadge from './SlotRoleBadge'
import { maskToken } from '@/lib/store'

interface Props {
  slot: Slot
  onDelete?: (id: string) => void
}

export default function SlotCard({ slot, onDelete }: Props) {
  const statusConfig = {
    active: { label: '활성', bg: 'bg-ive-green-dark', text: 'text-white' },
    idle: { label: '대기', bg: 'bg-ive-text-dim/50', text: 'text-ive-text-secondary' },
    paused: { label: '중지', bg: 'bg-ive-red/30', text: 'text-ive-red' },
  }

  const status = statusConfig[slot.status]

  return (
    <div className="bg-ive-bg-card rounded-xl border border-ive-border-subtle overflow-hidden">
      {/* 헤더 */}
      <div className="p-3 flex items-center justify-between border-b border-ive-border-dark">
        <div className="flex items-center gap-2">
          <SlotRoleBadge role={slot.role} />
          <span className="text-sm font-bold text-ive-green-pale">{slot.name}</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>

      {/* 정보 */}
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ive-text-muted"><i className="fa-solid fa-robot w-4 text-center" /> 최대 Agent</span>
          <span className="text-ive-text font-semibold">{slot.maxAgents}개</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-ive-text-muted"><i className="fa-solid fa-key w-4 text-center" /> 토큰</span>
          <code className="text-[11px] text-ive-text-dim bg-ive-bg-deep px-2 py-0.5 rounded font-mono">
            {maskToken(slot.accessToken)}
          </code>
        </div>
      </div>

      {/* 삭제 */}
      {onDelete && (
        <div className="px-3 pb-3">
          <button
            onClick={() => onDelete(slot.id)}
            className="w-full text-xs text-ive-red/60 py-1.5 rounded border border-ive-red/20 active:bg-ive-red/10 transition-colors"
          >
            <i className="fa-solid fa-trash-can mr-1" /> 슬롯 삭제
          </button>
        </div>
      )}
    </div>
  )
}
