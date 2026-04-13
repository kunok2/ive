import { TokenPricing } from '@/types'
import { getDb } from './connection'

// ── Token Pricing ──

function mapPricing(r: any): TokenPricing {
  return {
    id: r.id, cliName: r.cli_name, modelName: r.model_name,
    inputPrice: r.input_price, outputPrice: r.output_price,
    updatedAt: r.updated_at,
  }
}

export function getAllTokenPricing(): TokenPricing[] {
  return (getDb().prepare('SELECT * FROM token_pricing ORDER BY cli_name ASC, model_name ASC').all() as any[]).map(mapPricing)
}

export function getTokenPricingByModel(modelName: string): TokenPricing | null {
  const r = getDb().prepare('SELECT * FROM token_pricing WHERE LOWER(model_name) = LOWER(?) LIMIT 1').get(modelName) as any
  return r ? mapPricing(r) : null
}

export function findTokenPricingForModel(executionModelName: string): TokenPricing | null {
  const exact = getTokenPricingByModel(executionModelName)
  if (exact) return exact

  const lower = executionModelName.toLowerCase()
  const all = getAllTokenPricing().filter(p => p.cliName !== 'human')

  const generic = new Set(['claude', 'gemini', 'openai', 'opencode', 'gpt', 'pro', 'the', 'cli'])
  type Match = { pricing: TokenPricing; specificity: number }
  const matches: Match[] = []

  for (const p of all) {
    const keywords = p.modelName.toLowerCase().split(/[\s.\-]+/).filter(k => k.length >= 2)
    const distinctive = keywords.filter(k => !generic.has(k))
    const matched = distinctive.filter(k => lower.includes(k))
    if (matched.length > 0) {
      matches.push({ pricing: p, specificity: matched.length })
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => b.specificity - a.specificity)
    return matches[0].pricing
  }

  return null
}

export function upsertTokenPricing(p: TokenPricing) {
  getDb().prepare(`
    INSERT INTO token_pricing (id, cli_name, model_name, input_price, output_price, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cli_name = excluded.cli_name, model_name = excluded.model_name,
      input_price = excluded.input_price, output_price = excluded.output_price,
      updated_at = excluded.updated_at
  `).run(p.id, p.cliName, p.modelName, p.inputPrice, p.outputPrice, p.updatedAt)
}

export function deleteTokenPricing(id: string) {
  getDb().prepare('DELETE FROM token_pricing WHERE id = ?').run(id)
}

// ── System Settings ──

export function getSystemSetting(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as any
  return r ? r.value : null
}

export function getSystemSettings(prefix?: string): Record<string, string> {
  const rows = prefix
    ? getDb().prepare('SELECT key, value FROM system_settings WHERE key LIKE ?').all(`${prefix}%`) as any[]
    : getDb().prepare('SELECT key, value FROM system_settings').all() as any[]
  const result: Record<string, string> = {}
  for (const r of rows) result[r.key] = r.value
  return result
}

export function setSystemSetting(key: string, value: string) {
  getDb().prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value)
}

export function setSystemSettings(settings: Record<string, string>) {
  const stmt = getDb().prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)
  const tx = getDb().transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      stmt.run(key, value)
    }
  })
  tx()
}
