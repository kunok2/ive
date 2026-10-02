/**
 * 보고서 모델의 순수 계산 — DB 없이 테스트한다.
 */
import type { Grade } from './types'

// ─── 통계 ───

export function quantile(values: number[], q: number): number | null {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const pos = (v.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo)
}

export const median = (v: number[]) => quantile(v, 0.5)

/** 비율의 95% 신뢰구간(Wilson). n=0 이면 null */
export function wilson(pass: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null
  const z = 1.96
  const p = pass / n
  const denom = 1 + z * z / n
  const center = (p + z * z / (2 * n)) / denom
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

/**
 * 두 비율의 차이를 유의수준 5%·검정력 80% 로 가리려면 각 그룹에 필요한 표본 수.
 * 차이가 0 이면 null(어떤 표본으로도 가릴 차이가 없다).
 */
export function requiredSamplePerGroup(p1: number, p2: number): number | null {
  const d = Math.abs(p1 - p2)
  if (d < 1e-9) return null
  const k = (1.96 + 0.84) ** 2
  return Math.ceil(k * (p1 * (1 - p1) + p2 * (1 - p2)) / (d * d))
}

// ─── 결과 등급 ───

export interface GradeInput {
  /** 처리 실행 횟수(에이전트 처리 또는 사람 처리) */
  runs: number
  /** 검증·확인 반려 횟수 */
  rejects: number
  /** 완료 후 다시 열렸거나 후속 이슈가 고쳤는가 */
  overturned: boolean
}

export function gradeOf(g: GradeInput): Grade {
  if (g.overturned) return 'overturned'
  if (g.rejects >= 2) return 'rejected_repeat'
  if (g.rejects === 1) return 'rejected_pass'
  if (g.runs > 1) return 'rerun'
  return 'pass'
}

/** 모델 이름 정규화 — 컨텍스트 변형([1m])은 같은 모델로 묶는다 */
export function normalizeModel(model: string | null | undefined): string | null {
  const m = (model || '').trim()
  if (!m) return null
  return m.replace(/\[[^\]]*\]$/, '').trim() || null
}

// ─── 사람 작업시간: 겹침 제거와 프로젝트 배분 ───

export interface WorkSegment {
  person: string
  projectId: string
  start: number // ms
  end: number   // ms
}

export interface WorkAllocation {
  /** 사람별 겹침을 뺀 실제 시간(분) */
  personMinutes: Map<string, number>
  /** 사람별 기록 합계(분) — 겹침 포함 */
  personRawMinutes: Map<string, number>
  /** 프로젝트별 배분 시간(분). 같은 사람이 같은 시간에 여러 일을 했으면 그 시간을 나눈다 */
  projectMinutes: Map<string, number>
}

export function allocateWork(segments: WorkSegment[]): WorkAllocation {
  const personMinutes = new Map<string, number>()
  const personRawMinutes = new Map<string, number>()
  const projectMinutes = new Map<string, number>()
  const byPerson = new Map<string, WorkSegment[]>()
  for (const s of segments) {
    if (!(s.end > s.start)) continue
    personRawMinutes.set(s.person, (personRawMinutes.get(s.person) ?? 0) + (s.end - s.start) / 60_000)
    const list = byPerson.get(s.person) ?? []
    list.push(s)
    byPerson.set(s.person, list)
  }
  for (const [person, list] of byPerson) {
    // 시작·끝 지점을 시간순으로 훑으며(스윕) 지금 열려 있는 작업 수를 센다 — O(n log n)
    const points: { t: number; d: 1 | -1; projectId: string }[] = []
    for (const s of list) { points.push({ t: s.start, d: 1, projectId: s.projectId }); points.push({ t: s.end, d: -1, projectId: s.projectId }) }
    points.sort((a, b) => a.t - b.t || a.d - b.d) // 같은 시각이면 끝을 먼저
    const open = new Map<string, number>() // 프로젝트 → 열린 작업 수
    let active = 0
    let union = 0
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      open.set(p.projectId, (open.get(p.projectId) ?? 0) + p.d)
      if ((open.get(p.projectId) ?? 0) <= 0) open.delete(p.projectId)
      active += p.d
      const next = points[i + 1]
      if (!next || active <= 0 || next.t <= p.t) continue
      const mins = (next.t - p.t) / 60_000
      union += mins
      // 이 구간의 시간을 열린 작업 수만큼 나눠 각 작업의 프로젝트에 준다
      for (const [pid, n] of open) projectMinutes.set(pid, (projectMinutes.get(pid) ?? 0) + mins * n / active)
    }
    personMinutes.set(person, union)
  }
  return { personMinutes, personRawMinutes, projectMinutes }
}

/** [start,end] 를 KST 평일 09–18 근무 구간 조각들로 자른다(사람 비용 산정과 같은 기준). */
export function businessSegmentsKST(startMs: number, endMs: number): [number, number][] {
  const KST = 9 * 3_600_000, DAY = 86_400_000
  if (!(endMs > startMs)) return []
  const s = startMs + KST
  let e = endMs + KST
  if (e - s > 366 * DAY) e = s + 366 * DAY
  const out: [number, number][] = []
  for (let d = Math.floor(s / DAY) * DAY; d < e; d += DAY) {
    const dow = new Date(d).getUTCDay()
    if (dow === 0 || dow === 6) continue
    const a = Math.max(s, d + 9 * 3_600_000), b = Math.min(e, d + 18 * 3_600_000)
    if (b > a) out.push([a - KST, b - KST])
  }
  return out
}
