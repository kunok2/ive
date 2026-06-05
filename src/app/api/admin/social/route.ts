import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createSocialPost, getSocialPosts, getSocialPostCount } from '@/lib/db'
import { resolveRedirectBase } from '@/lib/oauth'
import { logActivity } from '@/lib/activity'

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  const offset = Number(searchParams.get('offset')) || 0
  return NextResponse.json({ posts: getSocialPosts(limit, offset), total: getSocialPostCount() })
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, body, channels } = await req.json()
  if (!body || !String(body).trim()) {
    return NextResponse.json({ error: '본문을 입력해주세요' }, { status: 400 })
  }
  const chans: string[] = Array.isArray(channels) ? channels.filter(Boolean) : []
  if (chans.length === 0) {
    return NextResponse.json({ error: '채널을 1개 이상 선택해주세요' }, { status: 400 })
  }

  const post = createSocialPost({
    title: String(title || '').trim(),
    body: String(body),
    createdByUserId: user.id,
    channels: chans,
  })

  logActivity({
    userId: user.id,
    category: 'admin',
    action: 'create_social_post',
    detail: `SNS 홍보글 작성: "${post.title || post.id}" — 채널 ${post.links.length}개`,
    targetType: 'social_post',
    targetId: post.id,
    req,
  })

  const base = resolveRedirectBase(req)
  return NextResponse.json({
    post: {
      ...post,
      links: post.links.map(l => ({ ...l, url: `${base}/api/social/click?l=${l.id}` })),
    },
  }, { status: 201 })
}
