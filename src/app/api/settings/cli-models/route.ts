import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getSystemSettings } from '@/lib/db'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'

const execFileAsync = promisify(execFile)

/** Claude Code 알려진 모델 alias + 주요 모델명 */
const CLAUDE_MODELS = [
  'sonnet',
  'opus',
  'haiku',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
]

/** Codex 주요 모델명 (codex에는 models 조회 명령이 없어 고정 목록 제공. 빈 값=config.toml 기본값 사용) */
const CODEX_MODELS = [
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5-codex',
  'gpt-5',
  'gpt-5-mini',
  'o4-mini',
  'o3',
]

/** Gemini 주요 모델명 (고정 목록. 빈 값=CLI 기본 모델 사용) */
const GEMINI_MODELS = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
]

/** CLI별 사용 가능한 모델 목록 조회 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = getSystemSettings('cli.')
  const result: Record<string, string[]> = {}

  // Claude: 고정 목록 (CLI에 models 명령 없음)
  result.claude = CLAUDE_MODELS

  // Codex: 고정 목록 (CLI에 models 조회 명령 없음)
  result.codex = CODEX_MODELS

  // Gemini: 고정 목록 (CLI에 models 조회 명령 없음)
  result.gemini = GEMINI_MODELS

  // OpenCode: `opencode models` 명령으로 동적 조회
  const opencodePath = settings['cli.opencode.path'] || '/usr/local/bin/opencode'
  const opencodeBin = opencodePath.split(' ')[0]
  if (fs.existsSync(opencodeBin)) {
    try {
      const { stdout } = await execFileAsync(opencodeBin, ['models'], { timeout: 10000 })
      const models = stdout.trim().split('\n').filter(Boolean)
      if (models.length > 0) result.opencode = models
    } catch { /* fallback: no models */ }
  }

  return NextResponse.json(result)
}
