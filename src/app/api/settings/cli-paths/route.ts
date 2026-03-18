import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = getSystemSettings('cli.')
  const paths: Record<string, string> = {
    claude: settings['cli.claude.path'] || '',
    gemini: settings['cli.gemini.path'] || '',
    codex: settings['cli.codex.path'] || '',
  }
  return NextResponse.json(paths)
}
