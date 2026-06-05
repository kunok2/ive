import crypto from 'crypto'

/**
 * 브로드캐스트(관리자 일괄) 메일 전용 헬퍼.
 *  - 개인화 태그 치환 ({{name}}, {{email}})
 *  - 수신거부(unsubscribe) 서명 토큰 생성/검증 — 비로그인 링크 인증용
 *  - 메일 하단 수신거부 안내 푸터 HTML
 *
 * 인증코드 등 시스템 트랜잭션 메일과는 무관하며, 관리자 발송에만 적용된다.
 */

const SECRET = process.env.JWT_SECRET || 'springware-ive-dev-secret-change-in-production'

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(userId: string): string {
  return b64url(crypto.createHmac('sha256', SECRET).update(`unsub:${userId}`).digest())
}

/** 수신거부 토큰 생성 — `<b64url(userId)>.<b64url(hmac)>` */
export function makeUnsubscribeToken(userId: string): string {
  return `${b64url(userId)}.${sign(userId)}`
}

/** 수신거부 토큰 검증 — 유효하면 userId, 아니면 null. (서명 비교는 timing-safe) */
export function verifyUnsubscribeToken(token: string): string | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [idPart, sigPart] = token.split('.')
  if (!idPart || !sigPart) return null
  let userId: string
  try {
    userId = fromB64url(idPart).toString('utf8')
  } catch {
    return null
  }
  if (!userId) return null
  const expected = sign(userId)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  return crypto.timingSafeEqual(a, b) ? userId : null
}

/** UI/문서에 노출할 지원 태그 목록 */
export const MAIL_TEMPLATE_TAGS = ['name', 'email'] as const

/**
 * 개인화 태그 치환. `{{name}}`, `{{ name }}` 등 공백 허용, 대소문자 무시.
 * 알 수 없는 태그는 그대로 둔다(의도치 않은 내용 삭제 방지).
 */
export function renderMailTemplate(text: string, vars: { name: string; email: string }): string {
  if (!text) return text
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key: string) => {
    const k = key.toLowerCase()
    if (k === 'name') return escapeHtml(vars.name)
    if (k === 'email') return escapeHtml(vars.email)
    return full
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const FOOTER_TEXT: Record<string, { note: string; link: string }> = {
  ko: {
    note: '이 메일은 Springware IVE에 가입하신 주소로 발송되었습니다.',
    link: '수신거부',
  },
  en: {
    note: 'This email was sent to the address registered with Springware IVE.',
    link: 'Unsubscribe',
  },
}

/** 메일 하단 수신거부 안내 푸터 HTML (수신자 locale 기준, 기본 ko) */
export function unsubscribeFooterHtml(unsubscribeUrl: string, locale?: string): string {
  const t = FOOTER_TEXT[locale === 'en' ? 'en' : 'ko']
  return (
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;` +
    `font-family:sans-serif;font-size:12px;color:#999;line-height:1.6;">` +
    `<p style="margin:0 0 4px;">${t.note}</p>` +
    `<p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#888;text-decoration:underline;">${t.link}</a></p>` +
    `</div>`
  )
}
