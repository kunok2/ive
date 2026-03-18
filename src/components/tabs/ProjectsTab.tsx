'use client'

import { useStore } from '@/lib/store'
import ProjectCard from '@/components/project/ProjectCard'
import PullToRefresh from '@/components/ui/PullToRefresh'

interface Props {
  editMode: boolean
  onAdd?: () => void
}

export default function ProjectsTab({ editMode, onAdd }: Props) {
  const { state, reorderProject, refresh } = useStore()

  return (
    <PullToRefresh onRefresh={refresh} className="min-h-screen pb-20">
      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.loading ? (
          <div className="text-center py-20 text-ive-text-muted text-base">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-ive-green mb-3 block" />
            프로젝트 불러오는 중...
          </div>
        ) : state.projects.length === 0 ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">아직 프로젝트가 없습니다</p>
            <p className="text-sm text-ive-text-dim mb-5">GitLab/GitHub 저장소를 연결하여 AI 개발자가 이슈를 처리하도록 설정하세요</p>
            {onAdd && (
              <button
                onClick={onAdd}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-xl active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-plus" />프로젝트 추가
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state.projects.map((project, idx) => (
              <div key={project.id} className="flex items-stretch gap-2">
                {editMode && (
                  <div className="flex flex-col justify-center gap-1 shrink-0">
                    <button
                      onClick={() => reorderProject(project.id, 'up')}
                      disabled={idx === 0}
                      className="w-8 h-8 rounded-lg bg-ive-bg-card border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-green hover:border-ive-green/40 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    >
                      <i className="fa-solid fa-chevron-up text-xs" />
                    </button>
                    <button
                      onClick={() => reorderProject(project.id, 'down')}
                      disabled={idx === state.projects.length - 1}
                      className="w-8 h-8 rounded-lg bg-ive-bg-card border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-green hover:border-ive-green/40 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    >
                      <i className="fa-solid fa-chevron-down text-xs" />
                    </button>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <ProjectCard project={project} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </PullToRefresh>
  )
}
