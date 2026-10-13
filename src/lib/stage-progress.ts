/**
 * 단계별 진행률 — 이슈 본문의 체크박스(`- [ ]` / `- [x]`)에서 읽는다.
 *
 * 깃랩·깃허브 모두 이슈 안에 「단계별 진행률」 필드가 없다. 그래서 본문에 단계 제목(`## 검증`)을 두고 그 아래에
 * 체크박스를 적으면, IVE 가 지금 단계 제목 아래의 체크박스만 세어 그 단계의 진행률로 쓴다.
 * 값은 본문 텍스트 자체라 깃 화면에서 체크해도, IVE 에서 체크해도 같은 곳이 바뀐다(이중 관리 없음).
 *
 * 순수 함수 — DB·네트워크를 쓰지 않는다. 표시용 집계이며 스캐너의 스케줄링 판단에는 쓰지 않는다.
 */

export type ProgressStage = 'process' | 'verify' | 'confirm'

export interface StageProgress {
  done: number
  total: number
  /** 0~100 정수 */
  percent: number
}

export interface IssueProgress {
  /** 지금 단계의 체크박스 진행률. 체크박스가 없으면 null */
  stage: StageProgress | null
  /** 단계별 진행률(본문에 그 단계 제목이 있는 것만) */
  byStage: Partial<Record<ProgressStage, StageProgress>>
}

const CHECKBOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/

/** 제목 글자 → 단계. 「처리」「검증」「확인」(또는 영문)이 들어 있으면 그 단계 */
function stageFromHeading(text: string): ProgressStage | null {
  const t = text.toLowerCase()
  if (/검증|verif/.test(t)) return 'verify'
  if (/확인|confirm/.test(t)) return 'confirm'
  if (/처리|개발|구현|process|develop|implement/.test(t)) return 'process'
  return null
}

function toProgress(done: number, total: number): StageProgress {
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/**
 * 본문에서 체크박스를 센다. 코드 블록 안은 건너뛴다(예시로 적은 `- [ ]` 를 세지 않기 위해).
 * 단계 제목이 아닌 제목(`## 배경` 등)을 만나면 그 아래 체크박스는 어느 단계에도 넣지 않고 「제목 없는 묶음」으로 센다.
 */
export function parseIssueProgress(body: string | null | undefined, currentStage: ProgressStage | null): IssueProgress {
  const counts: Partial<Record<ProgressStage, { done: number; total: number }>> = {}
  const loose = { done: 0, total: 0 }
  let section: ProgressStage | null = null
  let inFence = false

  for (const line of (body || '').split(/\r?\n/)) {
    if (FENCE.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const h = HEADING.exec(line)
    if (h) { section = stageFromHeading(h[1]); continue }
    const m = CHECKBOX.exec(line)
    if (!m) continue
    const checked = m[1] !== ' '
    const bucket = section ? (counts[section] ??= { done: 0, total: 0 }) : loose
    bucket.total += 1
    if (checked) bucket.done += 1
  }

  const byStage: IssueProgress['byStage'] = {}
  for (const k of Object.keys(counts) as ProgressStage[]) byStage[k] = toProgress(counts[k]!.done, counts[k]!.total)

  // 지금 단계: 그 단계 제목 아래 체크박스 → 없으면 제목 없는 체크박스(단계 구분 없이 적은 목록)
  let stage: StageProgress | null = null
  if (currentStage && byStage[currentStage]) stage = byStage[currentStage]!
  else if (loose.total > 0) stage = toProgress(loose.done, loose.total)
  return { stage, byStage }
}

/** 단계 순서(처리 → 검증 → 확인) */
const ORDER: ProgressStage[] = ['process', 'verify', 'confirm']

/**
 * 전체 진행률(0~100) — 끝난 단계 수 + 지금 단계 진행률로 대략 계산한다.
 * 지금 단계에 체크박스가 없으면 그 단계는 0 으로 둔다(진행 중이라는 사실만 반영).
 */
export function overallPercent(currentStage: ProgressStage | 'done' | null, stageFraction: number | null): number {
  if (currentStage === 'done') return 100
  if (!currentStage) return 0
  const idx = ORDER.indexOf(currentStage)
  const frac = Math.min(1, Math.max(0, stageFraction ?? 0))
  return Math.round(((idx + frac) / ORDER.length) * 100)
}

/** IVE 단계 → 진행률 단계. 대기·진행 중을 한 단계로 본다 */
export function progressStageOf(stage: string | null | undefined): ProgressStage | 'done' | null {
  switch (stage) {
    case 'waiting': case 'dev': case 'dev_fail': return 'process'
    case 'verify_waiting': case 'verifying': return 'verify'
    case 'confirm_waiting': case 'confirming': return 'confirm'
    case 'done': return 'done'
    default: return null
  }
}

/**
 * 전체 진행률 — 세 단계의 평균. 지난 단계는 100%, 지금·앞으로 올 단계는 그 단계 체크박스 진행률(체크박스가 없으면 0).
 * 그래서 모든 체크박스를 다 체크하면 아직 단계가 안 넘어갔어도 100% 가 된다.
 */
function overallFromStages(current: ProgressStage | 'done', byStage: IssueProgress['byStage'], currentFraction: number | null): number {
  if (current === 'done') return 100
  const idx = ORDER.indexOf(current)
  const sum = ORDER.reduce((acc, k, i) => {
    if (i < idx) return acc + 1
    if (i === idx) return acc + Math.min(1, Math.max(0, currentFraction ?? 0))
    return acc + (byStage[k] ? byStage[k]!.percent / 100 : 0)
  }, 0)
  return Math.round((sum / ORDER.length) * 100)
}

/** 화면·API 가 쓰는 한 덩어리 — 이슈 본문과 현재 IVE 단계에서 바로 구한다 */
export function computeProgress(body: string | null | undefined, ivestage: string | null | undefined) {
  const ps = progressStageOf(ivestage)
  const parsed = parseIssueProgress(body, ps && ps !== 'done' ? ps : null)
  return {
    stage: parsed.stage,
    byStage: parsed.byStage,
    overall: ps ? overallFromStages(ps, parsed.byStage, parsed.stage ? parsed.stage.percent / 100 : null) : null,
  }
}

/**
 * 본문의 N번째 체크박스(코드 블록 밖, 위에서부터 0번)를 `checked` 로 바꾼다. 화면에서 누른 체크박스를 본문에 되쓰는 데 쓴다.
 * 그 사이 본문이 바뀌어 N번째가 이미 `checked` 상태이거나 없으면 null(호출쪽이 새로고침을 안내한다).
 */
export function toggleCheckboxInBody(body: string, index: number, checked: boolean): string | null {
  const lines = body.split('\n')
  let inFence = false
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = CHECKBOX.exec(line)
    if (!m) continue
    if (n++ !== index) continue
    if ((m[1] !== ' ') === checked) return null
    const at = line.indexOf('[')
    lines[i] = `${line.slice(0, at)}[${checked ? 'x' : ' '}]${line.slice(at + 3)}`
    return lines.join('\n')
  }
  return null
}

/** 「체크리스트 넣기」 — 본문 끝에 처리·검증·확인 제목과 빈 체크박스 뼈대를 붙인다 */
export function appendChecklist(text: string, labels: { process: string; verify: string; confirm: string }): string {
  const skeleton = [labels.process, labels.verify, labels.confirm].map(h => `## ${h}\n- [ ] `).join('\n\n')
  const base = text.trimEnd()
  return base ? `${base}\n\n${skeleton}\n` : `${skeleton}\n`
}
