import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createTransporter, getFromAddress } from '@/lib/mail'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { to } = await req.json()
  if (!to) {
    return NextResponse.json({ error: '수신 주소를 입력해주세요' }, { status: 400 })
  }

  try {
    const transporter = createTransporter()
    const fromAddr = getFromAddress()
    await transporter.sendMail({
      from: `"Spring IVE" <${fromAddr}>`,
      to,
      subject: '[Spring IVE] 메일 설정 테스트',
      html: '<p>메일 설정이 정상적으로 작동합니다.</p><p style="color:#999;font-size:12px;">이 메일은 테스트 발송입니다.</p>',
    })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
