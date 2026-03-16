import { NextResponse } from 'next/server'
import { updateProjectSortOrders } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function PUT(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orders } = await req.json() as { orders: { id: string; sortOrder: number }[] }
  if (!Array.isArray(orders)) {
    return NextResponse.json({ error: 'Invalid orders' }, { status: 400 })
  }

  updateProjectSortOrders(user.id, orders)
  return NextResponse.json({ success: true })
}
