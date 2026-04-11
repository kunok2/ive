import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getVerifierQueue } from '@/lib/db'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { username } = await params
  const decoded = decodeURIComponent(username)
  const queue = getVerifierQueue(user.id, decoded)
  return NextResponse.json({ count: queue.length, items: queue })
}
