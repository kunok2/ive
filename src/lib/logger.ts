/**
 * 중앙 로거: pino 기반.
 * - 출력: stdout (항상) + 회전 파일 (옵션)
 * - 회전: 일별 + 크기 기반. 보관 파일 수 한도 적용.
 * - 레벨/회전 정책은 DB(system_settings)에서 읽고, reloadLogger()로 핫 리로드
 * - 모듈별 child logger: getLogger('Scanner').info('...')
 *
 * 구현 메모: pino.transport()는 worker thread를 사용하므로 tsx 환경에서
 * 모듈을 못 찾는 이슈가 있다. 그래서 pino.multistream()을 쓰고, 파일 회전은
 * SonicBoom + 직접 구현한 회전 로직으로 처리한다.
 */
import pino, { type Logger, type LoggerOptions, type StreamEntry } from 'pino'
import SonicBoom from 'sonic-boom'
import path from 'path'
import fs from 'fs'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LoggerConfig {
  level: LogLevel
  fileEnabled: boolean
  dir: string
  frequency: 'daily' | 'hourly'
  maxSizeMb: number
  maxFiles: number
  prettyStdout: boolean
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  fileEnabled: true,
  dir: path.join(process.cwd(), 'data', 'logs', 'app'),
  frequency: 'daily',
  maxSizeMb: 50,
  maxFiles: 14,
  prettyStdout: process.env.NODE_ENV !== 'production',
}

const VALID_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

// State is held on globalThis so that Next.js HMR (which reloads this module)
// doesn't strand long-lived references in user modules. After reload, both
// the old and new module instances share the same root logger and stream.
interface LoggerState {
  root: Logger | null
  cfg: LoggerConfig
  childByMod: Map<string, Logger>
  activeFileStream: SonicBoom | null
  activeRotating: RotatingFileStream | null
}
declare global {
  // eslint-disable-next-line no-var
  var __iveLoggerState: LoggerState | undefined
}
const state: LoggerState = globalThis.__iveLoggerState ?? (globalThis.__iveLoggerState = {
  root: null,
  cfg: { ...DEFAULT_LOGGER_CONFIG },
  childByMod: new Map(),
  activeFileStream: null,
  activeRotating: null,
})

/**
 * Rotating file stream that:
 *  - writes to <dir>/app.<YYYY-MM-DD[-HH]>.log
 *  - on each write checks if the date bucket changed → close+reopen with new name
 *  - on each write checks file size → if over limit, append `.<n>` and reopen
 *  - prunes old files to keep at most maxFiles
 */
class RotatingFileStream {
  private dir: string
  private frequency: 'daily' | 'hourly'
  private maxSize: number
  private maxFiles: number
  private currentBucket = ''
  private currentPath = ''
  private currentSize = 0
  private writeCount = 0
  private boom: SonicBoom

  constructor(opts: { dir: string; frequency: 'daily' | 'hourly'; maxSizeMb: number; maxFiles: number }) {
    this.dir = opts.dir
    this.frequency = opts.frequency
    this.maxSize = Math.max(1, opts.maxSizeMb) * 1024 * 1024
    this.maxFiles = Math.max(1, opts.maxFiles)
    fs.mkdirSync(this.dir, { recursive: true })
    this.openCurrent()
    this.boom = new SonicBoom({ dest: this.currentPath, append: true, sync: false, mkdir: true })
    this.prune()
  }

  private bucketLabel(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    if (this.frequency === 'hourly') {
      const h = String(d.getHours()).padStart(2, '0')
      return `${y}-${m}-${day}-${h}`
    }
    return `${y}-${m}-${day}`
  }

  private openCurrent() {
    this.currentBucket = this.bucketLabel()
    // Find the highest existing rollover number for this bucket so a restart
    // mid-bucket doesn't truncate or jump backwards.
    let n = 0
    try {
      const entries = fs.readdirSync(this.dir)
      const re = new RegExp(`^app\\.${this.currentBucket}(?:\\.(\\d+))?\\.log$`)
      for (const f of entries) {
        const m = f.match(re)
        if (m) n = Math.max(n, m[1] ? Number(m[1]) : 0)
      }
    } catch { /* ignore */ }
    this.currentPath = path.join(
      this.dir,
      n === 0 ? `app.${this.currentBucket}.log` : `app.${this.currentBucket}.${n}.log`,
    )
    try { this.currentSize = fs.statSync(this.currentPath).size } catch { this.currentSize = 0 }
  }

  private rollOver(reason: 'bucket' | 'size') {
    try { this.boom.end() } catch { /* ignore */ }
    if (reason === 'size') {
      // bump rollover number for same bucket
      const re = new RegExp(`^app\\.${this.currentBucket}(?:\\.(\\d+))?\\.log$`)
      let maxN = 0
      try {
        for (const f of fs.readdirSync(this.dir)) {
          const m = f.match(re)
          if (m) maxN = Math.max(maxN, m[1] ? Number(m[1]) : 0)
        }
      } catch { /* ignore */ }
      const next = maxN + 1
      this.currentPath = path.join(this.dir, `app.${this.currentBucket}.${next}.log`)
    } else {
      this.openCurrent()
    }
    this.currentSize = 0
    this.boom = new SonicBoom({ dest: this.currentPath, append: true, sync: false, mkdir: true })
    this.prune()
  }

  private prune() {
    try {
      const files = fs.readdirSync(this.dir)
        .filter(f => /^app\..+\.log$/.test(f))
        .map(f => ({ f, mtime: fs.statSync(path.join(this.dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      const stale = files.slice(this.maxFiles)
      for (const s of stale) {
        try { fs.unlinkSync(path.join(this.dir, s.f)) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  write(chunk: string): boolean {
    // bucket rotation check (every 32 writes to avoid syscall on every line)
    if ((this.writeCount++ & 31) === 0) {
      const b = this.bucketLabel()
      if (b !== this.currentBucket) this.rollOver('bucket')
    }
    // size rotation check
    this.currentSize += Buffer.byteLength(chunk)
    if (this.currentSize > this.maxSize) this.rollOver('size')
    return this.boom.write(chunk)
  }

  end() {
    try { this.boom.end() } catch { /* ignore */ }
  }

  flush() {
    try { this.boom.flush() } catch { /* ignore */ }
  }
}

function buildLogger(cfg: LoggerConfig): Logger {
  const streams: StreamEntry[] = []

  if (cfg.prettyStdout) {
    try {
      const pretty = require('pino-pretty')
      streams.push({
        level: cfg.level,
        stream: pretty({
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '[{mod}] {msg}',
        }),
      })
    } catch {
      streams.push({ level: cfg.level, stream: process.stdout })
    }
  } else {
    streams.push({ level: cfg.level, stream: process.stdout })
  }

  // close prior file stream before opening a new one (reload safety)
  if (state.activeRotating) {
    try { state.activeRotating.end() } catch { /* ignore */ }
    state.activeRotating = null
    state.activeFileStream = null
  }

  if (cfg.fileEnabled) {
    try {
      fs.mkdirSync(cfg.dir, { recursive: true })
      const rfs = new RotatingFileStream({
        dir: cfg.dir,
        frequency: cfg.frequency,
        maxSizeMb: cfg.maxSizeMb,
        maxFiles: cfg.maxFiles,
      })
      state.activeRotating = rfs
      state.activeFileStream = (rfs as any).boom
      // Adapter: expose .write so pino's multistream can use it like a Writable
      streams.push({ level: cfg.level, stream: rfs as any })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[logger] failed to init file rotation:', e)
    }
  }

  const opts: LoggerOptions = {
    level: cfg.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
    formatters: {
      level: (label) => ({ level: label }),
    },
  }
  return pino(opts, pino.multistream(streams, { dedupe: false }))
}

function ensureRoot(): Logger {
  if (!state.root) {
    state.root = buildLogger(state.cfg)
  }
  return state.root
}

/**
 * Look up (or create) the child logger for `mod` against the *current* root.
 * Critical for HMR/reload safety: callers cache the AppLogger at module load,
 * but every call must dispatch through the current root + current file stream.
 * After reloadLogger() clears state.childByMod, the next call rebuilds.
 */
function childFor(mod: string): Logger {
  const root = ensureRoot()
  let c = state.childByMod.get(mod)
  if (!c) {
    c = root.child({ mod })
    state.childByMod.set(mod, c)
  }
  return c
}

/**
 * Console-like logger interface. Accepts the same loose call shapes that
 * `console.log/warn/error` accepts:
 *   slog.info("text")
 *   slog.info("text with %s", value)        // printf-style
 *   slog.warn("failed:", err)               // arbitrary tail args
 *   slog.error({ err }, "failed")           // structured (obj first)
 * Internally adapted to pino's stricter API.
 */
export interface AppLogger {
  trace: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  info:  (...args: unknown[]) => void
  warn:  (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  fatal: (...args: unknown[]) => void
  raw: Logger
}

function adapt(mod: string, level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal') {
  return (...args: unknown[]) => {
    if (args.length === 0) return
    const child = childFor(mod)
    const [first, ...rest] = args

    // (obj, msg, ...args) — caller already used pino-style structured form
    if (first && typeof first === 'object' && !(first instanceof Error)) {
      const msg = typeof rest[0] === 'string' ? rest[0] : ''
      ;(child as any)[level](first, msg, ...rest.slice(1))
      return
    }

    // (msg, ...rest) — console-style. Stringify any non-primitive tail args
    // (typically Errors) so the line stays useful.
    const msg = typeof first === 'string' ? first : String(first)
    if (rest.length === 0) {
      child[level](msg)
      return
    }
    const extras: Record<string, unknown> = {}
    let idx = 0
    for (const r of rest) {
      if (r instanceof Error) {
        extras.err = { message: r.message, stack: r.stack, name: r.name }
      } else {
        extras[`arg${idx}`] = r
      }
      idx++
    }
    ;(child as any)[level](extras, msg)
  }
}

/**
 * Get a logger tagged with `mod`. The returned object's methods always
 * dispatch through the *current* root logger, so it is safe to cache at
 * module load time even across HMR/reloads.
 */
export function getLogger(mod: string): AppLogger {
  return {
    trace: adapt(mod, 'trace'),
    debug: adapt(mod, 'debug'),
    info:  adapt(mod, 'info'),
    warn:  adapt(mod, 'warn'),
    error: adapt(mod, 'error'),
    fatal: adapt(mod, 'fatal'),
    get raw() { return childFor(mod) },
  }
}

/** Coerce raw input (DB strings or partial objects) into a valid LoggerConfig. */
export function normalizeConfig(input: Partial<Record<keyof LoggerConfig, unknown>>): LoggerConfig {
  const out: LoggerConfig = { ...DEFAULT_LOGGER_CONFIG }
  if (typeof input.level === 'string' && VALID_LEVELS.includes(input.level as LogLevel)) {
    out.level = input.level as LogLevel
  }
  if (typeof input.fileEnabled === 'boolean') out.fileEnabled = input.fileEnabled
  else if (typeof input.fileEnabled === 'string') out.fileEnabled = input.fileEnabled === 'true'
  if (typeof input.dir === 'string' && input.dir.trim()) out.dir = input.dir
  if (input.frequency === 'daily' || input.frequency === 'hourly') out.frequency = input.frequency
  const maxSize = Number(input.maxSizeMb)
  if (Number.isFinite(maxSize) && maxSize > 0) out.maxSizeMb = Math.min(maxSize, 1024)
  const maxFiles = Number(input.maxFiles)
  if (Number.isFinite(maxFiles) && maxFiles > 0) out.maxFiles = Math.min(Math.floor(maxFiles), 365)
  if (typeof input.prettyStdout === 'boolean') out.prettyStdout = input.prettyStdout
  return out
}

/**
 * Replace the underlying logger with a new config. Existing child loggers
 * are dropped from the cache so the next getLogger() call rebuilds them
 * against the new root.
 */
export function reloadLogger(cfg: Partial<LoggerConfig>): LoggerConfig {
  const next = normalizeConfig({ ...state.cfg, ...cfg })
  state.cfg = next
  state.root = buildLogger(state.cfg)
  state.childByMod.clear()
  return state.cfg
}

export function getCurrentConfig(): LoggerConfig {
  return { ...state.cfg }
}

/**
 * Initialize from DB settings. Safe to call multiple times. Catches DB errors
 * so the logger always falls back to defaults rather than crashing the boot.
 */
export function initLoggerFromDb(): LoggerConfig {
  try {
    const { getSystemSettings } = require('./db/settings') as typeof import('./db/settings')
    const s = getSystemSettings('log.')
    const cfg = normalizeConfig({
      level: s['log.level'],
      fileEnabled: s['log.file_enabled'],
      dir: s['log.dir'],
      frequency: s['log.frequency'],
      maxSizeMb: s['log.max_size_mb'],
      maxFiles: s['log.max_files'],
    })
    return reloadLogger(cfg)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[logger] could not read settings from DB, using defaults:', e)
    return reloadLogger({})
  }
}

/** Convenience root accessors — prefer getLogger('Mod') for tagged output. */
export const log = {
  trace: (msg: string, obj?: object) => ensureRoot().trace(obj ?? {}, msg),
  debug: (msg: string, obj?: object) => ensureRoot().debug(obj ?? {}, msg),
  info:  (msg: string, obj?: object) => ensureRoot().info(obj ?? {}, msg),
  warn:  (msg: string, obj?: object) => ensureRoot().warn(obj ?? {}, msg),
  error: (msg: string, obj?: object) => ensureRoot().error(obj ?? {}, msg),
  fatal: (msg: string, obj?: object) => ensureRoot().fatal(obj ?? {}, msg),
}
