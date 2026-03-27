'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ── ANSI 색상 매핑 ──
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

interface AnsiStyle {
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

interface StyledSegment {
  text: string
  style: AnsiStyle
}

/** ANSI 이스케이프 시퀀스를 파싱하여 스타일 세그먼트 배열로 변환 */
function parseAnsi(line: string): StyledSegment[] {
  const segments: StyledSegment[] = []
  const style: AnsiStyle = {}
  // ESC[ ... m 시퀀스 + OSC (ESC] ... BEL/ST) + 기타 CSI 시퀀스 매칭
  const regex = /\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;]*[A-Za-z]|\x1b\([A-Za-z]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(line)) !== null) {
    // 매치 이전 텍스트 추가
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), style: { ...style } })
    }
    lastIndex = regex.lastIndex

    const seq = match[0]
    // SGR 시퀀스만 처리 (ESC[...m)
    if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
      const codes = seq.slice(2, -1).split(';').map(Number)
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i]
        if (c === 0 || isNaN(c)) {
          // 리셋
          delete style.color; delete style.bg; delete style.bold
          delete style.dim; delete style.italic; delete style.underline; delete style.strikethrough
        } else if (c === 1) style.bold = true
        else if (c === 2) style.dim = true
        else if (c === 3) style.italic = true
        else if (c === 4) style.underline = true
        else if (c === 9) style.strikethrough = true
        else if (c === 22) { delete style.bold; delete style.dim }
        else if (c === 23) delete style.italic
        else if (c === 24) delete style.underline
        else if (c === 29) delete style.strikethrough
        else if (c === 39) delete style.color
        else if (c === 49) delete style.bg
        else if (ANSI_COLORS[c]) style.color = ANSI_COLORS[c]
        else if (ANSI_BG_COLORS[c]) style.bg = ANSI_BG_COLORS[c]
        else if (c === 38 && codes[i + 1] === 5) {
          // 256색 전경
          style.color = ansi256ToHex(codes[i + 2]); i += 2
        } else if (c === 48 && codes[i + 1] === 5) {
          // 256색 배경
          style.bg = ansi256ToHex(codes[i + 2]); i += 2
        } else if (c === 38 && codes[i + 1] === 2) {
          // 트루컬러 전경
          style.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4
        } else if (c === 48 && codes[i + 1] === 2) {
          // 트루컬러 배경
          style.bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4
        }
      }
    }
    // 다른 이스케이프 시퀀스는 무시 (OSC, CSI 커서 이동 등)
  }

  // 나머지 텍스트
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), style: { ...style } })
  }

  return segments
}

/** 256색 팔레트를 hex로 변환 */
function ansi256ToHex(n: number): string {
  if (n < 0 || n > 255) return '#d4d4d4'
  // 표준 16색
  const base16: string[] = [
    '#171717', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#e5e5e5',
    '#737373', '#fca5a5', '#86efac', '#fde68a', '#93c5fd', '#d8b4fe', '#67e8f9', '#ffffff',
  ]
  if (n < 16) return base16[n]
  // 216색 큐브 (16-231)
  if (n < 232) {
    const idx = n - 16
    const r = Math.floor(idx / 36), g = Math.floor((idx % 36) / 6), b = idx % 6
    const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  // 그레이스케일 (232-255)
  const gray = (8 + (n - 232) * 10).toString(16).padStart(2, '0')
  return `#${gray}${gray}${gray}`
}

/** 마크다운 인라인 파싱 (bold, italic, code, strikethrough, link) */
function parseMarkdownInline(text: string): (string | { tag: string; content: string; href?: string })[] {
  const tokens: (string | { tag: string; content: string; href?: string })[] = []
  // 패턴: `code`, **bold**, *italic*, ~~strike~~, [text](url)
  const regex = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index))
    }
    if (match[1] !== undefined) tokens.push({ tag: 'code', content: match[1] })
    else if (match[2] !== undefined) tokens.push({ tag: 'bold', content: match[2] })
    else if (match[3] !== undefined) tokens.push({ tag: 'italic', content: match[3] })
    else if (match[4] !== undefined) tokens.push({ tag: 'strike', content: match[4] })
    else if (match[5] !== undefined) tokens.push({ tag: 'link', content: match[5], href: match[6] })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex))
  }
  return tokens
}

/** 한 줄이 마크다운 블록 문법인지 감지 */
function detectMarkdownBlock(line: string): { type: string; level?: number; content: string } | null {
  // 헤더: # ~ ######
  const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
  if (headerMatch) return { type: 'header', level: headerMatch[1].length, content: headerMatch[2] }

  // 구분선: --- or *** or ___
  if (/^(\s*[-*_]){3,}\s*$/.test(line)) return { type: 'hr', content: '' }

  // 인용: > text
  const quoteMatch = line.match(/^>\s?(.*)$/)
  if (quoteMatch) return { type: 'quote', content: quoteMatch[1] }

  // 순서없는 리스트: - item or * item
  const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/)
  if (ulMatch) return { type: 'ul', content: ulMatch[2], level: Math.floor(ulMatch[1].length / 2) }

  // 순서있는 리스트: 1. item
  const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/)
  if (olMatch) return { type: 'ol', content: olMatch[2], level: Math.floor(olMatch[1].length / 2) }

  return null
}

/** 스타일 세그먼트를 React 엘리먼트로 렌더링 */
function renderSegments(segments: StyledSegment[], lineIdx: number, enableMarkdown: boolean) {
  return segments.map((seg, i) => {
    const s: React.CSSProperties = {}
    if (seg.style.color) s.color = seg.style.color
    if (seg.style.bg) s.backgroundColor = seg.style.bg
    if (seg.style.bold) s.fontWeight = 'bold'
    if (seg.style.dim) s.opacity = 0.6
    if (seg.style.italic) s.fontStyle = 'italic'
    const decorations: string[] = []
    if (seg.style.underline) decorations.push('underline')
    if (seg.style.strikethrough) decorations.push('line-through')
    if (decorations.length) s.textDecoration = decorations.join(' ')

    if (enableMarkdown && !seg.style.color && !seg.style.bg && !seg.style.bold) {
      // ANSI 스타일이 없는 텍스트에만 마크다운 인라인 적용
      const tokens = parseMarkdownInline(seg.text)
      if (tokens.length === 1 && typeof tokens[0] === 'string') {
        return <span key={`${lineIdx}-${i}`} style={Object.keys(s).length ? s : undefined}>{seg.text}</span>
      }
      return (
        <span key={`${lineIdx}-${i}`} style={Object.keys(s).length ? s : undefined}>
          {tokens.map((tok, j) => {
            if (typeof tok === 'string') return <span key={j}>{tok}</span>
            if (tok.tag === 'code') return <code key={j} className="bg-white/10 px-1 py-0.5 rounded text-[0.9em] text-ive-cyan">{tok.content}</code>
            if (tok.tag === 'bold') return <strong key={j} className="text-white font-bold">{tok.content}</strong>
            if (tok.tag === 'italic') return <em key={j} className="text-ive-text">{tok.content}</em>
            if (tok.tag === 'strike') return <del key={j} className="text-ive-text-dim">{tok.content}</del>
            if (tok.tag === 'link') return <a key={j} href={tok.href} target="_blank" rel="noopener noreferrer" className="text-ive-cyan underline hover:text-ive-cyan/80">{tok.content}</a>
            return null
          })}
        </span>
      )
    }

    return <span key={`${lineIdx}-${i}`} style={Object.keys(s).length ? s : undefined}>{seg.text}</span>
  })
}

// ── 코드블록 상태 추적 ──
interface CodeBlockState {
  inCodeBlock: boolean
  lang: string
}

function processCodeBlockLine(line: string, state: CodeBlockState): { state: CodeBlockState; render: 'open' | 'close' | 'code' | 'normal'; lang?: string } {
  const fenceMatch = line.match(/^```(\w*)$/)
  if (fenceMatch) {
    if (!state.inCodeBlock) {
      return { state: { inCodeBlock: true, lang: fenceMatch[1] }, render: 'open', lang: fenceMatch[1] }
    } else {
      return { state: { inCodeBlock: false, lang: '' }, render: 'close' }
    }
  }
  if (state.inCodeBlock) {
    return { state, render: 'code' }
  }
  return { state, render: 'normal' }
}

// ── 메인 컴포넌트 ──
interface LogViewerProps {
  /** SSE 엔드포인트 URL */
  sseUrl?: string
  /** 초기 로그 라인들 */
  initialLines?: string[]
  /** 폰트 크기 (기본 13) */
  fontSize?: number
  /** 최대 라인 수 (기본 50000) */
  maxLines?: number
  /** 마크다운 렌더링 활성화 (기본 true) */
  enableMarkdown?: boolean
  /** 연결 상태 콜백 */
  onConnectionChange?: (connected: boolean) => void
  /** 라인 수 콜백 */
  onLineCountChange?: (count: number) => void
  /** 클래스 */
  className?: string
}

export default function LogViewer({
  sseUrl,
  initialLines,
  fontSize = 13,
  maxLines = 50000,
  enableMarkdown = true,
  onConnectionChange,
  onLineCountChange,
  className = '',
}: LogViewerProps) {
  const [lines, setLines] = useState<string[]>(initialLines ?? [])
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const linesRef = useRef<string[]>(initialLines ?? [])

  // 자동 스크롤
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [])

  // 스크롤 이벤트: 사용자가 위로 스크롤하면 자동스크롤 중지
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50
  }, [])

  // 라인 추가
  const appendLines = useCallback((newLines: string[]) => {
    linesRef.current = [...linesRef.current, ...newLines]
    if (linesRef.current.length > maxLines) {
      linesRef.current = linesRef.current.slice(-maxLines)
    }
    setLines([...linesRef.current])
    onLineCountChange?.(linesRef.current.length)
  }, [maxLines, onLineCountChange])

  // SSE 연결
  useEffect(() => {
    if (!sseUrl) return

    const eventSource = new EventSource(sseUrl)

    eventSource.onopen = () => onConnectionChange?.(true)

    eventSource.onmessage = (event) => {
      const newLines = event.data.split('\n')
      appendLines(newLines)
    }

    eventSource.onerror = () => {
      eventSource.close()
      onConnectionChange?.(false)
    }

    return () => {
      eventSource.close()
    }
  }, [sseUrl, appendLines, onConnectionChange])

  // 자동 스크롤 적용
  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom()
    }
  }, [lines, scrollToBottom])

  // 모바일 터치 스크롤 (iOS Safari)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let touchY = 0
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY }
    const onTouchMove = (e: TouchEvent) => {
      const dy = touchY - e.touches[0].clientY
      touchY = e.touches[0].clientY
      el.scrollTop += dy
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  // 렌더링
  const renderedLines = useMemo(() => {
    const result: React.ReactNode[] = []
    let codeBlockState: CodeBlockState = { inCodeBlock: false, lang: '' }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const cbResult = enableMarkdown ? processCodeBlockLine(line, codeBlockState) : null

      if (cbResult) {
        codeBlockState = cbResult.state

        if (cbResult.render === 'open') {
          // 코드블록 시작 — 언어 라벨
          result.push(
            <div key={`cb-open-${i}`} className="mt-1 bg-white/5 border border-white/10 rounded-t-lg px-3 py-1 text-xs text-ive-text-dim font-mono">
              {cbResult.lang || 'code'}
            </div>
          )
          continue
        }
        if (cbResult.render === 'close') {
          // 코드블록 끝 — 닫기 라인
          result.push(
            <div key={`cb-close-${i}`} className="bg-white/5 border-x border-b border-white/10 rounded-b-lg h-1 mb-1" />
          )
          continue
        }
        if (cbResult.render === 'code') {
          // 코드블록 내부 — ANSI 파싱만, 마크다운 미적용
          const segments = parseAnsi(line)
          result.push(
            <div key={i} className="bg-white/5 border-x border-white/10 px-3 leading-relaxed">
              {renderSegments(segments, i, false)}
            </div>
          )
          continue
        }
      }

      // 일반 라인
      const segments = parseAnsi(line)
      const plainText = segments.map(s => s.text).join('')

      // 마크다운 블록 감지
      if (enableMarkdown) {
        const md = detectMarkdownBlock(plainText)
        if (md) {
          if (md.type === 'header') {
            const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-xs']
            const sz = sizes[Math.min((md.level ?? 1) - 1, 5)]
            const mdSegments = parseAnsi(line.replace(/^#{1,6}\s+/, ''))
            result.push(
              <div key={i} className={`${sz} font-bold text-white mt-2 mb-0.5`}>
                {renderSegments(mdSegments, i, true)}
              </div>
            )
            continue
          }
          if (md.type === 'hr') {
            result.push(<hr key={i} className="border-ive-border-dark my-1" />)
            continue
          }
          if (md.type === 'quote') {
            const mdSegments = parseAnsi(line.replace(/^>\s?/, ''))
            result.push(
              <div key={i} className="border-l-2 border-ive-cyan/50 pl-3 text-ive-text-muted italic">
                {renderSegments(mdSegments, i, true)}
              </div>
            )
            continue
          }
          if (md.type === 'ul') {
            const indent = (md.level ?? 0) * 16
            const mdSegments = parseAnsi(line.replace(/^\s*[-*+]\s+/, ''))
            result.push(
              <div key={i} className="flex" style={{ paddingLeft: indent }}>
                <span className="text-ive-green mr-2 shrink-0">•</span>
                <span>{renderSegments(mdSegments, i, true)}</span>
              </div>
            )
            continue
          }
          if (md.type === 'ol') {
            const indent = (md.level ?? 0) * 16
            const numMatch = line.match(/^(\s*)(\d+)\.\s+/)
            const num = numMatch ? numMatch[2] : '1'
            const mdSegments = parseAnsi(line.replace(/^\s*\d+\.\s+/, ''))
            result.push(
              <div key={i} className="flex" style={{ paddingLeft: indent }}>
                <span className="text-ive-cyan mr-2 shrink-0 tabular-nums">{num}.</span>
                <span>{renderSegments(mdSegments, i, true)}</span>
              </div>
            )
            continue
          }
        }
      }

      // 기본 라인 렌더링
      result.push(
        <div key={i} className="leading-relaxed">
          {segments.length === 0 || (segments.length === 1 && segments[0].text === '')
            ? '\u00A0'
            : renderSegments(segments, i, enableMarkdown)
          }
        </div>
      )
    }

    return result
  }, [lines, enableMarkdown])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`overflow-y-auto overflow-x-hidden bg-[#0a0a0a] text-[#d4d4d4] custom-scrollbar select-text ${className}`}
      style={{
        fontSize,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
        lineHeight: 1.4,
        wordBreak: 'break-all',
        whiteSpace: 'pre-wrap',
      }}
    >
      <div className="p-2">
        {renderedLines}
      </div>
    </div>
  )
}

/** 하단으로 스크롤 (외부에서 ref로 제어용) */
export function useLogViewerScroll(containerRef: React.RefObject<HTMLDivElement | null>) {
  return useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [containerRef])
}
