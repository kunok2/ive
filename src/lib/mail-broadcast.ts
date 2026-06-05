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

function signPayload(prefix: string, payload: string): string {
  return b64url(crypto.createHmac('sha256', SECRET).update(`${prefix}:${payload}`).digest())
}

/**
 * IVE 접속 추적 토큰 — 발송(logId)과 수신자(userId)를 함께 서명한다.
 * 형식: `<b64url(logId|userId)>.<b64url(hmac)>`
 */
export function makeClickToken(logId: string, userId: string): string {
  const payload = `${logId}|${userId}`
  return `${b64url(payload)}.${signPayload('click', payload)}`
}

/** 접속 추적 토큰 검증 — 유효하면 {logId, userId}, 아니면 null. (timing-safe) */
export function verifyClickToken(token: string): { logId: string; userId: string } | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [payloadPart, sigPart] = token.split('.')
  if (!payloadPart || !sigPart) return null
  let payload: string
  try {
    payload = fromB64url(payloadPart).toString('utf8')
  } catch {
    return null
  }
  const sep = payload.indexOf('|')
  if (sep < 0) return null
  const logId = payload.slice(0, sep)
  const userId = payload.slice(sep + 1)
  if (!logId || !userId) return null
  const expected = signPayload('click', payload)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  return crypto.timingSafeEqual(a, b) ? { logId, userId } : null
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
export const MAIL_TEMPLATE_TAGS = ['name', 'email', 'link'] as const

/**
 * 개인화 태그 치환. `{{name}}`, `{{ name }}` 등 공백 허용, 대소문자 무시.
 *  - name/email: 수신자 값(HTML 이스케이프)
 *  - link: 추적 가능한 IVE 접속 URL(우리가 생성한 안전한 값이라 이스케이프하지 않음)
 * 알 수 없는 태그는 그대로 둔다(의도치 않은 내용 삭제 방지).
 */
export function renderMailTemplate(text: string, vars: { name: string; email: string; link?: string }): string {
  if (!text) return text
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key: string) => {
    const k = key.toLowerCase()
    if (k === 'name') return escapeHtml(vars.name)
    if (k === 'email') return escapeHtml(vars.email)
    if (k === 'link') return vars.link ?? full
    return full
  })
}

const ACCESS_BUTTON_TEXT: Record<string, string> = {
  ko: 'IVE 접속하기',
  en: 'Open IVE',
}

/** 메일 본문 하단의 'IVE 접속하기' 버튼 HTML (추적 링크). 수신자 locale 기준, 기본 ko */
export function accessButtonHtml(accessUrl: string, locale?: string): string {
  const label = ACCESS_BUTTON_TEXT[locale === 'en' ? 'en' : 'ko']
  return (
    `<div style="margin-top:28px;text-align:center;">` +
    `<a href="${accessUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;` +
    `font-family:sans-serif;font-size:14px;font-weight:bold;text-decoration:none;` +
    `padding:11px 28px;border-radius:8px;">${label}</a>` +
    `</div>`
  )
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
