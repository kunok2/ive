import { getDb } from './connection'

/**
 * SNS 홍보 게시글 + 채널별 추적 링크 + 클릭/전환 기록.
 * 메일과 동일한 "추적 링크 → 유입(클릭) → 전환(가입/로그인)" 퍼널을 SNS(공개·익명)에 맞춰 구현한다.
 *  - 메일은 수신자별 링크라 '누가' 클릭했는지 알지만, SNS는 공개 링크라 익명 방문자(쿠키/IP) 기준이다.
 *  - 전환은 방문자 쿠키로 클릭과 이후 가입/로그인을 연결해 측정한다.
 */

export interface SocialPostLink {
  id: string        // 추적 링크 식별자(= 추적 URL에 들어가는 값). 추측 불가능한 랜덤.
  postId: string
  channel: string   // 'x' | 'linkedin' | 'facebook' | 'instagram' | 'threads' | 'youtube' | 'blog' | 'etc' 등
  postedUrl: string | null
  postedAt: string | null
  createdAt: string
}

export interface SocialPost {
  id: string
  title: string
  body: string
  createdByUserId: string | null
  status: string    // 'draft' | 'posted'
  note: string
  createdAt: string
  links: SocialPostLink[]
}

export interface SocialPostSummary {
  id: string
  title: string
  status: string
  createdAt: string
  channelCount: number
  clickCount: number
  visitorCount: number
  conversionCount: number
}

export interface SocialChannelStat {
  channel: string
  clicks: number
  visitors: number
  conversions: number
}

function rid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function mapLink(r: any): SocialPostLink {
  return { id: r.id, postId: r.post_id, channel: r.channel, postedUrl: r.posted_url ?? null, postedAt: r.posted_at ?? null, createdAt: r.created_at }
}

/** 게시글 + 선택 채널별 추적 링크를 생성한다. */
export function createSocialPost(input: { title: string; body: string; createdByUserId: string | null; channels: string[] }): SocialPost {
  const db = getDb()
  const id = rid('sp')
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO social_posts (id, title, body, created_by_user_id, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.title, input.body, input.createdByUserId, 'draft', '', createdAt)
  const channels = input.channels.length ? input.channels : ['etc']
  const ins = db.prepare('INSERT INTO social_post_links (id, post_id, channel, created_at) VALUES (?, ?, ?, ?)')
  const links: SocialPostLink[] = []
  for (const ch of channels) {
    const linkId = rid('spl')
    ins.run(linkId, id, ch, createdAt)
    links.push({ id: linkId, postId: id, channel: ch, postedUrl: null, postedAt: null, createdAt })
  }
  return { id, title: input.title, body: input.body, createdByUserId: input.createdByUserId, status: 'draft', note: '', createdAt, links }
}

export function getSocialPost(id: string): SocialPost | null {
  const r = getDb().prepare('SELECT * FROM social_posts WHERE id = ?').get(id) as any
  if (!r) return null
  const links = (getDb().prepare('SELECT * FROM social_post_links WHERE post_id = ? ORDER BY created_at ASC').all(id) as any[]).map(mapLink)
  return { id: r.id, title: r.title, body: r.body, createdByUserId: r.created_by_user_id ?? null, status: r.status, note: r.note ?? '', createdAt: r.created_at, links }
}

export function deleteSocialPost(id: string) {
  const db = getDb()
  db.prepare('DELETE FROM social_clicks WHERE post_id = ?').run(id)
  db.prepare('DELETE FROM social_post_links WHERE post_id = ?').run(id)
  db.prepare('DELETE FROM social_posts WHERE id = ?').run(id)
}

export function getSocialPostCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM social_posts').get() as any).c
}

export function getSocialPosts(limit = 50, offset = 0): SocialPostSummary[] {
  const rows = getDb().prepare('SELECT * FROM social_posts ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[]
  if (rows.length === 0) return []
  const ids = rows.map(r => r.id)
  const ph = ids.map(() => '?').join(',')
  const chRows = getDb().prepare(`SELECT post_id AS id, COUNT(*) AS c FROM social_post_links WHERE post_id IN (${ph}) GROUP BY post_id`).all(...ids) as any[]
  const clickRows = getDb().prepare(`
    SELECT post_id AS id,
           COUNT(*) AS clicks,
           COUNT(DISTINCT COALESCE(visitor_id, ip_address, id)) AS visitors,
           COUNT(DISTINCT converted_user_id) AS conversions
    FROM social_clicks WHERE post_id IN (${ph}) GROUP BY post_id
  `).all(...ids) as any[]
  const chMap = new Map(chRows.map(r => [r.id, r.c]))
  const clickMap = new Map(clickRows.map(r => [r.id, r]))
  return rows.map(r => {
    const c = clickMap.get(r.id)
    return {
      id: r.id, title: r.title, status: r.status, createdAt: r.created_at,
      channelCount: chMap.get(r.id) ?? 0,
      clickCount: c?.clicks ?? 0,
      visitorCount: c?.visitors ?? 0,
      conversionCount: c?.conversions ?? 0,
    }
  })
}

/** 추적 링크 식별자로 링크(채널·소속 글) 조회 — 클릭 엔드포인트용 */
export function getSocialPostLink(linkId: string): { id: string; postId: string; channel: string } | null {
  const r = getDb().prepare('SELECT id, post_id, channel FROM social_post_links WHERE id = ?').get(linkId) as any
  return r ? { id: r.id, postId: r.post_id, channel: r.channel } : null
}

/** SNS 추적 링크 클릭 1건 기록 */
export function recordSocialClick(click: { linkId: string; postId: string; channel: string; visitorId?: string | null; ip?: string | null; userAgent?: string | null; referrer?: string | null }) {
  getDb().prepare(`
    INSERT INTO social_clicks (id, post_id, link_id, channel, visitor_id, ip_address, user_agent, referrer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rid('sc'), click.postId, click.linkId, click.channel, click.visitorId ?? null, click.ip ?? null, click.userAgent ?? null, click.referrer ?? null)
}

/**
 * 방문자(visitorId)의 가장 최근 미전환 클릭을 이 사용자로 전환 귀속(last-touch).
 * 클릭→가입/로그인 사이를 잇는다. 미전환 클릭이 없으면 아무것도 하지 않는다.
 */
export function attributeSocialConversion(visitorId: string, userId: string, type: 'register' | 'login') {
  if (!visitorId) return
  const row = getDb().prepare('SELECT id FROM social_clicks WHERE visitor_id = ? AND converted_user_id IS NULL ORDER BY clicked_at DESC LIMIT 1').get(visitorId) as any
  if (!row) return
  getDb().prepare("UPDATE social_clicks SET converted_user_id = ?, conversion_type = ?, converted_at = datetime('now') WHERE id = ?")
    .run(userId, type, row.id)
}

/** 단일 게시글의 채널별 통계 + 합계 */
export function getSocialPostStats(postId: string): { channels: SocialChannelStat[]; totalClicks: number; totalVisitors: number; totalConversions: number } {
  // 채널 목록(클릭 0인 채널도 표에 보이도록 links 기준 LEFT JOIN)
  const rows = getDb().prepare(`
    SELECT l.channel AS channel,
           COUNT(c.id) AS clicks,
           COUNT(DISTINCT COALESCE(c.visitor_id, c.ip_address, c.id)) AS visitors,
           COUNT(DISTINCT c.converted_user_id) AS conversions
    FROM social_post_links l
    LEFT JOIN social_clicks c ON c.link_id = l.id
    WHERE l.post_id = ?
    GROUP BY l.channel
    ORDER BY clicks DESC
  `).all(postId) as any[]
  const channels: SocialChannelStat[] = rows.map(r => ({ channel: r.channel, clicks: r.clicks ?? 0, visitors: r.visitors ?? 0, conversions: r.conversions ?? 0 }))
  // 합계는 전체 클릭 기준(채널 합산은 고유/전환이 중복될 수 있어 post 전체로 재집계)
  const tot = getDb().prepare(`
    SELECT COUNT(*) AS clicks,
           COUNT(DISTINCT COALESCE(visitor_id, ip_address, id)) AS visitors,
           COUNT(DISTINCT converted_user_id) AS conversions
    FROM social_clicks WHERE post_id = ?
  `).get(postId) as any
  return { channels, totalClicks: tot?.clicks ?? 0, totalVisitors: tot?.visitors ?? 0, totalConversions: tot?.conversions ?? 0 }
}
