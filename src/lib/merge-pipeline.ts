// 머지 커밋에 해당하는 파이프라인(체크런) 1건을 특정하는 공용 헬퍼.
// 클라이언트 폴링 라우트(mr/pipeline)와 서버측 머지 감시(merge-watcher) 가 동일 로직을 공유한다.
import { Project } from '@/types'
import { fetchMRByBranch, fetchBranchPipelines } from './provider'

export interface MergePipeline {
  id: number | string
  status: string
  web_url: string
  created_at?: string
  finished_at?: string | null
}

/**
 * 이슈의 작업 브랜치(dev-{iid}) MR 이 머지된 커밋의 파이프라인을 특정해 반환한다.
 *  - MR 이 없거나 파이프라인이 아직 없으면 null.
 *  - merge_commit_sha 가 있으면 그 SHA 의 파이프라인만 매칭(머지 직후 다른 푸시와 섞이지 않도록).
 */
export async function getMergePipeline(project: Project, token: string, iid: number): Promise<MergePipeline | null> {
  const sourceBranch = `dev-${iid}`
  const mr = await fetchMRByBranch(project, token, sourceBranch)
  if (!mr) return null

  const mergeSha = mr.merge_commit_sha
  const targetBranch = mr.target_branch || 'main'
  const pipelines = await fetchBranchPipelines(project, token, targetBranch)
  if (!pipelines || pipelines.length === 0) return null

  const matched = mergeSha
    ? pipelines.find((p: any) => p.sha === mergeSha)
    : pipelines[0]
  if (!matched) return null

  return {
    id: matched.id,
    status: matched.status,
    web_url: matched.web_url,
    created_at: matched.created_at,
    finished_at: matched.finished_at || null,
  }
}
