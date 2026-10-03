/**
 * 메뉴 위치(nav_position) — PC 폭의 주 메뉴를 사용자별로 왼쪽·오른쪽·아래에 둔다.
 *   N-1: 마이그레이션이 users.nav_position 을 더하고, 값이 없으면 'top'(상단바 가운데)
 *   N-2: 저장한 값이 그대로 읽힌다(left·right·bottom), 모르는 값은 'top'
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@/lib/db/schema'
import { getUserById, updateUserNavPosition } from '@/lib/db'

beforeEach(() => {
  const d = new Database(':memory:')
  initSchema(d)
  d.prepare(`INSERT INTO users (id, email, password, name) VALUES ('u1', 'a@x', '', 'A')`).run()
  global.db = d
})
afterEach(() => { global.db?.close(); global.db = undefined })

describe('nav_position', () => {
  it('N-1: 기본은 위', () => {
    expect(getUserById('u1')!.navPosition).toBe('top')
  })
  it('N-2: 왼쪽·오른쪽·아래 저장, 모르는 값은 위', () => {
    updateUserNavPosition('u1', 'left')
    expect(getUserById('u1')!.navPosition).toBe('left')
    updateUserNavPosition('u1', 'right')
    expect(getUserById('u1')!.navPosition).toBe('right')
    updateUserNavPosition('u1', 'bottom')
    expect(getUserById('u1')!.navPosition).toBe('bottom')
    global.db!.prepare(`UPDATE users SET nav_position = 'middle' WHERE id = 'u1'`).run()
    expect(getUserById('u1')!.navPosition).toBe('top')
  })
})
