import { NextResponse } from 'next/server'
import { clearAuthCookie, getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (user) {
    logActivity({ userId: user.id, category: 'auth', action: 'logout', detail: '로그아웃', req })
  }
  await clearAuthCookie()
  return NextResponse.json({ success: true })
}
