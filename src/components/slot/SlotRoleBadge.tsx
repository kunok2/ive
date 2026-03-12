import { SlotRole } from '@/types'

const roleConfig: Record<SlotRole, { label: string; bg: string; text: string; icon: string }> = {
  development: { label: '개발', bg: 'bg-ive-green/15', text: 'text-ive-green-light', icon: 'fa-solid fa-code' },
  verification: { label: '검증', bg: 'bg-ive-lime/15', text: 'text-ive-lime', icon: 'fa-solid fa-magnifying-glass' },
  review: { label: '리뷰', bg: 'bg-ive-amber/15', text: 'text-ive-amber', icon: 'fa-solid fa-eye' },
}

export default function SlotRoleBadge({ role }: { role: SlotRole }) {
  const config = roleConfig[role]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${config.bg} ${config.text}`}>
      <i className={`${config.icon} text-[10px]`} />
      {config.label}
    </span>
  )
}
