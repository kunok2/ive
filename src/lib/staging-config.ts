/**
 * 확인(④) 단계가 쓰는 staging 정보 — IVE 프로젝트 설정(project_automation.staging)에 둔다.
 * IVE 가 동작하려고 쓰는 메타정보이므로 대상 저장소에 파일로 두지 않는다.
 *
 *   url          화면 확인을 시작할 staging 주소 (비면 프로젝트의 「테스트 사이트 URL」)
 *   versionSource 배포된 커밋을 아는 방법
 *                  url      : versionUrl 응답의 commitField
 *                  pipeline : staging 브랜치의 마지막 성공 파이프라인 커밋 (배포 잡이 파이프라인 안에 있는 경우 — 예: GitLab Pages)
 *   versionUrl   staging 이 지금 내보내는 커밋을 알려 주는 주소 (예: /version.json)
 *   commitField  그 응답에서 커밋 SHA 가 든 필드 (점 표기 가능, 기본 commit)
 *   branch       확인용 워크스페이스를 만들 브랜치 (비면 프로젝트 기준 브랜치)
 *   notes        확인자에게 줄 짧은 안내 (로그인 방법 등, 비밀값 금지)
 * 테스트 계정 등 비밀값은 project_automation.staging_secrets(암호화)에 따로 둔다.
 */
import { Project } from '@/types'
import { getProjectAutomation, type StagingSettings } from './db'
import { fetchBranchPipelines, getDefaultBranch } from './provider'

export interface StagingConfig {
  url: string
  versionSource: 'url' | 'pipeline'
  versionUrl: string
  commitField: string
  branch: string | null
  notes: string | null
}

export type ConfigResult<T> = { ok: true; value: T } | { ok: false; reason: string }

export function resolveStagingConfig(project: Project, s?: StagingSettings): ConfigResult<StagingConfig> {
  const st = s ?? getProjectAutomation(project.id).staging
  const url = (st.url || project.testSiteUrl || '').trim()
  const versionUrl = (st.versionUrl || '').trim()
  const versionSource = st.versionSource === 'pipeline' ? 'pipeline' : 'url'
  if (!url) return { ok: false, reason: 'staging 주소가 설정되지 않았습니다(프로젝트 화면 → 역할·단계 자동화 → 자동화)' }
  if (versionSource === 'url' && !versionUrl) return { ok: false, reason: '배포 커밋 확인 주소가 설정되지 않았습니다(프로젝트 화면 → 역할·단계 자동화 → 자동화)' }
  return {
    ok: true,
    value: {
      url, versionSource, versionUrl,
      commitField: (st.commitField || 'commit').trim() || 'commit',
      branch: (st.branch || '').trim() || null,
      notes: (st.notes || '').trim() || null,
    },
  }
}

/** 점 표기 필드 읽기 — 'commit' | 'build.commit' */
function pickField(obj: any, field: string): unknown {
  return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/**
 * staging 브랜치 — 묶음 배포가 머지·푸시하는 곳이자 확인 워크스페이스의 기준.
 * 설정값 → 프로젝트 기준 브랜치 → 저장소 기본 브랜치.
 */
export async function resolveStagingBranch(project: Project, token: string, s?: StagingSettings): Promise<string> {
  const st = s ?? getProjectAutomation(project.id).staging
  const b = (st.branch || '').trim() || (project.baseBranch || '').trim()
  if (b) return b
  try { return (await getDefaultBranch(project, token)) || 'main' } catch { return 'main' }
}

/** staging 이 지금 내보내고 있는 커밋 SHA */
export async function fetchDeployedCommit(cfg: StagingConfig, project?: Project, token?: string): Promise<ConfigResult<string>> {
  if (cfg.versionSource === 'pipeline') {
    if (!project || !token) return { ok: false, reason: '파이프라인으로 배포 커밋을 확인하려면 프로젝트 정보가 필요합니다' }
    try {
      const branch = cfg.branch || await resolveStagingBranch(project, token)
      const pipelines = (await fetchBranchPipelines(project, token, branch)) as any[]
      const ok = (pipelines || []).find(p => p?.status === 'success' && p?.sha)
      if (!ok) return { ok: false, reason: `${branch} 브랜치에 성공한 파이프라인이 아직 없습니다` }
      return { ok: true, value: String(ok.sha) }
    } catch (e) {
      return { ok: false, reason: `파이프라인 조회 실패: ${(e as Error).message}` }
    }
  }
  try {
    // 버전 파일은 정적 파일이라 캐시(max-age)가 걸려 있을 수 있다 — 매번 새로 받도록 쿼리를 붙인다
    const u = new URL(cfg.versionUrl)
    u.searchParams.set('t', String(Date.now()))
    const res = await fetch(u, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
    if (!res.ok) return { ok: false, reason: `버전 주소 응답 ${res.status}` }
    const data = await res.json()
    const sha = String(pickField(data, cfg.commitField) || '').trim()
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { ok: false, reason: `버전 응답에 커밋(${cfg.commitField})이 없습니다` }
    return { ok: true, value: sha }
  } catch (e) {
    return { ok: false, reason: `버전 주소 접속 실패: ${(e as Error).message}` }
  }
}
