import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { updateUserCurrency } from '@/lib/db'
import { isSupportedCurrency } from '@/lib/currency'
import { resolveUserCurrency, refreshSingleRate, getCachedRate } from '@/lib/currency-server'
import { logActivity } from '@/lib/activity'

// 현재 사용자 기준 해석된 표시 통화/환율 반환 (보고서가 이것만 읽어 즉시 렌더)
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(resolveUserCurrency(user))
}

// 사용자 표시 통화 + 수동 환율 설정
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { currency, rate } = body as { currency?: string | null; rate?: number | string | null }

  // 통화 코드 검증 (USD/null = 환산 안 함)
  let code: string | null = null
  if (currency && currency !== 'USD') {
    if (!isSupportedCurrency(currency)) {
      return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
    }
    code = currency
  }

  // 수동 환율 검증 (빈 값/0/음수 → null = 자동 사용)
  let manualRate: number | null = null
  if (rate !== undefined && rate !== null && rate !== '') {
    const r = typeof rate === 'number' ? rate : parseFloat(String(rate))
    if (!isFinite(r) || r <= 0) {
      return NextResponse.json({ error: 'Invalid rate' }, { status: 400 })
    }
    manualRate = r
  }

  updateUserCurrency(user.id, code, code ? manualRate : null)
  logActivity({ userId: user.id, category: 'settings', action: 'update_currency', detail: `표시 통화: ${code ?? 'USD'}${manualRate ? ` (수동 ${manualRate})` : ''}`, req })

  // 갱신된 사용자 기준으로 다시 해석해 반환
  return NextResponse.json(resolveUserCurrency({ currency: code, currencyRate: code ? manualRate : null }))
}

// 자동 환율 즉시 갱신 ("지금 갱신")
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { currency } = body as { currency?: string }
  if (!currency || !isSupportedCurrency(currency) || currency === 'USD') {
    return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
  }

  const result = await refreshSingleRate(currency)
  if (!result) {
    // fetch 실패 — 기존 캐시 반환(있으면)
    const cached = getCachedRate(currency)
    return NextResponse.json({ ok: false, cached, error: 'fetch_failed' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, ...result })
}
