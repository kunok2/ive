/**
 * 이슈 본문/코멘트의 마크다운/HTML 에서 첨부 이미지 URL을 추출하고,
 * 프로젝트 인증 토큰으로 다운로드해 워크스페이스에 저장한다.
 * 저장 경로를 에이전트(스캐너 CLI)에게 넘겨 이미지를 분석하게 한다.
 */
import fs from 'fs'
import path from 'path'
import { Project } from '@/types'
import { downloadProjectUpload } from '../provider'

const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|heic)(\?|#|$)/i

/** 마크다운 ![](url) 과 <img src> 에서 이미지로 보이는 URL을 추출. */
export function extractImageUrls(text: string): string[] {
  if (!text) return []
  const urls = new Set<string>()
  const md = /!\[[^\]]*\]\(\s*([^)\s]+)/g
  const img = /<img[^>]+src=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = md.exec(text))) urls.add(m[1])
  while ((m = img.exec(text))) urls.add(m[1])
  // 이미지 확장자이거나 업로드 첨부 경로(GitLab /uploads/, GitHub /user-attachments/assets/ — 확장자 없음)인 것만
  return [...urls].filter(u => IMG_EXT_RE.test(u) || /\/uploads\//.test(u) || /\/user-attachments\/assets\//.test(u))
}

/**
 * 여러 텍스트(본문 + 코멘트)에서 이미지 URL을 모아 다운로드 → destDir 저장 → 경로 반환.
 * 실패한 항목은 건너뛴다(작업 자체를 막지 않음).
 */
export async function downloadIssueImages(
  project: Project,
  token: string,
  texts: string[],
  destDir: string,
  log?: (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void,
): Promise<string[]> {
  const urls = [...new Set(texts.flatMap(extractImageUrls))]
  if (urls.length === 0) return []
  try { fs.mkdirSync(destDir, { recursive: true }) } catch { /* ignore */ }
  const saved: string[] = []
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await downloadProjectUpload(project, token, urls[i])
      if (!r) continue
      const ext = (r.contentType.split(';')[0].split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
      const fp = path.join(destDir, `issue-image-${i + 1}.${ext}`)
      fs.writeFileSync(fp, r.buffer)
      saved.push(fp)
    } catch {
      log?.(`첨부 이미지 다운로드 실패: ${urls[i]}`, 'warn')
    }
  }
  if (saved.length > 0) log?.(`첨부 이미지 ${saved.length}장 다운로드 (에이전트 분석용)`, 'system')
  return saved
}
