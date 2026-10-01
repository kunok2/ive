/**
 * 단계 증적(스크린샷·trace·결과 JSON) 보관과 이슈 첨부.
 *
 *   원본: data/evidence/<projectId>/<iid>/<stage>-<timestamp>/  — IVE 이슈 상세의 증적 갤러리가 읽는다.
 *   이슈: GitLab 업로드 API 로 올려 코멘트에 마크다운으로 붙인다.
 *         GitHub 는 이슈 첨부 업로드 API 가 없어(기존 헬퍼는 기본 브랜치에 커밋한다) 증적을 저장소에 커밋하지
 *         않고 IVE 증적 화면 링크만 남긴다.
 */
import fs from 'fs'
import path from 'path'
import { Project } from '@/types'
import { uploadIssueAttachment } from './provider'

export const EVIDENCE_ROOT = path.join(process.cwd(), 'data', 'evidence')

export type EvidenceStage = 'reproduce' | 'verify' | 'confirm'

const SAFE_NAME = /^[\w.\-]+$/
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const ALLOWED_EXT = new Set([...IMAGE_EXT, '.zip', '.json', '.txt', '.webm'])
const MAX_FILE_BYTES = 20 * 1024 * 1024

export function evidenceDir(projectId: string, iid: number, stage: EvidenceStage, stamp: string): string {
  return path.join(EVIDENCE_ROOT, projectId, String(iid), `${stage}-${stamp}`)
}

export function evidenceStamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-')
}

/**
 * 작업자 출력 디렉터리에서 증적 파일을 골라 보관 디렉터리로 복사한다.
 * 허용 확장자·크기만, 파일명은 안전한 문자로 정리(비밀값이 파일명에 섞이는 것을 막는 규약은 프롬프트 고정 부분).
 * @returns 보관한 파일의 상대 경로 목록 (보관 디렉터리 기준)
 */
export function collectEvidence(srcDir: string, destDir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(srcDir)) return out
  fs.mkdirSync(destDir, { recursive: true })
  const walk = (dir: string, rel: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name)
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isSymbolicLink()) continue          // 링크는 따라가지 않는다(작업 디렉터리 밖 파일 유출 방지)
      if (ent.isDirectory()) { if (r.split('/').length < 4) walk(abs, r); continue }
      if (!ent.isFile()) continue
      const ext = path.extname(ent.name).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) continue
      const st = fs.lstatSync(abs)
      if (st.size > MAX_FILE_BYTES) continue
      const safeRel = r.split('/').map(seg => seg.replace(/[^\w.\-]/g, '_')).join('/')
      const target = path.join(destDir, safeRel)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(abs, target)
      out.push(safeRel)
    }
  }
  walk(srcDir, '')
  return out
}

export interface EvidenceRun {
  stage: EvidenceStage
  stamp: string
  dir: string               // `${stage}-${stamp}`
  files: string[]           // 상대 경로
  images: string[]
  result: any | null        // result.json (있으면)
}

/** 이슈의 증적 목록 — 최신순 */
export function listEvidence(projectId: string, iid: number): EvidenceRun[] {
  const base = path.join(EVIDENCE_ROOT, projectId, String(iid))
  if (!fs.existsSync(base)) return []
  const runs: EvidenceRun[] = []
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const m = ent.name.match(/^(reproduce|verify|confirm)-(.+)$/)
    if (!m) continue
    const dir = path.join(base, ent.name)
    const files: string[] = []
    const walk = (d: string, rel: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${f.name}` : f.name
        if (f.isDirectory()) walk(path.join(d, f.name), r)
        else files.push(r)
      }
    }
    walk(dir, '')
    let result: any = null
    try { result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')) } catch { /* 없음 */ }
    runs.push({
      stage: m[1] as EvidenceStage, stamp: m[2], dir: ent.name, files: files.sort(),
      images: files.filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase())).sort(),
      result,
    })
  }
  return runs.sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
}

/** 증적 파일 절대 경로 — 경로 탈출 방지. 없으면 null */
export function resolveEvidenceFile(projectId: string, iid: number, runDir: string, file: string): string | null {
  if (!/^(reproduce|verify|confirm)-[\w\-]+$/.test(runDir)) return null
  const segs = file.split('/')
  if (segs.length === 0 || segs.some(s => !SAFE_NAME.test(s) || s === '..' || s === '.')) return null
  const abs = path.join(EVIDENCE_ROOT, projectId, String(iid), runDir, ...segs)
  const root = path.join(EVIDENCE_ROOT, projectId, String(iid), runDir) + path.sep
  if (!abs.startsWith(root)) return null
  try { if (!fs.lstatSync(abs).isFile()) return null } catch { return null }
  return abs
}

export function evidenceMime(file: string): string {
  const ext = path.extname(file).toLowerCase()
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.zip': 'application/zip', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm',
  } as Record<string, string>)[ext] || 'application/octet-stream'
}

/**
 * 증적 파일을 이슈 코멘트용으로 올린다. GitLab 만 업로드, GitHub 는 null (호출 측이 IVE 링크로 대신한다).
 * @returns 코멘트에 넣을 마크다운(이미지면 ![]()), 실패하면 null
 */
export async function uploadEvidenceFile(project: Project, token: string, absPath: string, displayName?: string): Promise<{ markdown: string; url: string } | null> {
  if (project.provider === 'github') return null
  try {
    const buf = fs.readFileSync(absPath)
    const name = displayName || path.basename(absPath)
    return await uploadIssueAttachment(project, token, name, buf, evidenceMime(absPath))
  } catch {
    return null
  }
}
