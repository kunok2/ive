#!/usr/bin/env node
// 배포(납품) 이미지에 포함되는 프로덕션 의존성의 라이선스·저작권 고지를 수집한다.
// 산출물:
//   - public/third-party-notices.txt          : 전체 라이선스 전문(동봉/다운로드용)
//   - src/data/third-party-licenses.json       : 목록 페이지(/legal/licenses)용 메타데이터
//
// 주의: 플랫폼별 네이티브 바이너리(sharp-libvips, lightningcss 등)는 실행 OS에 따라
//       변형 패키지가 달라진다(같은 라이선스 계열). 정확히 배포본과 일치시키려면
//       리눅스(도커) 환경에서 재실행하는 것이 이상적이다.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LICENSE_FILE_RE = /^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i

function readLicenseText(dir) {
  let files = []
  try { files = fs.readdirSync(dir) } catch { return null }
  const matches = files.filter(f => LICENSE_FILE_RE.test(f))
  // LICENSE 우선, NOTICE는 뒤에 덧붙임
  matches.sort((a, b) => (/^NOTICE/i.test(a) ? 1 : 0) - (/^NOTICE/i.test(b) ? 1 : 0))
  const texts = []
  for (const f of matches) {
    try {
      const t = fs.readFileSync(path.join(dir, f), 'utf8').trim()
      if (t) texts.push(`----- ${f} -----\n${t}`)
    } catch { /* ignore */ }
  }
  return texts.length ? texts.join('\n\n') : null
}

function licenseId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && pkg.license.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map(l => l.type || l).join(' OR ')
  return 'UNKNOWN'
}

function repoUrl(pkg) {
  const r = pkg.repository
  if (!r) return ''
  const url = typeof r === 'string' ? r : r.url || ''
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
}

function authorStr(pkg) {
  const a = pkg.author
  if (!a) return ''
  if (typeof a === 'string') return a
  return [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ')
}

// 프로덕션 의존성 경로 수집 (dev 제외)
// npm ls 는 extraneous/invalid 가 있으면 비정상 종료하지만 stdout(경로 목록)은 정상 출력하므로,
// 종료코드는 무시하고 stdout 을 사용한다.
let out = ''
try {
  out = execSync('npm ls --omit=dev --all --parseable', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
} catch (e) {
  out = (e && e.stdout) ? e.stdout.toString() : ''
}
if (!out.trim()) { console.error('npm ls 출력이 비었습니다. node_modules 설치 상태를 확인하세요.'); process.exit(1) }
const dirs = [...new Set(out.split('\n').map(s => s.trim()).filter(Boolean))]

const seen = new Map() // name@version -> entry
for (const dir of dirs) {
  if (dir === ROOT) continue
  const pjPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pjPath)) continue
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(pjPath, 'utf8')) } catch { continue }
  if (!pkg.name || pkg.private) continue
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key)) continue
  seen.set(key, {
    name: pkg.name,
    version: pkg.version || '',
    license: licenseId(pkg),
    repository: repoUrl(pkg),
    author: authorStr(pkg),
    text: readLicenseText(dir),
  })
}

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))

// 라이선스별 집계
const byLicense = {}
for (const e of entries) byLicense[e.license] = (byLicense[e.license] || 0) + 1

// ── public/third-party-notices.txt (전문) ──
const header = [
  'THIRD-PARTY SOFTWARE NOTICES',
  'Springware IVE',
  '',
  `이 제품은 아래 오픈소스 소프트웨어를 포함합니다. 총 ${entries.length}개 패키지.`,
  'This product includes the open source software listed below.',
  '',
  '라이선스별 집계 / Summary by license:',
  ...Object.entries(byLicense).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`),
  '',
  '='.repeat(80),
  '',
].join('\n')

const body = entries.map(e => {
  const lines = [
    `${e.name}@${e.version}`,
    `License: ${e.license}`,
    e.repository && `Repository: ${e.repository}`,
    e.author && `Author: ${e.author}`,
    '',
    e.text || '(No license file found in package; see SPDX identifier above.)',
    '',
    '-'.repeat(80),
    '',
  ].filter(l => l !== false && l !== undefined)
  return lines.join('\n')
}).join('\n')

fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'public', 'third-party-notices.txt'), header + body, 'utf8')

// ── src/data/third-party-licenses.json (메타데이터만 — 페이지 경량화) ──
const meta = {
  generatedFrom: process.platform + '-' + process.arch,
  total: entries.length,
  byLicense,
  packages: entries.map(({ text, ...m }) => m),
}
fs.mkdirSync(path.join(ROOT, 'src', 'data'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'third-party-licenses.json'), JSON.stringify(meta, null, 2), 'utf8')

console.log(`생성 완료: ${entries.length}개 패키지`)
console.log('  public/third-party-notices.txt')
console.log('  src/data/third-party-licenses.json')
console.log('라이선스 집계:', JSON.stringify(byLicense))
