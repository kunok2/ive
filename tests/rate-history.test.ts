/**
 * 단가 이력 (유효일자).
 *
 * 보고서는 "지금 단가"가 아니라 그 실행이 일어난 시점의 단가로 계산해야 한다.
 * 이력이 없으면 월급이나 구독료를 한 번 바꾸는 순간 과거 보고서가 전부 소급 변경된다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../src/lib/db/schema'
import { RateTimeline, type RateRow } from '../src/lib/db/rate-history'

const EPOCH = '1970-01-01T00:00:00.000Z'

describe('RateTimeline — 시점별 단가 해석', () => {
  const rows: RateRow[] = [
    { kind: 'human', key: '', inputPrice: 1000, outputPrice: 0, meta: { daysPerWeek: 5, hoursPerDay: 8 }, effectiveFrom: EPOCH },
    { kind: 'human', key: '', inputPrice: 2000, outputPrice: 0, meta: { daysPerWeek: 5, hoursPerDay: 8 }, effectiveFrom: '2026-06-01T00:00:00.000Z' },
    { kind: 'ai_subscription', key: 'claude', inputPrice: 20, outputPrice: 0, meta: null, effectiveFrom: '2026-03-01T00:00:00.000Z' },
    { kind: 'ai_subscription', key: 'claude', inputPrice: 200, outputPrice: 0, meta: null, effectiveFrom: '2026-07-01T00:00:00.000Z' },
  ]
  const tl = new RateTimeline(rows)

  it('그 시점에 유효했던 값을 고른다 (최근 것이 아니라)', () => {
    expect(tl.resolve('human', '', '2026-05-31T23:59:59.000Z')?.inputPrice).toBe(1000)
    expect(tl.resolve('human', '', '2026-06-01T00:00:00.000Z')?.inputPrice).toBe(2000)
    expect(tl.resolve('human', '', '2026-08-20T00:00:00.000Z')?.inputPrice).toBe(2000)
  })

  it('요금제를 올려도 과거 구간은 옛 요금으로 남는다', () => {
    // Max 로 올리기 전(3~6월)은 $20 로 계산되어야 한다.
    expect(tl.resolve('ai_subscription', 'claude', '2026-05-10T00:00:00.000Z')?.inputPrice).toBe(20)
    expect(tl.resolve('ai_subscription', 'claude', '2026-08-10T00:00:00.000Z')?.inputPrice).toBe(200)
  })

  it('첫 유효 시각보다 이전이면 null', () => {
    expect(tl.resolve('ai_subscription', 'claude', '2026-02-01T00:00:00.000Z')).toBeNull()
  })

  it('meta 를 함께 돌려준다 (근무일정)', () => {
    expect(tl.resolve('human', '', '2026-08-01T00:00:00.000Z')?.meta).toEqual({ daysPerWeek: 5, hoursPerDay: 8 })
  })

  it('없는 key 는 null', () => {
    expect(tl.resolve('ai_subscription', 'gemini', '2026-08-01T00:00:00.000Z')).toBeNull()
  })
})

describe('백필 마이그레이션 — 이력 도입 이전 단가를 EPOCH 로 심는다', () => {
  let db: Database.Database
  beforeEach(() => { db = new Database(':memory:') })
  afterEach(() => { db.close() })

  it('기존 단가·배수가 EPOCH 유효로 심겨 과거 보고서가 0원이 되지 않는다', () => {
    initSchema(db)   // 1회차: 아직 단가 데이터가 없어 심을 게 없다
    db.exec(`DELETE FROM rate_history;`)
    db.prepare("INSERT OR REPLACE INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at) VALUES ('tp-human','human','관리자 (월급 USD)',1985.38,0,'2026-08-20')").run()
    db.prepare("INSERT OR REPLACE INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at) VALUES ('tp-opus','model','Claude Opus 4',15,75,'2026-08-20')").run()
    db.prepare("INSERT OR REPLACE INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at) VALUES ('tp-sub-claude','claude','subscription (claude)',200,0,'2026-08-20')").run()
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('human.daysPerWeek','5') ON CONFLICT(key) DO UPDATE SET value='5'").run()

    initSchema(db)   // 2회차: 백필이 돈다

    const rows = db.prepare('SELECT kind, key, input_price, output_price, meta, effective_from FROM rate_history ORDER BY kind, key').all() as any[]
    const byKind = Object.fromEntries(rows.map(r => [`${r.kind}:${r.key}`, r]))

    expect(byKind['human:'].input_price).toBe(1985.38)
    expect(JSON.parse(byKind['human:'].meta)).toEqual({ daysPerWeek: 5, hoursPerDay: 8 })
    expect(byKind['model:Claude Opus 4'].output_price).toBe(75)
    expect(byKind['ai_subscription:claude'].input_price).toBe(200)   // 구독 행은 model 로 새지 않는다
    expect(rows.every(r => r.effective_from === EPOCH)).toBe(true)

    // 관리자 계정의 배수도 함께 심긴다
    expect(rows.some(r => r.kind === 'multiplier')).toBe(true)
  })

  it('이미 이력이 있으면 다시 심지 않는다 (멱등)', () => {
    initSchema(db)
    db.prepare("INSERT OR REPLACE INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at) VALUES ('tp-opus','model','Claude Opus 4',15,75,'2026-08-20')").run()
    initSchema(db)
    const n1 = (db.prepare('SELECT COUNT(*) c FROM rate_history').get() as any).c
    initSchema(db)
    const n2 = (db.prepare('SELECT COUNT(*) c FROM rate_history').get() as any).c
    expect(n2).toBe(n1)
  })
})
