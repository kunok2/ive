import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getVerifierQueue } from '@/lib/db'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { username } = await params
  const decoded = decodeURIComponent(username)
  const r = new URL(req.url).searchParams.get('role')
  const role = r === 'confirm' ? 'confirm' : r === 'process' ? 'process' : 'verify'
  const queue = getVerifierQueue(user.id, decoded, role)
  return NextResponse.json({ count: queue.length, items: queue })
}
