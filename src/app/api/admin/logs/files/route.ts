import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { getCurrentConfig, getLogger } from '@/lib/logger'

const LOG_NAME_RE = /^[A-Za-z0-9._-]+\.log$/

/**
 * GET ?file=<name>&tail=<n>
 *   tail: optional, return the last N lines (default 1000, max 10000)
 *   no file param → returns 400. Use /api/admin/logs to list.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const file = url.searchParams.get('file') || ''
  const tailRaw = Number(url.searchParams.get('tail') ?? '1000')
  const tail = Math.max(1, Math.min(Number.isFinite(tailRaw) ? tailRaw : 1000, 10000))

  if (!LOG_NAME_RE.test(file)) {
    return NextResponse.json({ error: 'invalid file name' }, { status: 400 })
  }

  const dir = getCurrentConfig().dir
  const full = path.join(dir, file)
  // Defense-in-depth: ensure the resolved path is still inside dir.
  const resolved = path.resolve(full)
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const content = fs.readFileSync(resolved, 'utf8')
    const lines = content.split('\n')
    const slice = lines.slice(-tail).join('\n')
    return new NextResponse(slice, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (e) {
    getLogger('admin/logs').error('failed to read log file', { file, err: String(e) })
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
}
