/**
 * 단계 작업자(Stage Worker) 공용 실행기.
 *
 * 처리(D) 에이전트 실행 파이프라인(워크스페이스 → CLI → 결과 처리)을 단계 종류(kind)로 일반화했다.
 *   dev(처리) · confirm(④ 확인) · (reproduce ①, verify ③ 은 이후 Phase 에서 같은 틀로 붙는다)
 *
 * 공용(여기): 에이전트 점유/해제, 로그 스트림(비밀값 마스킹), 헤더, CLI 실행, 오류 보존, 워크스페이스 정리,
 *            실행 후 스캔 트리거, 실행 기록에 프롬프트 판 기록.
 * kind 별(StageKindSpec): 실행 기록 생성·단계 전이(register), 워크스페이스 준비(prepare), 프롬프트,
 *            허용 도구·최대 턴·시간 제한(runOptions), 결과 판정(onResult), 실패 처리(onError).
 *
 * 단계마다 새 CLI 세션으로 기동한다 — 앞 단계의 대화 맥락은 넘기지 않는다(넘기는 것은 이슈·MR·증적뿐).
 */
import fs from 'fs'
import path from 'path'
import { getLogger } from '../logger'
import { Project, Agent } from '@/types'
import {
  getProject, getUserById, getSystemSetting, updateAgentStatus, updateExecutionStatus, touchProjectActivity,
  setExecutionPromptVersion,
} from '../db'
import { defaultLocale } from '@/i18n/config'
import { maskSecrets } from '../secret-mask'
import { resolveCliPath, runCliProcess, type CliRunOptions, type CliRunResult } from './cli-runner'

const slog = getLogger('Scanner')

export type StageKind = 'dev' | 'reproduce' | 'verify' | 'confirm'

export type StageLogFn = (msg: string, type?: 'info' | 'error' | 'warn' | 'system') => void

export interface StageLogStream {
  write(data: string): void
  end(): void
}

export interface StageContext {
  kind: StageKind
  project: Project
  issue: any
  iid: number
  agent: Agent
  token: string
  executionId: string
  workspacePath: string
  logDir: string
  logPath: string
  isKo: boolean
  isGitHub: boolean
  log: StageLogFn
  logStream: StageLogStream
  /** 로그·코멘트에서 가릴 비밀값 (프로젝트 토큰, staging 비밀값). register/prepare 에서 추가할 수 있다. */
  secrets: string[]
}

export interface StagePrompt {
  prompt: string
  /** task_executions.prompt_version 에 남길 판 — 'confirm:default' | 'confirm:v3' */
  promptVersion: string
  imagePaths?: string[]
}

export interface StageKindSpec<P> {
  kind: StageKind
  /** 로그 머리에 찍을 단계 이름 */
  label: string
  /**
   * 실행 기록 생성 + 단계 진입 처리(라벨·스냅샷). 중복 기동이면 false (에이전트는 공용 실행기가 풀어 준다).
   * 로그 스트림이 열리기 전에 호출된다.
   */
  register(ctx: Omit<StageContext, 'log' | 'logStream'>): Promise<boolean> | boolean
  /** 워크스페이스 준비와 프롬프트 재료 수집 */
  prepare(ctx: StageContext): Promise<P>
  buildPrompt(ctx: StageContext, prep: P): Promise<StagePrompt> | StagePrompt
  /** kind 별 최대 턴·시간 제한·MCP·환경변수. undefined 면 처리(D) 종전 값 */
  runOptions?(ctx: StageContext, prep: P): CliRunOptions | undefined
  onResult(ctx: StageContext, prep: P, cli: CliRunResult): Promise<void>
  /** 실패 처리. 실행 기록을 failed 로 닫는 것은 공용 실행기가 한다. */
  onError(ctx: StageContext, prep: P | null, err: Error): Promise<void>
  /** 워크스페이스를 지우지 말아야 할 때(디버깅 등) false. 기본 true */
  removeWorkspace?: boolean
  /** 실행이 끝난 뒤 (성공·실패 무관) */
  afterRun?(ctx: StageContext): Promise<void> | void
}

export interface StageRunInput {
  project: Project
  issue: any
  agent: Agent
  token: string
  executionId: string
  workspacePath: string
  extraSecrets?: string[]
}

/** 타임스탬프 접두 로그 스트림 (xterm 상세보기 형식) + 비밀값 마스킹 */
export function openStageLog(logPath: string, iid: number, secrets: string[]): { log: StageLogFn; logStream: StageLogStream } {
  const rawLogStream = fs.createWriteStream(logPath, { flags: 'a' })
  const logStream: StageLogStream = {
    write(data: string) {
      const lines = maskSecrets(data, secrets).split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (i === lines.length - 1 && line === '') continue
        rawLogStream.write(`${Date.now()}\t${line}\n`)
      }
    },
    end() { rawLogStream.end() },
  }
  const log: StageLogFn = (msg, type = 'info') => {
    let colorCode = ''
    if (type === 'system') colorCode = '\x1b[1;32m'
    if (type === 'error') colorCode = '\x1b[1;31m'
    if (type === 'warn') colorCode = '\x1b[1;33m'
    const coloredMsg = colorCode ? `${colorCode}${msg}\x1b[0m` : msg
    logStream.write(`${coloredMsg}\n`)
    slog.info(`[Task #${iid}] ${maskSecrets(msg, secrets)}`)
  }
  return { log, logStream }
}

export function resolveProjectLocale(project: Project): { isKo: boolean; timezone: string } {
  const owner = getUserById(project.userId)
  const locale = owner?.locale || getSystemSetting('locale') || defaultLocale
  return { isKo: locale === 'ko', timezone: owner?.timezone || 'Asia/Seoul' }
}

/**
 * 단계 작업자 1회 실행. 호출 측은 fire-and-forget 으로 부른다(스캐너 루프를 막지 않는다).
 */
export async function runStageWorker<P>(spec: StageKindSpec<P>, input: StageRunInput): Promise<void> {
  const { project, issue, agent, token, executionId, workspacePath } = input
  const iid: number = issue.iid
  const logDir = path.join(process.cwd(), 'data', 'logs')
  const logPath = path.join(logDir, `${executionId}.log`)
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })

  const { isKo, timezone } = resolveProjectLocale(project)
  const base = {
    kind: spec.kind, project, issue, iid, agent, token, executionId, workspacePath, logDir, logPath,
    isKo, isGitHub: project.provider === 'github',
    secrets: [token, ...(input.extraSecrets || [])].filter(Boolean),
  }

  // 0. 에이전트 점유 → 실행 기록 생성(중복이면 해제하고 끝)
  updateAgentStatus(agent.id, 'busy')
  let registered = false
  try {
    registered = await spec.register(base)
  } catch (e) {
    slog.error({ err: e }, `[${spec.kind}] register failed for #${iid}`)
  }
  if (!registered) {
    updateAgentStatus(agent.id, 'available')
    return
  }

  const { log, logStream } = openStageLog(logPath, iid, base.secrets)
  const ctx: StageContext = { ...base, log, logStream }
  let prep: P | null = null

  try {
    const startDateStr = new Date().toLocaleString('ko-KR', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    log(`\x1b[1;36m${'═'.repeat(30)}\x1b[0m`, 'info')
    log(`Started: ${startDateStr} (${timezone})`, 'system')
    if (spec.kind !== 'dev') log(`Stage : ${spec.label}`, 'system')
    log(`Issue #${iid}: ${issue.title}`, 'system')
    log(`Agent : ${agent.name}`, 'system')
    log(`Project: ${project.name}`, 'system')
    log(`\x1b[1;36m${'═'.repeat(30)}\x1b[0m`, 'info')

    prep = await spec.prepare(ctx)
    const built = await spec.buildPrompt(ctx, prep)
    try { setExecutionPromptVersion(executionId, built.promptVersion, spec.kind) } catch { /* ignore */ }

    const cliPath = await resolveCliPath(agent, log)
    const cli = await runCliProcess(
      executionId, project, agent, built.prompt, workspacePath, token, cliPath, logStream, log,
      built.imagePaths, spec.runOptions?.(ctx, prep),
    )
    await spec.onResult(ctx, prep, cli)
  } catch (err: any) {
    log(`오류 발생: ${err.message}`, 'error')
    try {
      await spec.onError(ctx, prep, err)
    } catch (e) {
      slog.error({ err: e }, `[${spec.kind}] onError failed for #${iid}`)
    }
    updateExecutionStatus(executionId, 'failed', new Date().toISOString())
  } finally {
    updateAgentStatus(agent.id, 'available')
    touchProjectActivity(project.id)
    logStream.end()
    if (spec.removeWorkspace !== false) {
      try {
        if (fs.existsSync(workspacePath)) fs.rmSync(workspacePath, { recursive: true, force: true })
      } catch { /* ignore */ }
    }
    try { await spec.afterRun?.(ctx) } catch { /* ignore */ }

    // 대기 이슈가 있으면 스캔 트리거 (직접 호출 금지 — 스캔은 전용 루프에서만 실행)
    try {
      const freshProject = getProject(project.id)
      if (freshProject && (freshProject.lastScannedIssueCount ?? 0) > 0) {
        slog.info(`Agent ${agent.name} freed — triggering scan for ${freshProject.name}`)
        const { triggerScan } = await import('./index')
        triggerScan(freshProject.id)
      }
    } catch { /* ignore */ }
  }
}
