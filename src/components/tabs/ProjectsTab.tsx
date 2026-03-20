'use client'

import { useStore } from '@/lib/store'
import ProjectCard from '@/components/project/ProjectCard'
import PullToRefresh from '@/components/ui/PullToRefresh'

export default function ProjectsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, refresh } = useStore()

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
            {state.projects.map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>
    </PullToRefresh>
  )
}
