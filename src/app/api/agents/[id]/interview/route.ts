import { NextResponse } from 'next/server'
import { getAgent, getSystemSetting } from '@/lib/db'
import { isAgentAvailableNow } from '@/types'
import { defaultLocale } from '@/i18n/config'
import { getCurrentUser } from '@/lib/auth'
import { logActivity } from '@/lib/activity'
import { existsSync, mkdirSync } from 'fs'
import { spawn } from 'child_process'
import { getLocale } from 'next-intl/server'
import path from 'path'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const agent = getAgent(id)
  if (!agent || agent.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 사용중지 상태면 인터뷰도 차단
  if (!isAgentAvailableNow(agent)) {
    const until = agent.enabled === false ? null : agent.pausedUntil
    return NextResponse.json({
      error: until
        ? `이 에이전트는 사용 중지 상태입니다 (재개: ${until}).`
        : '이 에이전트는 사용 중지 상태입니다.',
    }, { status: 409 })
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
  const isCodex = agent.cliName === 'codex'
  const isGemini = agent.cliName === 'gemini'

  // 모델: 에이전트 설정 → 시스템 설정 순으로 결정 (opencode는 provider/model 형식 필요)
  const model = agent.modelName || getSystemSetting(`cli.${agent.cliName}.model`) || null

  // sh -c "exec ..." 래핑에 쓸 shell quoting (opencode 전용)
  const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

  // OpenCode 인터뷰용 환경변수 (모델 설정 포함)
  let opencodeEnv: NodeJS.ProcessEnv | undefined

  try {
    const cliParts = cliPath.split(' ')
    let mainCmd = cliParts[0]
    let args: string[]
    let opencodeStdin: string | null = null

    if (isOpenCode) {
      // opencode 기본 포맷은 stdout에 아무것도 출력하지 않으므로(TUI 스타일)
      // --format json으로 실행 후 JSON 이벤트에서 텍스트를 파싱한다.
      // sh -c "exec ..." 래핑 + stdin 프롬프트 전달 (buildCliInvocation과 동일 패턴)
      //
      // OPENCODE_CONFIG_CONTENT: 모델을 agent.coder.model에 주입.
      //   미설정 시 OpenCode 기본 모델이 적용되어 "The requested model is not supported" 에러 발생 가능.
      // -m 플래그: CLI 수준에서 모델을 명시적으로 지정해 config보다 우선 적용.
      const opencodeConfig: Record<string, unknown> = {
        agent: { coder: { steps: 1, permission: { '*': 'allow' }, ...(model ? { model } : {}) } },
        compaction: { auto: true },
      }
      const ocTmp = path.join(process.cwd(), '.octmp-interview')
      try { mkdirSync(ocTmp, { recursive: true }) } catch { /* ignore */ }
      opencodeEnv = {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig),
        TMPDIR: ocTmp, TMP: ocTmp, TEMP: ocTmp,
      }
      const ocParts = [
        ...cliParts, 'run', '--format', 'json', '--dangerously-skip-permissions',
        ...(model ? ['-m', model] : []),
      ]
      args = ['-c', `exec ${ocParts.map(shq).join(' ')}`]
      mainCmd = 'sh'
      opencodeStdin = prompt
    } else if (isCodex) {
      // codex exec "prompt" — JSON 없이 기본 텍스트 출력(답변만 stdout, 메타데이터는 stderr)
      args = [
        ...cliParts.slice(1),
        'exec',
        '--skip-git-repo-check',
        '-s', 'read-only',
        prompt,
      ]
    } else if (isGemini) {
      // gemini -p "prompt" — headless. Gemini CLI에는 --max-turns 플래그가 없으므로 붙이지 않는다.
      // --skip-trust: 헤드리스 환경에서 trusted-folder 확인을 건너뛴다(없으면 실행 거부됨).
      args = [
        ...cliParts.slice(1),
        '--output-format', 'text',
        '--skip-trust',
        '-p', prompt,
      ]
    } else {
      // Claude Code
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
        stdio: [opencodeStdin !== null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        ...(opencodeEnv ? { env: opencodeEnv } : {}),
      })

      // opencode는 프롬프트를 stdin으로 전달
      if (opencodeStdin !== null && child.stdin) {
        try { child.stdin.write(opencodeStdin); child.stdin.end() } catch { /* ignore */ }
      }

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

      child.on('close', (code) => {
        if (isOpenCode) {
          // opencode는 오류 발생 시에도 종료 코드 0으로 종료 → 항상 JSON 파싱
          const texts: string[] = []
          let ocError: string | null = null
          for (const line of stdout.split('\n')) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line)
              // error / session.error 두 타입 모두 처리
              if (event.type === 'error' || event.type === 'session.error') {
                ocError = event.error?.data?.message ?? event.error?.message ?? event.message ?? '알 수 없는 오류'
              } else if (event.type === 'text') {
                const text = event.part?.text ?? event.content ?? event.text ?? ''
                if (text) texts.push(text)
              }
            } catch { /* non-JSON 무시 */ }
          }
          if (texts.length > 0) {
            resolve(texts.join('').trim())
          } else if (ocError) {
            reject(new Error(ocError))
          } else {
            // stderr에 실제 에러 메시지가 있으면 우선 사용
            const stderrMsg = stderr.trim()
            if (stderrMsg) {
              reject(new Error(`OpenCode 오류: ${stderrMsg.split('\n').slice(-3).join(' ')}`))
            } else {
              reject(new Error('응답을 가져오지 못했습니다. 에이전트 설정에서 OpenCode 모델명을 확인해 주세요.'))
            }
          }
        } else if (code === 0) {
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

    logActivity({ userId: user.id, category: 'agent', action: 'interview_agent', detail: `에이전트 인터뷰: ${agent.name} — "${question.slice(0, 80)}${question.length > 80 ? '…' : ''}"`, targetType: 'agent', targetId: id, req })

    return NextResponse.json({ answer })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'CLI 실행 실패',
    }, { status: 500 })
  }
}
