'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ── 가상 터미널 버퍼 (커서 이동·CR·줄 지우기 지원) ──

/** ANSI 이스케이프를 제외한 가시적 문자 길이 */
function visualLen(s: string): number {
  let len = 0, i = 0
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b(?:\[[0-9;?]*[A-Za-z@]|\][^\x07\x1b]*\x07|[()][A-Z0-9]|[a-zA-Z])/)
      if (m) { i += m[0].length; continue }
      i++
    } else { len++; i++ }
  }
  return len
}

/** 가시적 열 위치에 해당하는 바이트 위치 반환 */
function findBytePos(s: string, visualCol: number): number {
  let vc = 0, i = 0
  while (i < s.length && vc < visualCol) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b(?:\[[0-9;?]*[A-Za-z@]|\][^\x07\x1b]*\x07|[()][A-Z0-9]|[a-zA-Z])/)
      if (m) { i += m[0].length; continue }
      i++
    } else { vc++; i++ }
  }
  return i
}

/** 가시적 col 위치에 newText를 덧씌우기 (기존 문자 대체) */
function overlayText(line: string, col: number, newText: string): string {
  if (!newText) return line
  const newVL = visualLen(newText)
  const start = findBytePos(line, col)
  const end = findBytePos(line, col + newVL)
  if (start > line.length) return line + ' '.repeat(start - line.length) + newText
  return line.slice(0, start) + newText + line.slice(end)
}

/** 가시적 col 위치부터 줄 끝까지 삭제 */
function eraseLineFrom(line: string, col: number): string {
  return line.slice(0, findBytePos(line, col))
}

interface TermRow { raw: string; timestamp?: number }

/**
 * 가상 터미널 버퍼:
 * 로그 파일의 각 줄을 처리하며 CR·커서 이동·줄 지우기를 해석해
 * 최종 렌더링될 화면 상태를 유지합니다.
 */
class TerminalBuffer {
  rows: TermRow[] = []
  curRow = 0
  curCol = 0
  private savedRow = 0
  private savedCol = 0

  private ensureRow(r: number) {
    // 너무 큰 값 방어 (비정상 이스케이프 시퀀스 대비)
    const safeR = Math.min(r, this.rows.length + 500)
    while (this.rows.length <= safeR) this.rows.push({ raw: '' })
  }

  /**
   * 로그 파일의 한 엔트리(줄) 처리.
   * 암시적 개행이 끝에 추가됩니다 (로그 파일은 \n으로 분리되므로).
   */
  writeEntry(content: string, timestamp?: number) {
    let i = 0
    let chunk = ''

    const flush = () => {
      if (!chunk) return
      this.ensureRow(this.curRow)
      if (timestamp !== undefined) this.rows[this.curRow].timestamp = timestamp
      this.rows[this.curRow].raw = overlayText(this.rows[this.curRow].raw, this.curCol, chunk)
      this.curCol += visualLen(chunk)
      chunk = ''
    }

    while (i < content.length) {
      const ch = content[i]

      // 캐리지 리턴: 현재 줄의 처음으로 이동
      if (ch === '\r') { flush(); this.curCol = 0; i++; continue }

      // 개행: 다음 줄로 이동
      if (ch === '\n') {
        flush(); this.curRow++; this.ensureRow(this.curRow); this.curCol = 0; i++; continue
      }

      // 이스케이프 시퀀스
      if (ch === '\x1b') {
        // CSI 시퀀스: \x1b[...X
        if (content[i + 1] === '[') {
          const m = content.slice(i).match(/^\x1b\[([0-9;?]*)([A-Za-z@])/)
          if (m) {
            const rawParam = m[1].replace(/\?/g, '')
            const cmd = m[2]

            // SGR(색상/스타일)은 chunk에 포함해 renderAnsiSpan에서 처리
            if (cmd === 'm') { chunk += m[0]; i += m[0].length; continue }

            flush()
            const parts = rawParam.split(';')
            const n = Math.max(1, parseInt(parts[0]) || 1)
            const n2 = Math.max(1, parseInt(parts[1] || '1') || 1)

            switch (cmd) {
              case 'A': this.curRow = Math.max(0, this.curRow - n); break
              case 'B': this.curRow += n; this.ensureRow(this.curRow); break
              case 'C': this.curCol += n; break
              case 'D': this.curCol = Math.max(0, this.curCol - n); break
              case 'E': this.curRow++; this.ensureRow(this.curRow); this.curCol = 0; break
              case 'F': this.curRow = Math.max(0, this.curRow - n); this.curCol = 0; break
              case 'G': this.curCol = Math.max(0, n - 1); break
              case 'H': case 'f': {
                this.curRow = Math.max(0, n - 1)
                this.curCol = Math.max(0, n2 - 1)
                this.ensureRow(this.curRow)
                break
              }
              case 'J': {
                const p = parseInt(rawParam) || 0
                if (p === 2 || p === 3) {
                  // 전체 화면 지우기
                  this.rows = [{ raw: '' }]; this.curRow = 0; this.curCol = 0
                } else if (p === 0) {
                  // 커서~끝 지우기
                  this.ensureRow(this.curRow)
                  this.rows[this.curRow].raw = eraseLineFrom(this.rows[this.curRow].raw, this.curCol)
                  this.rows.splice(this.curRow + 1)
                }
                break
              }
              case 'K': {
                const p = parseInt(rawParam) || 0
                this.ensureRow(this.curRow)
                if (p === 0) {
                  // 커서~줄 끝 지우기
                  this.rows[this.curRow].raw = eraseLineFrom(this.rows[this.curRow].raw, this.curCol)
                } else if (p === 1) {
                  // 줄 시작~커서 지우기
                  const pos = findBytePos(this.rows[this.curRow].raw, this.curCol)
                  this.rows[this.curRow].raw = ' '.repeat(this.curCol) + this.rows[this.curRow].raw.slice(pos)
                } else if (p === 2) {
                  this.rows[this.curRow].raw = ''; this.curCol = 0
                }
                break
              }
              case 's': this.savedRow = this.curRow; this.savedCol = this.curCol; break
              case 'u': this.curRow = this.savedRow; this.curCol = this.savedCol; break
              // 나머지 CSI 코드는 무시 (커서 표시/숨기기 등)
            }
            i += m[0].length; continue
          }
        } else if (content[i + 1] === ']') {
          // OSC 시퀀스 (제목 설정 등) 건너뜀
          flush()
          const bel = content.indexOf('\x07', i)
          if (bel !== -1) { i = bel + 1; continue }
          const st = content.indexOf('\x1b\\', i)
          if (st !== -1) { i = st + 2; continue }
        }
        // 기타 이스케이프: 건너뜀
        i++; continue
      }

      chunk += ch; i++
    }

    flush()
    // 각 로그 엔트리는 \n으로 끝나므로 암시적 개행 처리
    this.curRow++
    this.ensureRow(this.curRow)
    this.curCol = 0
  }

  trimToMax(max: number): void {
    if (this.rows.length > max) {
      const remove = this.rows.length - max
      this.rows.splice(0, remove)
      this.curRow = Math.max(0, this.curRow - remove)
    }
  }

  /** 후행 빈 줄을 제외한 표시용 줄 반환 */
  getDisplayLines(): TermRow[] {
    let end = this.rows.length
    while (end > 0 && !this.rows[end - 1].raw) end--
    return this.rows.slice(0, end)
  }
}

// ── ANSI 이스케이프 시퀀스 파서 ──

interface AnsiSpan {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  dim: boolean
  strikethrough: boolean
  fg: string | null
  bg: string | null
}

const ANSI_COLORS: Record<number, string> = {
  30: '#171717', 31: '#f87171', 32: '#4ade80', 33: '#facc15',
  34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e5e5e5',
  90: '#737373', 91: '#fca5a5', 92: '#86efac', 93: '#fde68a',
  94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff',
}

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#171717', 41: '#f87171', 42: '#4ade80', 43: '#facc15',
  44: '#60a5fa', 45: '#c084fc', 46: '#22d3ee', 47: '#e5e5e5',
  100: '#737373', 101: '#fca5a5', 102: '#86efac', 103: '#fde68a',
  104: '#93c5fd', 105: '#d8b4fe', 106: '#67e8f9', 107: '#ffffff',
}

function parse256Color(codes: number[], idx: number): [string | null, number] {
  if (codes[idx + 1] === 5 && idx + 2 < codes.length) {
    const c = codes[idx + 2]
    if (c < 8) {
      const basic = [30, 31, 32, 33, 34, 35, 36, 37]
      return [ANSI_COLORS[basic[c]] || null, idx + 3]
    } else if (c < 16) {
      const bright = [90, 91, 92, 93, 94, 95, 96, 97]
      return [ANSI_COLORS[bright[c - 8]] || null, idx + 3]
    } else if (c < 232) {
      const n = c - 16
      const r = Math.floor(n / 36) * 51
      const g = Math.floor((n % 36) / 6) * 51
      const b = (n % 6) * 51
      return [`rgb(${r},${g},${b})`, idx + 3]
    } else {
      const gray = (c - 232) * 10 + 8
      return [`rgb(${gray},${gray},${gray})`, idx + 3]
    }
  }
  if (codes[idx + 1] === 2 && idx + 4 < codes.length) {
    return [`rgb(${codes[idx + 2]},${codes[idx + 3]},${codes[idx + 4]})`, idx + 5]
  }
  return [null, idx + 1]
}

function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let bold = false, italic = false, underline = false, dim = false, strikethrough = false
  let fg: string | null = null, bg: string | null = null

  const parts = text.split(/(\x1b\[[0-9;]*m)/)

  for (const part of parts) {
    const match = part.match(/^\x1b\[([0-9;]*)m$/)
    if (match) {
      const codes = (match[1] || '0').split(';').map(Number)
      let i = 0
      while (i < codes.length) {
        const c = codes[i]
        if (c === 0) { bold = false; italic = false; underline = false; dim = false; strikethrough = false; fg = null; bg = null }
        else if (c === 1) bold = true
        else if (c === 2) dim = true
        else if (c === 3) italic = true
        else if (c === 4) underline = true
        else if (c === 9) strikethrough = true
        else if (c === 22) { bold = false; dim = false }
        else if (c === 23) italic = false
        else if (c === 24) underline = false
        else if (c === 29) strikethrough = false
        else if (c === 39) fg = null
        else if (c === 49) bg = null
        else if (ANSI_COLORS[c]) fg = ANSI_COLORS[c]
        else if (ANSI_BG_COLORS[c]) bg = ANSI_BG_COLORS[c]
        else if (c === 38) { const [color, next] = parse256Color(codes, i); fg = color; i = next; continue }
        else if (c === 48) { const [color, next] = parse256Color(codes, i); bg = color; i = next; continue }
        i++
      }
    } else if (part.length > 0) {
      // TerminalBuffer가 처리했지만 혹시 남은 커서 이동·제어 코드 제거
      const cleaned = part
        .replace(/\x1b\[[0-9;?]*[A-Za-z@]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[()][A-Z0-9]/g, '')
        .replace(/\x1b[a-zA-Z]/g, '')
        .replace(/\r/g, '')
      if (cleaned.length > 0) {
        spans.push({ text: cleaned, bold, italic, underline, dim, strikethrough, fg, bg })
      }
    }
  }

  return spans
}

// ── 마크다운 인라인 파서 ──

interface MdSegment {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'strikethrough'
  text: string
  href?: string
}

function parseMarkdownInline(text: string): MdSegment[] {
  const segments: MdSegment[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[2]) segments.push({ type: 'bold', text: match[2] })
    else if (match[3]) segments.push({ type: 'italic', text: match[3] })
    else if (match[4]) segments.push({ type: 'code', text: match[4] })
    else if (match[5]) segments.push({ type: 'strikethrough', text: match[5] })
    else if (match[6]) segments.push({ type: 'link', text: match[6], href: match[7] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }]
}

// ── 라인 렌더링 ──

function renderMdSegment(seg: MdSegment, key: number) {
  switch (seg.type) {
    case 'bold':
      return <strong key={key} className="font-bold text-white">{seg.text}</strong>
    case 'italic':
      return <em key={key} className="italic text-ive-text">{seg.text}</em>
    case 'code':
      return <code key={key} className="px-1.5 py-0.5 rounded bg-white/10 text-ive-cyan font-mono text-[0.9em]">{seg.text}</code>
    case 'strikethrough':
      return <span key={key} className="line-through text-ive-text-dim">{seg.text}</span>
    case 'link': {
      const isSafeHref = seg.href && /^https?:\/\//.test(seg.href)
      return isSafeHref
        ? <a key={key} href={seg.href} target="_blank" rel="noopener noreferrer" className="text-ive-blue underline hover:text-ive-cyan">{seg.text}</a>
        : <span key={key} className="text-ive-blue underline">{seg.text}</span>
    }
    default:
      return <span key={key}>{seg.text}</span>
  }
}

function renderAnsiSpan(span: AnsiSpan, key: number) {
  const style: React.CSSProperties = {}
  if (span.fg) style.color = span.fg
  if (span.bg) { style.backgroundColor = span.bg; style.borderRadius = '2px'; style.padding = '0 2px' }
  if (span.dim) style.opacity = 0.6

  const classes: string[] = []
  if (span.bold) classes.push('font-bold')
  if (span.italic) classes.push('italic')
  if (span.underline) classes.push('underline')
  if (span.strikethrough) classes.push('line-through')

  return (
    <span key={key} style={style} className={classes.join(' ')}>
      {span.text}
    </span>
  )
}

interface LineData {
  raw: string
  hasAnsi: boolean
  timestamp?: number  // Unix ms timestamp (from log file prefix)
}

function formatTimestamp(ts: number, timezone?: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-GB', {
      timeZone: timezone || 'Asia/Seoul',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return '' }
}

function LogLine({ line, showLineNum, lineNum, timezone }: { line: LineData; lineNum: number; showLineNum: boolean; timezone?: string }) {
  const content = useMemo(() => {
    const raw = line.raw

    if (line.hasAnsi) {
      const spans = parseAnsi(raw)
      return spans.map((s, i) => renderAnsiSpan(s, i))
    }

    const headerMatch = raw.match(/^(#{1,6})\s+(.*)$/)
    if (headerMatch) {
      const level = headerMatch[1].length
      const sizes = ['text-xl font-bold', 'text-lg font-bold', 'text-base font-bold', 'text-sm font-bold', 'text-sm font-bold', 'text-sm font-bold']
      const mdSegs = parseMarkdownInline(headerMatch[2])
      return (
        <span className={`${sizes[level - 1]} text-ive-green-pale`}>
          {mdSegs.map((s, i) => renderMdSegment(s, i))}
        </span>
      )
    }

    if (/^[-*_]{3,}\s*$/.test(raw)) {
      return <span className="block border-t border-ive-border-dark my-1" />
    }

    const listMatch = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
    if (listMatch) {
      const indent = listMatch[1].length
      const mdSegs = parseMarkdownInline(listMatch[3])
      return (
        <span style={{ paddingLeft: `${indent * 0.5 + 0.5}em` }}>
          <span className="text-ive-text-dim mr-1.5">{listMatch[2]}</span>
          {mdSegs.map((s, i) => renderMdSegment(s, i))}
        </span>
      )
    }

    if (raw.startsWith('> ')) {
      const mdSegs = parseMarkdownInline(raw.slice(2))
      return (
        <span className="pl-3 border-l-2 border-ive-cyan/40 text-ive-text-muted italic">
          {mdSegs.map((s, i) => renderMdSegment(s, i))}
        </span>
      )
    }

    const mdSegs = parseMarkdownInline(raw)
    return mdSegs.map((s, i) => renderMdSegment(s, i))
  }, [line.raw, line.hasAnsi])

  return (
    <div className="flex hover:bg-white/[0.02] group leading-relaxed">
      {showLineNum && (
        <span className="select-none text-ive-text-muted/60 group-hover:text-ive-text-muted w-6 shrink-0 text-right pr-2 font-mono text-[0.85em]">
          {lineNum}
        </span>
      )}
      {line.timestamp && (
        <span className="select-none text-ive-text-muted shrink-0 pr-2 font-mono text-[0.85em]">
          {formatTimestamp(line.timestamp, timezone)}
        </span>
      )}
      <span className="flex-1 whitespace-pre-wrap break-all min-w-0">{content}</span>
    </div>
  )
}

// ── 코드 블록 감지 ──

interface Block {
  type: 'line' | 'codeblock'
  lines: LineData[]
  lang?: string
}

function groupIntoBlocks(lines: LineData[]): Block[] {
  const blocks: Block[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: LineData[] = []

  for (const line of lines) {
    const fenceMatch = line.raw.match(/^```(\w*)/)
    if (fenceMatch && !line.hasAnsi) {
      if (!inCode) {
        inCode = true
        codeLang = fenceMatch[1] || ''
        codeLines = []
      } else {
        blocks.push({ type: 'codeblock', lines: codeLines, lang: codeLang })
        inCode = false
        codeLines = []
      }
    } else if (inCode) {
      codeLines.push(line)
    } else {
      blocks.push({ type: 'line', lines: [line] })
    }
  }

  if (inCode) {
    blocks.push({ type: 'line', lines: [{ raw: '```' + codeLang, hasAnsi: false }] })
    for (const l of codeLines) blocks.push({ type: 'line', lines: [l] })
  }

  return blocks
}

// ── 메인 LogViewer 컴포넌트 ──

interface LogViewerProps {
  sseUrl: string
  initialFetchUrl?: string
  showLineNumbers?: boolean
  fontSize?: number
  maxLines?: number
  className?: string
  onConnectionChange?: (connected: boolean) => void
  onLineCountChange?: (count: number) => void
  initialAutoScroll?: boolean
  isLive?: boolean
  timezone?: string
}

const ANSI_ESCAPE_RE = /\x1b\[/

export default function LogViewer({
  sseUrl,
  initialFetchUrl,
  showLineNumbers = true,
  fontSize = 13,
  maxLines = 50000,
  className = '',
  onConnectionChange,
  onLineCountChange,
  initialAutoScroll = true,
  isLive,
  timezone,
}: LogViewerProps) {
  const [lines, setLines] = useState<LineData[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(initialAutoScroll)
  const linesRef = useRef<LineData[]>([])
  const vtermRef = useRef<TerminalBuffer | null>(null)
  const initialLoadedRef = useRef(false)
  const [connected, setConnected] = useState(false)

  const TIMESTAMP_PREFIX_RE = /^(\d{13,})\t(.*)$/
  const appendLines = useCallback((text: string) => {
    if (!text) return

    if (!vtermRef.current) vtermRef.current = new TerminalBuffer()
    const vterm = vtermRef.current

    const entries = text.split('\n')
    // 마지막 빈 항목 제거 (trailing newline)
    if (entries.length > 0 && entries[entries.length - 1] === '') entries.pop()
    if (entries.length === 0) return

    for (const raw of entries) {
      const m = raw.match(TIMESTAMP_PREFIX_RE)
      if (m) {
        vterm.writeEntry(m[2], Number(m[1]))
      } else {
        vterm.writeEntry(raw)
      }
    }

    vterm.trimToMax(maxLines)

    const termLines = vterm.getDisplayLines()
    const newLines: LineData[] = termLines.map(r => ({
      raw: r.raw,
      hasAnsi: ANSI_ESCAPE_RE.test(r.raw),
      timestamp: r.timestamp,
    }))

    linesRef.current = newLines
    setLines([...newLines])
    onLineCountChange?.(newLines.length)
  }, [maxLines, onLineCountChange])

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50
  }, [])

  useEffect(() => {
    if (!initialFetchUrl || initialLoadedRef.current) return
    initialLoadedRef.current = true

    fetch(initialFetchUrl)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.content) {
          appendLines(data.content)
          if (data.status !== 'running') {
            onConnectionChange?.(false)
          }
        }
      })
      .catch(() => {})
  }, [initialFetchUrl, appendLines, onConnectionChange])

  useEffect(() => {
    const url = initialFetchUrl ? `${sseUrl}${sseUrl.includes('?') ? '&' : '?'}skipInitial=1` : sseUrl
    const eventSource = new EventSource(url)

    eventSource.onopen = () => { setConnected(true); onConnectionChange?.(true) }

    eventSource.onmessage = (event) => {
      appendLines(event.data)
    }

    eventSource.onerror = () => {
      eventSource.close()
      setConnected(false)
      onConnectionChange?.(false)
    }

    return () => {
      eventSource.close()
      vtermRef.current = null
      linesRef.current = []
    }
  }, [sseUrl, appendLines, onConnectionChange])

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom()
    }
  }, [lines, scrollToBottom])

  const blocks = useMemo(() => groupIntoBlocks(lines), [lines])

  let lineNum = 0

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-log-scroll
      className={`overflow-y-auto overflow-x-hidden bg-[#0a0a0a] text-[#d4d4d4] custom-scrollbar ${className}`}
      style={{
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
        fontSize: `${fontSize}px`,
        lineHeight: 1.5,
      }}
    >
      <div className="p-3">
        {blocks.map((block, bi) => {
          if (block.type === 'codeblock') {
            const startLine = lineNum + 1
            lineNum += block.lines.length
            return (
              <div key={bi} className="my-2 rounded-lg border border-ive-border-dark bg-[#111] overflow-hidden">
                {block.lang && (
                  <div className="px-3 py-1 text-[0.75em] text-ive-text-dim bg-white/[0.03] border-b border-ive-border-dark uppercase tracking-wider">
                    {block.lang}
                  </div>
                )}
                <div className="p-3">
                  {block.lines.map((l, li) => (
                    <LogLine key={startLine + li} line={l} lineNum={startLine + li} showLineNum={showLineNumbers} timezone={timezone} />
                  ))}
                </div>
              </div>
            )
          }

          return block.lines.map((l, li) => {
            lineNum++
            return <LogLine key={`${bi}-${li}`} line={l} lineNum={lineNum} showLineNum={showLineNumbers} timezone={timezone} />
          })
        })}

        {(isLive ?? connected) && (
          <div className="flex items-center gap-1 pt-2 pb-1">
            {showLineNumbers && <span className="shrink-0 pr-2" />}
            <span className="inline-flex gap-[3px]">
              <span className="w-[5px] h-[5px] rounded-full bg-ive-cyan/70 animate-[thinking_1.4s_ease-in-out_infinite]" />
              <span className="w-[5px] h-[5px] rounded-full bg-ive-cyan/70 animate-[thinking_1.4s_ease-in-out_0.2s_infinite]" />
              <span className="w-[5px] h-[5px] rounded-full bg-ive-cyan/70 animate-[thinking_1.4s_ease-in-out_0.4s_infinite]" />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function useLogViewerScroll(containerRef: React.RefObject<HTMLDivElement | null>) {
  return useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [containerRef])
}
