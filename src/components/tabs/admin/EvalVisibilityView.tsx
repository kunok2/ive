'use client'

/**
 * 작업 결과 평가의 사람별 결과를 누가 보나 — 관리자와 본인(기본) / 본인만. 고르면 바로 저장.
 * 평가는 여러 프로젝트를 합쳐 세므로 조직 전체 설정으로 둔다. AI(모델) 결과와 사람·AI 묶음은 항상 모두에게 보인다.
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/Toast'

const KEY = 'report.eval_visibility'
type Vis = 'admin_self' | 'self'

export default function EvalVisibilityView() {
  const t = useTranslations('reportV2')
  const { toast } = useToast()
  const [vis, setVis] = useState<Vis | null>(null)
  const [loadError, setLoadError] = useState(false)

  // 지금 값을 읽지 못하면 기본값을 보여주지 않는다(저장된 값인 줄 알고 눌러 덮어쓰지 않게)
  useEffect(() => {
    fetch('/api/admin/env').then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setVis(d?.settings?.[KEY] === 'self' ? 'self' : 'admin_self'))
      .catch(() => setLoadError(true))
  }, [])

  async function choose(next: Vis) {
    const prev = vis
    setVis(next)
    const r = await fetch('/api/admin/env', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { [KEY]: next } }) }).catch(() => null)
    if (!r?.ok) { setVis(prev); toast(t('evalVis.failed'), 'error') }
  }

  if (loadError) return <p className="text-xs font-bold text-ive-red">{t('evalVis.loadFailed')}</p>
  if (!vis) return null
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <i className="fa-solid fa-eye text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('evalVis.title')}</span>
      </div>
      <p className="text-xs text-ive-text-dim">{t('evalVis.desc')}</p>
      <div className="flex gap-1.5">
        {(['admin_self', 'self'] as Vis[]).map(v => (
          <button key={v} type="button" onClick={() => vis !== v && choose(v)}
            className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${vis === v ? 'bg-ive-green/15 border-ive-green/40 text-ive-green' : 'bg-ive-bg-deep border-ive-border-subtle text-ive-text-dim'}`}>
            {t(`evalVis.${v}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
