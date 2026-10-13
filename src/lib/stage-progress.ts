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
  /** 본문 전체 체크박스의 진행률 — 작업의 진척. 체크박스가 없으면 null */
  total: StageProgress | null
  /** 단계 제목(`## 검증` 등) 아래 체크박스의 단계별 진행률 — 단계 칩에 곁들여 보이는 참고값(있는 단계만) */
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
 * 진척은 상태(IVE 단계)와 무관하게 본문 체크박스만으로 정한다 — 전체 개수 중 몇 개가 끝났는가.
 */
export function parseIssueProgress(body: string | null | undefined): IssueProgress {
  const counts: Partial<Record<ProgressStage, { done: number; total: number }>> = {}
  let done = 0
  let total = 0
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
    total += 1
    if (checked) done += 1
    if (section) {
      const c = (counts[section] ??= { done: 0, total: 0 })
      c.total += 1
      if (checked) c.done += 1
    }
  }

  const byStage: IssueProgress['byStage'] = {}
  for (const k of Object.keys(counts) as ProgressStage[]) byStage[k] = toProgress(counts[k]!.done, counts[k]!.total)
  return { total: total > 0 ? toProgress(done, total) : null, byStage }
}

/** 화면·API 가 쓰는 한 덩어리 — 이슈 본문에서 바로 구한다 */
export function computeProgress(body: string | null | undefined): IssueProgress {
  return parseIssueProgress(body)
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
