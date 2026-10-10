/**
 * 확인 규약 — 확인자는 증상을 재현해 사라졌음을 증거로 증명한다.
 *   C-1: 증상이 남은 항목(present)이 하나라도 있으면 fail(재처리) — 에이전트가 pass 라 해도
 *   C-2: 증거 없는 pass 는 blocked(사람 확인) — 스크린샷 0장, 항목 없음, 증거 없는/확인 못 한 항목
 *   C-3: 모든 항목이 gone + 증거 + 스크린샷이 있으면 pass 그대로
 *   C-4: result.json 의 items 해석 — 모르는 result 는 unverified
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { enforceConfirmVerdict, parseResult, type ConfirmResult } from '@/lib/scanner/confirm-worker'

const base: ConfirmResult = { verdict: 'pass', summary: 's', reason: '', items: [], engines: [], screenshots: [], commands: [], newDefects: [] }
const gone = { item: '버튼 겹침', how: '393px', result: 'gone' as const, evidence: ['screens/after-a.png'] }

describe('enforceConfirmVerdict', () => {
  it('C-1: 증상이 남으면 fail', () => {
    const r = enforceConfirmVerdict({ ...base, items: [gone, { ...gone, item: 'b', result: 'present' }] }, 2)
    expect(r).toMatchObject({ verdict: 'fail', reason: expect.stringMatching(/증상이 남은 항목 1개/) })
  })
  it('C-2: 증거 없는 pass 는 blocked', () => {
    expect(enforceConfirmVerdict({ ...base, items: [gone] }, 0)).toMatchObject({ verdict: 'blocked', reason: expect.stringMatching(/스크린샷이 없습니다/) })
    expect(enforceConfirmVerdict(base, 1)).toMatchObject({ verdict: 'blocked', reason: expect.stringMatching(/항목을 남기지 않았습니다/) })
    expect(enforceConfirmVerdict({ ...base, items: [gone, { ...gone, evidence: [] }] }, 1)).toMatchObject({ verdict: 'blocked', reason: expect.stringMatching(/증거로 보이지 못한 항목 1개/) })
    expect(enforceConfirmVerdict({ ...base, items: [{ ...gone, result: 'unverified' }] }, 1).verdict).toBe('blocked')
  })
  it('C-3: 다 증명되면 pass', () => {
    expect(enforceConfirmVerdict({ ...base, items: [gone] }, 1).verdict).toBe('pass')
    expect(enforceConfirmVerdict({ ...base, verdict: 'blocked', reason: '로그인 불가' }, 0).verdict).toBe('blocked')
  })
  it('C-4: items 해석', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-'))
    fs.mkdirSync(path.join(ws, '.ive-out'))
    fs.writeFileSync(path.join(ws, '.ive-out', 'result.json'), JSON.stringify({ verdict: 'pass', items: [{ item: 'a', result: 'GONE', evidence: ['x.png'] }, { item: 'b', result: '?' }, { item: '' }] }))
    const log = path.join(ws, 'log'); fs.writeFileSync(log, '')
    expect(parseResult(ws, log).items).toEqual([
      { item: 'a', how: '', result: 'gone', evidence: ['x.png'] },
      { item: 'b', how: '', result: 'unverified', evidence: [] },
    ])
  })
})
