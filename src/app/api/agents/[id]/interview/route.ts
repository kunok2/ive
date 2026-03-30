import { NextResponse } from 'next/server'
import { getAgent, getSystemSetting } from '@/lib/db'
import { defaultLocale } from '@/i18n/config'
import { getCurrentUser } from '@/lib/auth'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { getLocale } from 'next-intl/server'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const agent = getAgent(id)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { question } = await req.json()
  if (!question || typeof question !== 'string') {
    return NextResponse.json({ error: '질문을 입력해주세요' }, { status: 400 })
  }

  // CLI 경로: 시스템 설정 우선
  const cliPath = getSystemSetting(`cli.${agent.cliName}.path`) || agent.cliPath

  if (!existsSync(cliPath)) {
    return NextResponse.json({
      error: `CLI 파일을 찾을 수 없습니다: ${cliPath}`,
    }, { status: 400 })
  }

  // 인터뷰 시스템 프롬프트 — locale 설정에 따라 언어 전환
  const locale = await getLocale()
  const systemPrompt = locale === 'ko'
    ? `당신은 "${agent.name}"이라는 이름의 AI 개발자입니다. 면접관이 질문하면 간결하고 재치있게 답변하세요. 자기소개, 기술 역량, 성격 등을 자유롭게 표현하되, 3~4문장 이내로 짧게 답하세요. 반드시 한국어(Korean)로만 답변하세요. 일본어는 절대 사용하지 마세요. 꼭 필요한 경우가 아니면 한자도 쓰지 마세요.`
    : `You are an AI developer named "${agent.name}". Answer interview questions concisely and wittily. Feel free to express your self-introduction, technical skills, and personality, but keep answers brief — within 3-4 sentences. You MUST respond in English only.`

  const interviewerLabel = locale === 'ko' ? '면접관' : 'Interviewer'
  const prompt = `${systemPrompt}\n\n${interviewerLabel}: ${question}`

  const isOpenCode = agent.cliName === 'opencode'

  try {
    const cliParts = cliPath.split(' ')
    const mainCmd = cliParts[0]
    let args: string[]

    if (isOpenCode) {
      // opencode run "prompt" — 기본 포맷(텍스트) 사용
      args = [
        ...cliParts.slice(1),
        'run',
        prompt,
      ]
    } else {
      args = [
        ...cliParts.slice(1),
        '--output-format', 'text',
        '--max-turns', '1',
        '-p', prompt,
      ]
    }

    const answer = await new Promise<string>((resolve, reject) => {
      let stdout = ''
      let stderr = ''

      const child = spawn(mainCmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      })

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(stderr.trim() || `종료 코드: ${code}`))
        }
      })

      child.on('error', reject)

      // 30초 타임아웃
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error('응답 시간 초과 (30초)'))
      }, 30000)
    })

    return NextResponse.json({ answer })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'CLI 실행 실패',
    }, { status: 500 })
  }
}
