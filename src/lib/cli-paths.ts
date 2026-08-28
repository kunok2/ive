import fs from 'fs'
import path from 'path'

/**
 * CLI 실행 파일의 기본 경로를 찾는다.
 *
 * 도커 이미지는 모든 CLI 를 /usr/local/bin 에 두지만, 개발 머신이나 직접 설치 환경은
 * 설치 방식마다 위치가 다르다(agy 설치 스크립트는 ~/.local/bin, Homebrew 는 /opt/homebrew/bin).
 * 관례 경로 → PATH 순으로 실제 존재하는 파일을 찾고, 없으면 /usr/local/bin/<cli> 를 돌려준다.
 */
export function resolveCliPath(cli: string): string {
  const fallback = `/usr/local/bin/${cli}`
  const home = process.env.HOME || ''
  const candidates = [
    fallback,
    home ? path.join(home, '.local/bin', cli) : '',
    '/opt/homebrew/bin/' + cli,
    ...(process.env.PATH || '').split(':').filter(Boolean).map(d => path.join(d, cli)),
  ].filter(Boolean)
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c } catch { /* ignore */ }
  }
  return fallback
}
