import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createMailBroadcastLog, getAllUsers } from '@/lib/db'
import { createTransporter, getFromAddress } from '@/lib/mail'
import { renderMailTemplate, makeUnsubscribeToken, unsubscribeFooterHtml, makeClickToken, accessButtonHtml } from '@/lib/mail-broadcast'
import crypto from 'crypto'
import { resolveRedirectBase } from '@/lib/oauth'
import { logActivity } from '@/lib/activity'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { subject, body, userIds } = await req.json()
  if (!subject || !body) {
    return NextResponse.json({ error: '제목과 내용을 입력해주세요' }, { status: 400 })
  }

  const allUsers = getAllUsers()
  const selected = userIds?.length
    ? allUsers.filter(u => userIds.includes(u.id))
    : allUsers

  // 수신거부한 사용자는 명시적으로 선택했더라도 항상 제외한다.
  const targets = selected.filter(u => !u.mailUnsubscribed)
  const skipped = selected.length - targets.length

  if (targets.length === 0) {
    return NextResponse.json({ error: '발송 대상이 없습니다', skipped }, { status: 400 })
  }

  const transporter = createTransporter()
  const fromAddr = getFromAddress()
  const baseUrl = resolveRedirectBase(req)
  // 발송이력 id를 미리 만들어 추적 링크에 심는다(접속 클릭이 이 발송에 귀속되도록).
  const logId = crypto.randomUUID ? crypto.randomUUID() : `mbl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let sent = 0
  let failed = 0
  const failedRecipients: { email: string; error?: string }[] = []
  const recipientEmails: string[] = targets.map(t => t.email)

  for (const target of targets) {
    try {
      // 추적 가능한 IVE 접속 링크 + 개인화 태그 치환 + 수신거부 링크 푸터.
      const accessUrl = `${baseUrl}/api/mail/click?t=${encodeURIComponent(makeClickToken(logId, target.id))}`
      const vars = { name: target.name, email: target.email, link: accessUrl }
      const renderedSubject = renderMailTemplate(subject, vars)
      const unsubUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(makeUnsubscribeToken(target.id))}`
      const renderedBody = renderMailTemplate(body, vars)
        + accessButtonHtml(accessUrl, target.locale)
        + unsubscribeFooterHtml(unsubUrl, target.locale)
      await transporter.sendMail({
        from: `"Springware IVE" <${fromAddr}>`,
        to: target.email,
        subject: renderedSubject,
        html: renderedBody,
      })
      sent++
    } catch (err) {
      console.error(`[admin/mail] 발송 실패 (${target.email}):`, err)
      failed++
      failedRecipients.push({ email: target.email, error: err instanceof Error ? err.message : String(err) })
    }
  }

  let savedLogId: string | undefined
  try {
    const saved = createMailBroadcastLog({
      id: logId,
      senderUserId: user.id,
      senderName: user.name,
      senderEmail: user.email,
      subject,
      body,
      recipientEmails,
      totalCount: targets.length,
      sentCount: sent,
      failedCount: failed,
      failedRecipients,
    })
    savedLogId = saved.id
  } catch (e) {
    console.error('[admin/mail] 발송이력 기록 실패:', e)
  }

  logActivity({
    userId: user.id,
    category: 'admin',
    action: 'send_mail',
    detail: `메일 발송: "${subject}" — 대상 ${targets.length}명, 성공 ${sent}건${failed > 0 ? `, 실패 ${failed}건` : ''}${skipped > 0 ? `, 수신거부 제외 ${skipped}명` : ''}`,
    targetType: 'mail_broadcast',
    targetId: savedLogId,
    req,
  })

  return NextResponse.json({ sent, failed, total: targets.length, skipped })
}
