import { NextResponse } from 'next/server'
import { getAgentsByUser, createAgent, getUserById, getSystemSetting } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agents = getAgentsByUser(user.id)
  return NextResponse.json(agents)
}

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Agent 이름을 입력해주세요' }, { status: 400 })
  }

  // CLI 경로: 시스템 설정에서 가져오기
  const cliName = body.cliName || 'claude'
  const systemCliPath = getSystemSetting(`cli.${cliName}.path`)
  const cliPath = systemCliPath || body.cliPath
  if (!cliPath?.trim()) {
    return NextResponse.json({ error: '관리자가 CLI 경로를 설정하지 않았습니다. 관리자에게 문의하세요.' }, { status: 400 })
  }

  // 사용자 제한 확인
  const fullUser = getUserById(user.id)
  if (fullUser && fullUser.maxAgents > 0) {
    const existing = getAgentsByUser(user.id)
    if (existing.length >= fullUser.maxAgents) {
      return NextResponse.json({ error: `최대 ${fullUser.maxAgents}개의 개발자만 생성할 수 있습니다.` }, { status: 400 })
    }
  }
  if (fullUser && fullUser.maxTurns > 0 && body.maxTurns > fullUser.maxTurns) {
    return NextResponse.json({ error: `최대 턴 수는 ${fullUser.maxTurns} 이하로 설정해야 합니다.` }, { status: 400 })
  }

  const agent = { ...body, userId: user.id, cliPath }
  createAgent(agent)
  return NextResponse.json(agent, { status: 201 })
}
