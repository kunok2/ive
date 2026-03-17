import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getAllUsers } from '@/lib/db'
import nodemailer from 'nodemailer'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { subject, body, userIds } = await req.json()
  if (!subject || !body) {
    return NextResponse.json({ error: '제목과 내용을 입력해주세요' }, { status: 400 })
  }

  const allUsers = getAllUsers()
  // userIds가 있으면 선택된 사용자만, 없으면 전체
  const targets = userIds?.length
    ? allUsers.filter(u => userIds.includes(u.id))
    : allUsers

  if (targets.length === 0) {
    return NextResponse.json({ error: '발송 대상이 없습니다' }, { status: 400 })
  }

  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.MAIL_SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_SMTP_NAME,
      pass: process.env.MAIL_SMTP_PASSWORD,
    },
  })

  const fromName = process.env.MAIL_FROM_ADDRESS || 'IVE'
  const domain = process.env.MAIL_DOMAIN
  const smtpName = process.env.MAIL_SMTP_NAME
  const fromAddr = fromName.includes('@') ? fromName : domain ? `${fromName}@${domain}` : smtpName || fromName

  let sent = 0
  let failed = 0
  for (const target of targets) {
    try {
      await transporter.sendMail({
        from: `"Spring IVE" <${fromAddr}>`,
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
