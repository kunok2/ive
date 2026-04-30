import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { getCurrentConfig, getLogger } from '@/lib/logger'

/** GET — list rotated log files in the configured log dir, newest first. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const cfg = getCurrentConfig()
  const dir = cfg.dir
  let files: { name: string; size: number; mtime: number }[] = []
  try {
    if (fs.existsSync(dir)) {
      files = fs.readdirSync(dir)
        .filter(n => n.endsWith('.log'))
        .map(n => {
          const p = path.join(dir, n)
          const st = fs.statSync(p)
          return { name: n, size: st.size, mtime: st.mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)
    }
  } catch (e) {
    getLogger('admin/logs').error('failed to list log files', { err: String(e) })
  }
  return NextResponse.json({ config: cfg, files })
}
