import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllTokenPricing, upsertTokenPricing } from '@/lib/db'
import { applyLatestPricing } from '@/lib/token-pricing'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(getAllTokenPricing())
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const items = body.items as { cliName: string; modelName: string; inputPrice: number; outputPrice: number }[]
  if (!Array.isArray(items)) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const now = new Date().toISOString()
  for (const item of items) {
    upsertTokenPricing({
      id: `tp-${item.cliName}`,
      cliName: item.cliName,
      modelName: item.modelName,
      inputPrice: item.inputPrice,
      outputPrice: item.outputPrice,
      updatedAt: now,
    })
  }
  return NextResponse.json(getAllTokenPricing())
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (body.action === 'auto-fetch') {
    const updated = applyLatestPricing()
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
