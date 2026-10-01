'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/Toast'
import { ROW_CLS } from './shared'

interface Item {
  id: number
  issueIid: number
  status: string
  issueTitle: string | null
  sourceSha: string
  mergeSha: string | null
  mrUrl: string | null
  mrResult: string | null
  note: string | null
  queuedAt: string
}
interface Bundle {
  id: number
  status: string
  targetBranch: string
  pushedSha: string | null
  pipelineStatus: string | null
  pipelineUrl: string | null
  note: string | null
  createdAt: string
  items: Item[]
}
interface BundlesData {
  canEdit: boolean
  waiting: Item[]
  nextAt: number | null
  inFlight: Bundle | null
  holding: Bundle | null
  recent: Bundle[]
}

const STATUS_BADGE: Record<string, string> = {
  awaiting_approval: 'bg-ive-amber/20 text-ive-amber',
  departing: 'bg-ive-cyan/20 text-ive-cyan',
  pushed: 'bg-ive-cyan/20 text-ive-cyan',
  deployed: 'bg-ive-cyan/20 text-ive-cyan',
  done: 'bg-ive-green/20 text-ive-green',
  failed: 'bg-ive-red/20 text-ive-red',
  broken: 'bg-ive-red/20 text-ive-red',
}
const ITEM_BADGE: Record<string, string> = {
  pushed: 'bg-ive-cyan/20 text-ive-cyan',
  done: 'bg-ive-green/20 text-ive-green',
  conflict: 'bg-ive-red/20 text-ive-red',
  check_failed: 'bg-ive-red/20 text-ive-red',
}
const DIM_BADGE = 'bg-white/5 text-ive-text-dim'
const BTN = 'text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40 shrink-0'

/** SQLite UTC('YYYY-MM-DD HH:MM:SS') → 보는 사람 시간대 */
const localTime = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`).toLocaleString()

/**
 * 프로젝트 상세 — 묶음 배포 현황: 진행 중 묶음(승인), 보류(해제), 대기열과 다음 출발 예정, 최근 묶음.
 * 출발 조건·검사 명령 같은 설정은 프로젝트 화면의 역할·단계 자동화 → 자동화 탭에 있다.
 */
export default function BundlesPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('automation')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [data, setData] = useState<BundlesData | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRecent, setShowRecent] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/bundles`).catch(() => null)
    if (res?.ok) setData(await res.json())
  }, [projectId])

  useEffect(() => {
    void (async () => { await load() })()
    const timer = setInterval(() => { void load() }, 20_000)
    return () => clearInterval(timer)
  }, [load])

  async function act(action: 'approve' | 'release', bundleId: number) {
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/bundles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, bundleId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast(d.error || tc('saveFailed'), 'error'); return }
      toast(t(action === 'approve' ? 'bundleApproved' : 'bundleReleased'), 'success')
      await load()
    } finally { setBusy(false) }
  }

  // 묶음 배포를 쓴 적이 없는 프로젝트에는 섹션 자체를 보이지 않는다(설정은 프로젝트 설정에 있다)
  if (!data || (!data.waiting.length && !data.inFlight && !data.holding && !data.recent.length)) return null

  const itemRow = (it: Item, showStatus: boolean) => (
    <div key={it.id} className={`${ROW_CLS} text-xs`}>
      <Link href={`/issues/${projectId}/${it.issueIid}`} className="font-bold text-ive-cyan hover:opacity-80 shrink-0">#{it.issueIid}</Link>
      <span className="flex-1 min-w-0 truncate text-ive-text">{it.issueTitle || ''}</span>
      {it.mergeSha && <span className="font-mono text-ive-text-dim shrink-0">{it.mergeSha.slice(0, 8)}</span>}
      {it.mrResult && <span className="text-ive-text-dim shrink-0" title={t(`mrResult_${it.mrResult}`)}><i className={`fa-solid ${it.mrResult === 'merged_by_push' ? 'fa-code-merge' : 'fa-circle-xmark'}`} /></span>}
      {showStatus && <span className={`font-bold px-2 py-0.5 rounded-lg shrink-0 ${ITEM_BADGE[it.status] || DIM_BADGE}`} title={it.note || ''}>{t(`bundleItem_${it.status}`)}</span>}
    </div>
  )

  const bundleBox = (b: Bundle, hold: boolean) => (
    <div className={`bg-ive-bg-deep rounded-lg px-3 py-2 border space-y-2 ${hold ? 'border-ive-red/40' : 'border-ive-border-dark'}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-bold text-ive-text">#{b.id}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${STATUS_BADGE[b.status] || DIM_BADGE}`}>{t(`bundleStatus_${b.status}`)}</span>
        <span className="text-xs text-ive-text-dim font-mono">{t('bundleTarget', { branch: b.targetBranch })}</span>
        {b.pushedSha && <span className="text-xs text-ive-text-dim font-mono">{t('bundlePushed', { sha: b.pushedSha.slice(0, 8) })}</span>}
        {b.pipelineUrl && (
          <a href={b.pipelineUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-ive-cyan hover:opacity-80">
            <i className="fa-solid fa-rocket mr-1" />{t('bundlePipeline')} {b.pipelineStatus || ''}
          </a>
        )}
        <span className="flex-1" />
        {data.canEdit && b.status === 'awaiting_approval' && (
          <button type="button" disabled={busy} onClick={() => act('approve', b.id)} className={BTN}>
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-play'} mr-1`} />{t('bundleApprove')}
          </button>
        )}
        {data.canEdit && hold && (
          <button type="button" disabled={busy} onClick={() => act('release', b.id)} className={BTN}>
            <i className={`fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-unlock'} mr-1`} />{t('bundleRelease')}
          </button>
        )}
      </div>
      {b.note && <p className={`text-xs ${hold ? 'text-ive-red' : 'text-ive-text-muted'}`}>{b.note}</p>}
      {hold && <p className="text-xs text-ive-text-dim">{t('bundleHoldHint')}</p>}
      <div className="space-y-1">{b.items.map(it => itemRow(it, true))}</div>
    </div>
  )

  return (
    <div className="mt-6">
    <h2 className="text-base font-bold text-ive-text uppercase tracking-widest flex items-center gap-2 mb-3 px-1">
      <span className="w-1.5 h-1.5 rounded-full bg-ive-green" />
      {t('bundlesSectionTitle')}
    </h2>
    <div className="bg-ive-bg-card rounded-lg border border-ive-border-subtle p-4 space-y-3">
      {data.holding && bundleBox(data.holding, true)}
      {data.inFlight && bundleBox(data.inFlight, false)}

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-ive-text-muted">{t('bundleWaitingCount', { count: data.waiting.length })}</span>
          <span className="flex-1" />
          {data.waiting.length > 0 && (
            <span className="text-ive-text-dim">
              <i className="fa-regular fa-clock mr-1" />
              {data.nextAt ? t('bundleNextAt', { time: new Date(data.nextAt).toLocaleString() }) : t('bundleNextAfterCurrent')}
            </span>
          )}
        </div>
        {data.waiting.length === 0
          ? <p className="text-xs text-ive-text-dim">{t('bundleNoWaiting')}</p>
          : data.waiting.map(it => itemRow(it, false))}
      </div>

      {data.recent.some(b => b.id !== data.inFlight?.id && b.id !== data.holding?.id) && (
        <div>
          <button type="button" onClick={() => setShowRecent(!showRecent)} className="flex items-center gap-1.5 text-sm font-bold text-ive-text-muted">
            <i className={`fa-solid ${showRecent ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs`} />
            {t('bundleRecent')}
          </button>
          {showRecent && (
            <div className="space-y-2 mt-2">
              {data.recent.filter(b => b.id !== data.inFlight?.id && b.id !== data.holding?.id).map(b => (
                <div key={b.id}>
                  <p className="text-xs text-ive-text-dim mb-1 ml-1">{localTime(b.createdAt)}</p>
                  {bundleBox(b, false)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  )
}
