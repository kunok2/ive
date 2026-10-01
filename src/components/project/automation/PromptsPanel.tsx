'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ROW_CLS, SaveIndicator, Segmented, useAutosave } from './shared'

type Kind = 'dev' | 'reproduce' | 'verify' | 'confirm'

interface KindData {
  kind: Kind
  workerActive: boolean
  defaultBody: string
  override: { body: string; version: number; updatedAt: string } | null
  fixed: string
  history: { version: number; body: string | null; updatedByName: string | null; updatedAt: string }[]
}

/**
 * 역할별 프롬프트 — 편집 가능한 부분(관리자 설정 textarea 와 같이 blur 저장)과 IVE 고정 부분(읽기 전용 코드 블록), 변경 이력.
 */
export default function PromptsPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('automation')
  const tc = useTranslations('common')
  const [kinds, setKinds] = useState<KindData[] | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [active, setActive] = useState<Kind>('dev')
  // 편집 중인 값 — null 이면 저장된 값(덮어쓰기 또는 기본값)을 그대로 보인다
  const [draft, setDraft] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const { saving, saved, run } = useAutosave()

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/prompts`)
    if (!res.ok) return
    const d = await res.json()
    setKinds(d.kinds)
    setCanEdit(!!d.canEdit)
  }, [projectId])

  useEffect(() => { void (async () => { await load() })() }, [load])

  const cur = kinds?.find(k => k.kind === active) || null
  const effective = cur ? (cur.override?.body ?? cur.defaultBody) : ''
  const shown = draft ?? effective

  async function persist(body: string | null) {
    if (!cur) return
    const ok = await run(() => fetch(`/api/projects/${projectId}/prompts`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: cur.kind, body }),
    }))
    if (ok) { setDraft(null); await load() }
  }

  if (!kinds) return <div className="text-center py-10 text-ive-text-dim text-sm">{tc('loading')}</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('promptsHint')}</p>
        <SaveIndicator saving={saving} saved={saved} />
      </div>

      <Segmented
        value={active}
        onChange={k => { setActive(k); setShowHistory(false); setDraft(null) }}
        items={kinds.map(k => ({ value: k.kind, label: `${t(`kind_${k.kind}`)}${k.override ? ` v${k.override.version}` : ''}` }))}
      />

      {!canEdit && <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-lock mr-1" />{t('promptsOwnerOnly')}</p>}
      {cur && (
        <>
          {!cur.workerActive && (
            <div className="bg-ive-amber/10 border border-ive-amber/30 rounded-lg px-3 py-2.5 text-xs text-ive-amber leading-relaxed">
              <i className="fa-solid fa-triangle-exclamation mr-1.5" />{t('promptWorkerInactive')}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-bold text-ive-text-muted">
                {t('promptEditable')}
                <span className="ml-2 text-xs text-ive-text-dim font-normal">{cur.override ? t('promptOverridden', { version: cur.override.version }) : t('promptDefault')}</span>
              </label>
              {cur.override && canEdit && (
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setDraft(null); void persist(null) }} disabled={saving} className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40">
                  <i className="fa-solid fa-rotate-left mr-1" />{t('promptResetDefault')}
                </button>
              )}
            </div>
            <textarea
              value={shown}
              readOnly={!canEdit}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => { if (canEdit && draft !== null && draft !== effective) persist(draft) }}
              rows={10}
              className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50 font-mono resize-y"
            />
          </div>

          <div>
            <label className="text-sm font-bold text-ive-text-muted mb-1 block"><i className="fa-solid fa-lock mr-1.5 text-xs" />{t('promptFixed')}</label>
            <p className="text-xs text-ive-text-dim mb-1.5">{t('promptFixedHint')}</p>
            <pre className="bg-ive-bg-input border border-ive-border rounded-lg p-2 text-ive-text-muted overflow-x-auto font-mono text-xs whitespace-pre-wrap max-h-72 overflow-y-auto">{cur.fixed}</pre>
          </div>

          <div>
            <button type="button" onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1.5 text-sm font-bold text-ive-text-muted">
              <i className={`fa-solid ${showHistory ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs`} />
              {t('promptHistory')}
              {cur.history.length > 0 && <span className="text-xs font-bold bg-ive-cyan/20 text-ive-cyan px-1.5 py-0.5 rounded-lg">{cur.history.length}</span>}
            </button>
            {showHistory && (
              <div className="space-y-2 mt-2">
                {cur.history.length === 0 && <p className="text-xs text-ive-text-dim">{t('promptNoHistory')}</p>}
                {cur.history.map(h => (
                  <div key={h.version} className={`${ROW_CLS} text-xs`}>
                    <span className="font-bold text-ive-text">v{h.version}</span>
                    <span className="text-ive-text-muted">{h.body === null ? t('promptHistoryReset') : t('promptHistoryEdited')}</span>
                    <span className="flex-1" />
                    <span className="text-ive-text-dim">{h.updatedByName || '-'}</span>
                    <span className="text-ive-text-dim">{new Date(h.updatedAt.replace(' ', 'T') + 'Z').toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
