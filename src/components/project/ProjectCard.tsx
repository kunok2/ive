import Link from 'next/link'
import { Project, Slot } from '@/types'

interface Props {
  project: Project
  slots: Slot[]
}

export default function ProjectCard({ project, slots }: Props) {
  const activeSlots = slots.filter(s => s.status === 'active').length

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block bg-ive-bg-card rounded-xl p-4 border border-ive-border-subtle active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-ive-bg flex items-center justify-center shrink-0">
          <i className={`fa-brands ${project.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-lg text-ive-text-secondary`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-ive-green-pale truncate">
            {project.name}
          </div>
          <div className="text-[11px] text-ive-text-muted truncate">
            {project.repoUrl}
          </div>
        </div>
        <i className="fa-solid fa-chevron-right text-ive-text-dim text-xs" />
      </div>
      <div className="flex gap-4 mt-3 pt-3 border-t border-ive-border-dark">
        <div className="text-center">
          <div className="text-base font-extrabold text-ive-green">{slots.length}</div>
          <div className="text-[9px] text-ive-text-muted">슬롯</div>
        </div>
        <div className="text-center">
          <div className="text-base font-extrabold text-ive-amber">{activeSlots}</div>
          <div className="text-[9px] text-ive-text-muted">활성</div>
        </div>
      </div>
    </Link>
  )
}
