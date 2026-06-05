import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createMailDraft, getMailDrafts } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ drafts: getMailDrafts() })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { subject, body, targetUserIds } = await req.json()
  const draft = createMailDraft({
    subject: String(subject || ''),
    body: String(body || ''),
    targetUserIds: Array.isArray(targetUserIds) ? targetUserIds.filter(Boolean) : [],
    createdByUserId: user.id,
  })
  return NextResponse.json({ draft }, { status: 201 })
}
