'use client'

import { useStore } from '@/lib/store'
import ProjectCard from '@/components/project/ProjectCard'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useTranslations } from 'next-intl'

export default function ProjectsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, refresh } = useStore()
  const t = useTranslations('project')

  return (
    <PullToRefresh onRefresh={refresh} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      <div className="shrink-0 pt-4" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20">
          {state.loading ? (
            <div className="text-center py-20 text-ive-text-muted text-base">
              <i className="fa-solid fa-circle-notch fa-spin text-2xl text-ive-green mb-3 block" />
              {t('loadingProjects')}
            </div>
          ) : state.projects.length === 0 ? (
            <div className="text-center py-20">
              <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
              <p className="text-base text-ive-text-muted mb-2">{t('noProjects')}</p>
              <p className="text-sm text-ive-text-dim mb-5">{t('noProjectsHint')}</p>
              {onAdd && (
                <button
                  onClick={onAdd}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-lg active:scale-95 transition-transform"
                >
                  <i className="fa-solid fa-plus" />{t('addProject')}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {state.projects.map(project => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>
      </div>
    </PullToRefresh>
  )
}
