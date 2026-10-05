import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseChangelog } from '@/lib/changelog'

describe('parseChangelog', () => {
  it('릴리스된 판만 — Unreleased·머리말은 빼고, 판 제목 줄은 본문에 넣지 않는다', () => {
    const md = [
      '# Changelog', '', '머리말', '',
      '## [Unreleased]', '', '### Added', '- 아직', '',
      '## [1.10.0] - 2026-10-05', '', '### Added', '- 새 기능', '',
      '## [1.9.0] - 2026-10-03', '', '### Fixed', '- 고침', '',
      '## [1.0.0]', '', '- 처음',
    ].join('\n')
    expect(parseChangelog(md)).toEqual([
      { version: '1.10.0', date: '2026-10-05', body: '### Added\n- 새 기능' },
      { version: '1.9.0', date: '2026-10-03', body: '### Fixed\n- 고침' },
      { version: '1.0.0', date: null, body: '- 처음' },
    ])
  })

  it('저장소의 CHANGELOG.md 를 읽어 최신 판이 package.json 판과 같다', () => {
    const root = path.join(__dirname, '..')
    const md = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const releases = parseChangelog(md)
    expect(releases.length).toBeGreaterThan(0)
    expect(releases[0].version).toBe(pkg.version)
    expect(releases[0].body.length).toBeGreaterThan(0)
  })
})
