'use client'

import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import ProjectCard from '@/components/project/ProjectCard'
import ProjectBoard from '@/components/project/ProjectBoard'
import ExecutionTraceView from '@/components/execution/ExecutionTraceView'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useTranslations } from 'next-intl'
import { useIsDesk } from '@/lib/use-media'
import ProjectFilter from '@/components/report/ProjectFilter'
import type { Tr } from '@/components/report/format'

const BOARD_PROJECT_KEY = 'ive-board-project'
/** 보드에 모을 프로젝트들 — 프로젝트 필터로 고른 것(여럿). 빈 배열 = 전체 프로젝트 */
const BOARD_PROJECTS_KEY = 'ive-board-projects'
/** 기억한 선택. 없으면 null(아직 고른 적 없음 — 첫 프로젝트 하나를 보인다, 종전과 같다). 예전에 고른 프로젝트 하나(BOARD_PROJECT_KEY)도 이어받는다 */
function loadBoardProjects(): string[] | null {
  try {
    const raw = localStorage.getItem(BOARD_PROJECTS_KEY)
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter(x => typeof x === 'string') }
    const one = localStorage.getItem(BOARD_PROJECT_KEY)
    return one ? [one] : null
  } catch { return null }
}

export default function ProjectsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, refresh } = useStore()
  const t = useTranslations('project')
  const isDesk = useIsDesk()
  const [traceId, setTraceId] = useState<string | null>(null)
  // 보드는 PC 폭(마운트 후)에만 그리므로 첫 렌더에서 저장소를 읽어도 서버 렌더와 어긋나지 않는다
  const [boardIds, setBoardIds] = useState<string[] | null>(() => (typeof window === 'undefined' ? null : loadBoardProjects()))
  const pickBoards = useCallback((ids: string[]) => {
    setTraceId(null)
    setBoardIds(ids)
    try { localStorage.setItem(BOARD_PROJECTS_KEY, JSON.stringify(ids)) } catch { /* 무시 */ }
  }, [])
  // 프로젝트 필터 — 보고서·에이전트 탭과 같은 부품·문구(프로젝트가 하나면 보이지 않는다)
  const trV = useTranslations('reportV2')
  const trFilter: Tr = useCallback((k, p) => trV(k as never, p as never), [trV])
  const projectOptions = useMemo(() => state.projects.map(p => ({ id: p.id, name: p.name, color: p.color, provider: p.provider })), [state.projects])

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
    // 고른 프로젝트(이제 볼 수 없는 것은 뺀다). 고른 적 없으면 첫 프로젝트 하나, 「전체 프로젝트」(빈 선택)면 전부
    const chosen = (boardIds ?? []).filter(id => state.projects.some(p => p.id === id))
    const boards = boardIds === null || (boardIds.length > 0 && chosen.length === 0) ? [state.projects[0]]
      : chosen.length === 0 ? state.projects
      : state.projects.filter(p => chosen.includes(p.id))
    // 필터에 표시할 선택 — 전체를 보는 중이면 빈 선택(「전체 프로젝트」)
    const filterSelected = boards.length === state.projects.length && state.projects.length > 1 ? [] : boards.map(p => p.id)
    return (
      <div className="w-full flex-1 flex min-h-0">
        <aside className="w-[400px] wide:w-[440px] shrink-0 overflow-y-auto px-4 pt-4 pb-6 border-r border-ive-border-dark">
          <div className="flex flex-col gap-3">
            {state.projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                selected={boards.some(b => b.id === project.id)}
                onSelect={() => pickBoards([project.id])}
                hideActiveList
              />
            ))}
          </div>
        </aside>
        {/* 에이전트 실행은 오른쪽 칸에 트레이스로 — 닫으면 보드로 돌아간다(왼쪽 목록은 그대로) */}
        {traceId
          ? <ExecutionTraceView key={traceId} id={traceId} embedded onClose={() => setTraceId(null)} />
          : <ProjectBoard projects={boards} onOpenTrace={setTraceId}
              // 보드 머리의 프로젝트 필터 — 보드에 모을 프로젝트를 여럿 고른다. 왼쪽 카드를 누르면 그 프로젝트 하나만
              filterSlot={state.projects.length > 1 ? <ProjectFilter options={projectOptions} selected={filterSelected} onChange={pickBoards} tr={trFilter} /> : undefined}
            />}
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
