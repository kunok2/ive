/**
 * prepareImageForUpload 단위 테스트 — Slack 인라인 렌더용 이미지 준비.
 *
 * Slack 은 SVG 를 인라인 렌더하지 않으므로(첨부파일로만 보임), 업로드 직전 SVG → PNG 로 변환해야
 * 채팅창에 "그림"으로 보인다. 이 변환을 로컬에서 검증한다(운영 슬랙 없이 확인 가능한 핵심 부분).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prepareImageForUpload } from '@/lib/slack'

function tmpFile(name: string, content: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ive-img-'))
  const p = path.join(dir, name)
  fs.writeFileSync(p, content)
  return p
}

describe('prepareImageForUpload', () => {
  it('SVG 는 PNG 로 변환한다(파일명 .png, PNG 시그니처)', async () => {
    const svg = tmpFile('diagram.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#4ade80"/><text x="10" y="35">IVE</text></svg>')
    const { buffer, filename } = await prepareImageForUpload(svg)
    expect(filename).toBe('diagram.png')
    expect(buffer.subarray(0, 4).toString('hex')).toBe('89504e47') // PNG magic number
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('깨진 SVG(미닫힌 태그)는 변환 실패 시 원본 SVG 로 폴백한다(완전 실패 방지)', async () => {
    // resvg 가 거부하는 잘못된 XML — 운영에서 실제로 난 케이스(<defs> 미닫힘).
    const broken = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><rect/></svg>'
    const svg = tmpFile('bad.svg', broken)
    const { buffer, filename } = await prepareImageForUpload(svg)
    expect(filename).toBe('bad.svg')              // PNG 변환 못 했으니 원본 그대로
    expect(buffer.toString('utf8')).toBe(broken)  // 내용 보존(드롭하지 않음)
  })

  it('PNG 등은 변환 없이 그대로 통과한다', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const png = tmpFile('pic.png', bytes)
    const { buffer, filename } = await prepareImageForUpload(png)
    expect(filename).toBe('pic.png')
    expect(buffer.equals(bytes)).toBe(true)
  })
})
