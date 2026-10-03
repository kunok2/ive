'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'
import ProjectCard from '@/components/project/ProjectCard'
import ProjectBoard from '@/components/project/ProjectBoard'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useTranslations } from 'next-intl'
import { useIsDesk } from '@/lib/use-media'

const BOARD_PROJECT_KEY = 'ive-board-project'

export default function ProjectsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, refresh } = useStore()
  const t = useTranslations('project')
  const isDesk = useIsDesk()
  // 보드는 PC 폭(마운트 후)에만 그리므로 첫 렌더에서 저장소를 읽어도 서버 렌더와 어긋나지 않는다
  const [boardId, setBoardId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try { return localStorage.getItem(BOARD_PROJECT_KEY) } catch { return null }
  })
  const pickBoard = (id: string) => {
    setBoardId(id)
    try { localStorage.setItem(BOARD_PROJECT_KEY, id) } catch { /* 무시 */ }
  }

  const loading = (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-ive-text-muted text-base">
      <i className="fa-solid fa-circle-notch fa-spin text-2xl text-ive-green" />
      {t('loadingProjects')}
    </div>
  )
  const empty = (
    <div className="text-center py-20">
      <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
      <p className="text-base text-ive-text-muted mb-2">{t('noProjects')}</p>
      <p className="text-sm text-ive-text-dim mb-5">{t('noProjectsHint')}</p>
      {onAdd && (
        <button
          data-tour="projects-empty-add"
          onClick={onAdd}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-lg active:scale-95 transition-transform"
        >
          <i className="fa-solid fa-plus" />{t('addProject')}
        </button>
      )}
    </div>
  )

  // PC 폭: 왼쪽 카드 목록(폰과 같은 카드) + 오른쪽 고른 프로젝트의 단계 보드
  if (isDesk && !state.loading && state.projects.length > 0) {
    const board = state.projects.find(p => p.id === boardId) ?? state.projects[0]
    return (
      <div className="w-full flex-1 flex min-h-0">
        <aside className="w-[400px] wide:w-[440px] shrink-0 overflow-y-auto px-4 pt-4 pb-6 border-r border-ive-border-dark">
          <div className="flex flex-col gap-3">
            {state.projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                selected={project.id === board.id}
                onSelect={() => pickBoard(project.id)}
                hideActiveList
              />
            ))}
          </div>
        </aside>
        <ProjectBoard key={board.id} project={board} />
      </div>
    )
  }

  // 폰·패드: 카드 1열 가운데 정렬(종전 그대로). 칸 나눔은 PC 폭에서만
  return (
    <PullToRefresh onRefresh={refresh} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      <div className="shrink-0 pt-4" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20 pad:pb-6">
          {state.loading ? loading : state.projects.length === 0 ? empty : (
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
