'use client'

/**
 * 사람 이름 연결 — 기록에 남은 이름·Git 계정을 IVE 사용자에 잇는다(고르면 바로 저장).
 * 보고서의 사람별 집계가 한 사람을 여러 이름으로 나눠 세지 않게 한다.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import CustomSelect from '@/components/ui/CustomSelect'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { userToOption } from '@/lib/user-display'
import { useToast } from '@/components/ui/Toast'

interface Row { alias: string; kind: 'name' | 'gitlab' | 'github'; count?: number; userId?: string }
interface Data { unresolved: Row[]; linked: Row[]; users: { id: string; name: string; email: string; avatar: string }[] }

export default function PersonAliasView() {
  const t = useTranslations('reportV2')
  const { toast } = useToast()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // 처음 불러오기에 실패하면 안내만, 이미 그린 뒤 다시 불러오기에 실패하면 목록은 두고 알린다
  const loaded = useRef(false)
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/people')
      if (!r.ok) throw new Error()
      setData(await r.json())
      setLoadError(false)
      loaded.current = true
    } catch {
      if (loaded.current) toast(t('people.loadFailed'), 'error')
      else setLoadError(true)
    }
  }, [toast, t])
  useEffect(() => { load() }, [load])

  async function link(row: Row, userId: string) {
    setBusy(`${row.kind}:${row.alias}`)
    try {
      const r = await fetch('/api/admin/people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: row.alias, kind: row.kind, userId }) })
      if (!r.ok) toast(t('people.failed'), 'error')
      await load()
    } catch { toast(t('people.failed'), 'error') } finally { setBusy(null) }
  }

  async function unlink(row: Row) {
    setBusy(`${row.kind}:${row.alias}`)
    try {
      const r = await fetch(`/api/admin/people?alias=${encodeURIComponent(row.alias)}&kind=${row.kind}`, { method: 'DELETE' })
      if (!r.ok) toast(t('people.unlinkFailed'), 'error')
      await load()
    } catch { toast(t('people.unlinkFailed'), 'error') } finally { setBusy(null) }
  }

  if (loadError) return <p className="text-xs font-bold text-ive-red">{t('people.loadFailed')}</p>
  if (!data) return null
  const userName = (id?: string) => data.users.find(u => u.id === id)?.name ?? id ?? ''
  const options = data.users.map(userToOption)

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2">
        <i className="fa-solid fa-link text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('people.title')}</span>
        <span className="text-xs text-ive-text-dim">{t('people.unresolvedN', { n: data.unresolved.length })}</span>
      </div>
      <div className="px-4 pb-4 border-t border-ive-border-dark pt-3 space-y-3">
        <p className="text-xs text-ive-text-dim">{t('people.desc')}</p>
        {data.unresolved.length === 0 ? (
          <p className="text-xs font-bold text-ive-text-secondary">{t('people.allResolved')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.unresolved.map(r => (
              <div key={`${r.kind}:${r.alias}`} className="flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="text-sm font-bold text-ive-text truncate">{r.alias}</span>
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{t(`people.kind.${r.kind}`)}</span>
                  <span className="text-xs text-ive-text-dim shrink-0">{t('people.records', { n: r.count ?? 0 })}</span>
                </div>
                <CustomSelect size="sm" className="w-44 shrink-0" value="" placeholder={t('people.pick')} onChange={v => { if (v) link(r, v) }} options={options} disabled={busy === `${r.kind}:${r.alias}`} />
              </div>
            ))}
          </div>
        )}
        {data.linked.length > 0 && (
          <div className="pt-2 border-t border-ive-border-dark flex flex-col gap-1.5">
            <span className="text-xs font-bold text-ive-text-muted">{t('people.linked')}</span>
            {data.linked.map(r => (
              <div key={`${r.kind}:${r.alias}`} className="flex items-center gap-2 text-sm">
                <span className="font-bold text-ive-text truncate">{r.alias}</span>
                <span className="text-xs text-ive-text-dim shrink-0">{t(`people.kind.${r.kind}`)}</span>
                <i className="fa-solid fa-arrow-right text-xs text-ive-text-dim" />
                <span className="flex-1 min-w-0 flex items-center gap-1.5">
                  {(() => { const u = data.users.find(x => x.id === r.userId); return <AgentAvatar avatar={u?.avatar || 'person'} userId={u?.id} size="xs" /> })()}
                  <span className="font-bold text-ive-text truncate">{userName(r.userId)}</span>
                </span>
                <button onClick={() => unlink(r)} disabled={busy === `${r.kind}:${r.alias}`} aria-label={t('people.unlink')} title={t('people.unlink')} className="w-8 h-8 rounded-lg flex items-center justify-center text-xs text-ive-text-dim hover:bg-white/5 disabled:opacity-40">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
