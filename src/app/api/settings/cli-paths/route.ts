import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = getSystemSettings('cli.')
  const paths: Record<string, string> = {
    claude: settings['cli.claude.path'] || '/usr/local/bin/claude',
    agy: settings['cli.agy.path'] || '/usr/local/bin/agy',
    codex: settings['cli.codex.path'] || '/usr/local/bin/codex',
    opencode: settings['cli.opencode.path'] || '/usr/local/bin/opencode',
  }
  return NextResponse.json(paths)
}
