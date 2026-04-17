import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllUsers } from '@/lib/db'
import { createTransporter, getFromAddress } from '@/lib/mail'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { subject, body, userIds } = await req.json()
  if (!subject || !body) {
    return NextResponse.json({ error: '제목과 내용을 입력해주세요' }, { status: 400 })
  }

  const allUsers = getAllUsers()
  const targets = userIds?.length
    ? allUsers.filter(u => userIds.includes(u.id))
    : allUsers

  if (targets.length === 0) {
    return NextResponse.json({ error: '발송 대상이 없습니다' }, { status: 400 })
  }

  const transporter = createTransporter()
  const fromAddr = getFromAddress()

  let sent = 0
  let failed = 0
  for (const target of targets) {
    try {
      await transporter.sendMail({
        from: `"Springware IVE" <${fromAddr}>`,
        to: target.email,
        subject,
        html: body,
      })
      sent++
    } catch (err) {
      console.error(`[admin/mail] 발송 실패 (${target.email}):`, err)
      failed++
    }
  }

  return NextResponse.json({ sent, failed, total: targets.length })
}
