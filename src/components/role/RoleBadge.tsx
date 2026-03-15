import { RoleCategory } from '@/types'

const roleConfig: Record<RoleCategory, { bg: string; text: string; icon: string }> = {
  '개발': { bg: 'bg-ive-green/15', text: 'text-ive-green-light', icon: 'fa-solid fa-code' },
  '검증': { bg: 'bg-ive-amber/15', text: 'text-ive-amber', icon: 'fa-solid fa-magnifying-glass-chart' },
}

export default function RoleBadge({ category }: { category: RoleCategory }) {
  const config = roleConfig[category] || roleConfig['개발']
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-black uppercase tracking-tighter ${config.bg} ${config.text}`}>
      <i className={`${config.icon} text-sm`} />
      {category}
    </span>
  )
}
