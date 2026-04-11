import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getVerifiersList } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const verifiers = getVerifiersList(user.id)
  return NextResponse.json(verifiers)
}
