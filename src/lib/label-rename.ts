/**
 * 프로젝트 설정에서 단계 레이블 이름을 바꿀 때 저장소 레이블도 함께 «이름 변경»한다.
 *
 * 설정만 바꾸면 저장소에는 옛 레이블이 남고 이미 붙은 이슈도 옛 이름을 단 채라 IVE 가 그 이슈들을 못 본다
 * (「Git에 레이블 생성」을 누르면 새 레이블이 «추가로» 생길 뿐이다). 이름 변경은 붙어 있는 이슈까지 함께 옮긴다.
 * 저장소와 설정이 어긋난 순간 스캔이 돌면 열린 이슈를 사라진 것으로 보고 정리하므로, 호출측은 스캔을 멈춘 채
 * (runWhileScannerHeld) 이름 변경 → 설정 저장을 한 번에 한다.
 */
import type { Project } from '@/types'
import { renameLabel } from '@/lib/provider'

export const LABEL_FIELDS = [
  'labelTarget', 'labelSchedule', 'labelDev', 'labelVerifyWait', 'labelVerify',
  'labelConfirmWait', 'labelConfirm', 'labelEnd', 'labelNotify',
] as const
export type LabelField = typeof LABEL_FIELDS[number]

export interface LabelChange { field: LabelField; from: string; to: string }

/** 저장하려는 값(body)과 지금 설정(existing)을 견주어 이름이 바뀌는 레이블. 빈 칸은 바꾸지 않는 것으로 본다. */
export function diffLabels(existing: Project, body: Partial<Record<LabelField, unknown>>): LabelChange[] {
  const out: LabelChange[] = []
  for (const field of LABEL_FIELDS) {
    const raw = body[field]
    const to = typeof raw === 'string' ? raw.trim() : ''
    const from = existing[field] || ''
    if (to && from && to !== from) out.push({ field, from, to })
  }
  return out
}

/** 저장할 수 없는 레이블 변경이면 그 이유. 저장해도 되면 null. */
export function labelChangeProblem(existing: Project, body: Partial<Record<LabelField, unknown>>, changes: LabelChange[]): string | null {
  if (changes.length === 0) return null
  const next = LABEL_FIELDS.map(f => {
    const v = body[f]
    return (typeof v === 'string' && v.trim()) || existing[f] || ''
  })
  const dup = next.find((v, i) => v && next.indexOf(v) !== i)
  if (dup) return `레이블 이름 「${dup}」이 두 칸에 같이 들어 있습니다 — 단계마다 다른 이름을 쓰세요.`
  // 맞바꾸기(A→B, B→A 등): 새 이름이 다른 칸의 지금 이름이면, 그 칸을 먼저 옮기기 전에 이름이 부딪친다
  const currents = new Set(LABEL_FIELDS.map(f => existing[f]).filter(Boolean))
  const clash = changes.find(c => currents.has(c.to))
  if (clash) return `「${clash.to}」은 지금 다른 단계가 쓰는 이름입니다 — 이름을 맞바꾸려면 다른 이름을 거쳐 두 번에 나눠 저장하세요.`
  return null
}

/**
 * 저장소 레이블을 차례로 이름 변경한다. 하나라도 실패하면 이미 바꾼 것을 되돌리고 예외를 다시 던진다
 * (설정은 저장하지 않으므로 저장소도 처음 상태여야 한다).
 */
export async function renameRepoLabels(project: Project, token: string, changes: LabelChange[]): Promise<{ renamed: LabelChange[] }> {
  const renamed: LabelChange[] = []
  try {
    for (const c of changes) {
      if ((await renameLabel(project, token, c.from, c.to)) === 'renamed') renamed.push(c)
    }
  } catch (e) {
    for (const c of [...renamed].reverse()) {
      try { await renameLabel(project, token, c.to, c.from) } catch { /* 되돌리기 실패 — 아래 메시지로 알린다 */ }
    }
    const undone = renamed.length ? ` (먼저 바꾼 ${renamed.map(c => `「${c.to}」`).join('·')}은 원래 이름으로 되돌렸습니다)` : ''
    throw new Error(`${e instanceof Error ? e.message : String(e)}${undone}`)
  }
  return { renamed }
}
