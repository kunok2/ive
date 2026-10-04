'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'

/**
 * 이 탭이 돌고 있는 판과 서버가 지금 내보내는 판을 견준다 — 다르면 새로고침해야 새 판이 온다.
 * (메타샵 useAppVersionWatch 와 같은 방식)
 *
 * 웹앱(홈 화면에 추가)으로 열어 두면 배포가 끝나도 처음 받은 JS 가 계속 돌아, 앱을 껐다 켜야 반영됐다.
 *
 * - 기준은 이 탭이 처음 읽은 /api/version 값이다(그 순간 이 탭의 번들과 같은 판에서 왔다).
 * - 주기로 두드리지 않는다. 창으로 돌아올 때·화면을 옮길 때만, 최소 1분 간격.
 * - 못 읽어도 조용히 지나간다 — 이것 때문에 상단바가 흔들리거나 경고가 뜨면 안 된다.
 */
interface VersionInfo { version: string; buildId: string }

const MIN_GAP_MS = 60_000
let baseline: string | null = null
let latest: string | null = null
let latestVersion: string | null = null
let lastReadAt = 0
let bound = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

const keyOf = (v: VersionInfo) => `${v.version}@${v.buildId}`

async function check(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - lastReadAt < MIN_GAP_MS) return
  lastReadAt = now
  try {
    const res = await fetch(`/api/version?t=${now}`, { cache: 'no-store' })
    if (!res.ok) return
    const d = await res.json() as Partial<VersionInfo>
    if (typeof d.version !== 'string' || typeof d.buildId !== 'string' || (!d.version && !d.buildId)) return
    const key = keyOf(d as VersionInfo)
    if (!baseline) baseline = key
    if (latest !== key) { latest = key; latestVersion = d.version; emit() }
  } catch { /* 못 읽어도 넘어간다 */ }
}

function onVisible() { if (document.visibilityState === 'visible') void check() }
function onFocus() { void check() }

function subscribe(l: () => void) {
  listeners.add(l)
  if (!bound) {
    bound = true
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
  }
  return () => { listeners.delete(l) }
}
const getStale = () => !!baseline && !!latest && baseline !== latest
const getServerStale = () => false

/** 새 판이 나왔는지(이 탭이 옛 번들인지)와 새 판 번호, 새로고침 함수 */
export function useAppVersionWatch() {
  const pathname = usePathname()
  const stale = useSyncExternalStore(subscribe, getStale, getServerStale)
  // 처음 한 번은 바로(기준 잡기), 그 뒤로는 화면을 옮길 때 — 최소 간격은 check 가 지킨다
  useEffect(() => { void check(!baseline) }, [pathname])
  return { stale, latestVersion: stale ? latestVersion : null, reload: () => window.location.reload() }
}
