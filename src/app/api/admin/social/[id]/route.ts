import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSocialPost, deleteSocialPost } from '@/lib/db'
import { resolveRedirectBase } from '@/lib/oauth'
import { logActivity } from '@/lib/activity'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const post = getSocialPost(id)
  if (!post) return NextResponse.json({ error: 'Not Found' }, { status: 404 })

  const base = resolveRedirectBase(req)
  return NextResponse.json({
    post: {
      ...post,
      links: post.links.map(l => ({ ...l, url: `${base}/api/social/click?l=${l.id}` })),
    },
  })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const existing = getSocialPost(id)
  deleteSocialPost(id)
  logActivity({
    userId: user.id,
    category: 'admin',
    action: 'delete_social_post',
    detail: `SNS 홍보글 삭제: "${existing?.title || id}"`,
    targetType: 'social_post',
    targetId: id,
    req,
  })
  return NextResponse.json({ ok: true })
}
