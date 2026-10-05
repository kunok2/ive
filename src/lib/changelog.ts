/**
 * CHANGELOG.md(Keep a Changelog) → 판별 변경 이력. 화면의 「변경 이력」(도움말 › 버전)이 쓴다.
 *
 * 릴리스된 판(`## [1.10.0] - 2026-10-05`)만 돌려준다 — `## [Unreleased]` 는 아직 배포된 판이 아니라 뺀다.
 * 머리말(첫 `## [` 앞)과 판 제목 줄은 본문에 넣지 않는다.
 */

export interface Release {
  version: string
  /** YYYY-MM-DD — 제목에 날짜가 없으면 null */
  date: string | null
  /** 그 판의 마크다운 본문(### Added 등 소제목 포함) */
  body: string
}

const HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = []
  let cur: { version: string; date: string | null; lines: string[] } | null = null
  const flush = () => {
    if (cur && cur.version.toLowerCase() !== 'unreleased') {
      releases.push({ version: cur.version, date: cur.date, body: cur.lines.join('\n').trim() })
    }
  }
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(HEADING)
    if (m) {
      flush()
      cur = { version: m[1], date: m[2] ?? null, lines: [] }
    } else if (cur) {
      cur.lines.push(line)
    }
  }
  flush()
  return releases
}
