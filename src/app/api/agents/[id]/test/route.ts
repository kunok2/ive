import { NextResponse } from 'next/server'
import { getAgent, updateAgent, getSystemSetting } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { execFile } from 'child_process'
import { existsSync } from 'fs'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const agent = getAgent(id)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // CLI 경로: 시스템 설정 우선, 없으면 에이전트 저장 경로 사용
  const cliPath = getSystemSetting(`cli.${agent.cliName}.path`) || agent.cliPath

  // CLI 경로 존재 여부 확인
  if (!existsSync(cliPath)) {
    return NextResponse.json({
      success: false,
      error: `CLI 파일을 찾을 수 없습니다: ${cliPath}`,
    })
  }

  // CLI 버전 확인 실행
  try {
    const version = await new Promise<string>((resolve, reject) => {
      execFile(cliPath, ['--version'], { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message))
        } else {
          resolve((stdout || stderr).trim())
        }
      })
    })

    // 버전 정보를 DB에 저장
    if (version) {
      updateAgent({ ...agent, cliVersion: version })
    }

    return NextResponse.json({
      success: true,
      version,
    })
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'CLI 실행 실패',
    })
  }
}
