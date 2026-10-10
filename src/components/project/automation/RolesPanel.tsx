'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { SaveIndicator, Segmented, useAutosave } from './shared'

type RoleKey = 'process' | 'verify' | 'confirm'
const ROLE_KEYS: RoleKey[] = ['process', 'verify', 'confirm']
type ListFilter = 'all' | RoleKey | 'agent'
/** 한 번에 그리는 줄 수 — 사람이 수백 명이어도 화면이 길어지지 않게 (더 보기로 늘린다) */
const PAGE = 30
/** 추가 후보는 검색해서 고른다 — 검색어 없이는 이만큼만 보인다 */
const CANDIDATE_PREVIEW = 8
/** 기존 담당자 고르는 창(AssigneePickerModal)의 검색칸과 같은 모양 */
const SEARCH_CLS = 'w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50'
const NO_ROLES: Record<RoleKey, boolean> = { process: false, verify: false, confirm: false }

interface Entry {
  subjectType: 'user' | 'agent'
  subjectId: string
  name: string
  avatar: string
  roles?: Record<RoleKey, boolean>
  /** 사람: 이 프로젝트에서 그 역할을 할 때의 단가 배수 */
  rates?: Record<RoleKey, number>
  cliName?: string | null
  ownerName?: string
  source?: 'sync' | 'manual'
}

interface RolesData {
  canEdit: boolean
  roster: Entry[]
  candidates: { members: Entry[]; agents: Entry[] }
}

/**
 * 역할 명부 — SharingSection 과 같은 흐름: 위에 명부(줄마다 역할 칩·빼기), 아래에 「역할을 고르고 → 대상을 눌러 추가」.
 * 역할 칩은 관리자 사용자 권한(allowedClis) 칩과 같은 모양. 바뀌면 바로 저장.
 * 사람 줄에는 켠 역할마다 단가 배수(이 프로젝트에서 그 역할을 할 때, 기본 단가 × 배수)를 같이 둔다 — 보고서 사람 비용에 쓰인다.
 */
export default function RolesPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('automation')
  const tc = useTranslations('common')
  const [data, setData] = useState<RolesData | null>(null)
  const [addRole, setAddRole] = useState<RoleKey>('confirm')
  // 단가 배수 입력 중인 값 — `${subjectId}:${role}` → 문자열 (칸을 벗어나면 저장)
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({})
  // 명부 검색·필터·더 보기, 추가 후보 검색
  const [query, setQuery] = useState('')
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const [shown, setShown] = useState(PAGE)
  const [addQuery, setAddQuery] = useState('')
  const { saving, saved, run } = useAutosave()

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/roles`)
    if (res.ok) setData(await res.json())
  }, [projectId])

  useEffect(() => { void (async () => { await load() })() }, [load])

  async function save(e: Entry, roles: Record<RoleKey, boolean>) {
    const ok = await run(() => fetch(`/api/projects/${projectId}/roles`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectType: e.subjectType, subjectId: e.subjectId, roles }),
    }))
    if (ok) await load()
  }

  async function saveRate(e: Entry, k: RoleKey) {
    const key = `${e.subjectId}:${k}`
    const raw = rateDraft[key]
    const clear = () => setRateDraft(d => { const x = { ...d }; delete x[key]; return x })
    if (raw === undefined) return
    const v = Math.round(parseFloat(raw) * 100) / 100
    if (!Number.isFinite(v) || v <= 0 || v === (e.rates?.[k] ?? 1)) { clear(); return }
    const ok = await run(() => fetch(`/api/projects/${projectId}/roles`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectType: 'user', subjectId: e.subjectId, rates: { [k]: v } }),
    }))
    if (ok) await load()
    clear()
  }

  if (!data) return <div className="text-center py-10 text-ive-text-dim text-sm">{tc('loading')}</div>

  const matches = (e: Entry, q: string) => {
    if (!q) return true
    const x = q.toLowerCase()
    return e.name.toLowerCase().includes(x) || e.subjectId.toLowerCase().includes(x) || (e.cliName || '').toLowerCase().includes(x)
  }
  const rosterFiltered = data.roster
    .filter(e => listFilter === 'all' ? true : listFilter === 'agent' ? e.subjectType === 'agent' : !!e.roles?.[listFilter])
    .filter(e => matches(e, query.trim()))
  const rosterShown = rosterFiltered.slice(0, shown)
  const candidatesAll = [...data.candidates.agents, ...data.candidates.members]
  const candidatesFound = candidatesAll.filter(e => matches(e, addQuery.trim()))
  const candidates = addQuery.trim() ? candidatesFound.slice(0, PAGE) : candidatesAll.slice(0, CANDIDATE_PREVIEW)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-info-circle mr-1" />{t('rolesHint')}</p>
        <SaveIndicator saving={saving} saved={saved} />
      </div>

      {data.roster.length > 0 && (
        <div className="space-y-2">
          <input type="text" value={query} onChange={ev => { setQuery(ev.target.value); setShown(PAGE) }}
            onKeyDown={ev => { if (ev.key === 'Enter') ev.preventDefault() }}
            placeholder={t('rosterSearch')} className={SEARCH_CLS} />
          <Segmented
            value={listFilter}
            onChange={v => { setListFilter(v); setShown(PAGE) }}
            items={[
              { value: 'all', label: `${t('filterAll')} ${data.roster.length}` },
              ...ROLE_KEYS.map(k => ({ value: k, label: `${t(`role_${k}`)} ${data.roster.filter(e => e.roles?.[k]).length}` })),
              // 좁은 화면에서 한 줄에 맞도록 에이전트는 아이콘 + 수
              { value: 'agent' as const, label: `${data.roster.filter(e => e.subjectType === 'agent').length}`, icon: 'fa-bolt' },
            ]}
          />
        </div>
      )}
      {data.roster.length > 0 ? (
        <div className="space-y-2">
          {rosterShown.length === 0 && <p className="text-xs text-ive-text-dim">{t('rosterNoMatch')}</p>}
          {rosterShown.map(e => {
            const roles = e.roles || NO_ROLES
            const rated = e.subjectType === 'user' ? ROLE_KEYS.filter(k => roles[k]) : []
            return (
              <div key={`${e.subjectType}:${e.subjectId}`} className="bg-ive-bg-deep rounded-lg px-3 py-2 border border-ive-border-dark space-y-1.5">
              <div className="flex items-center gap-2">
                <AgentAvatar avatar={e.avatar || 'av-01'} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-ive-text truncate">
                    {e.name}
                    {e.subjectType === 'agent' && <i className="fa-solid fa-bolt text-xs text-ive-text-dim ml-1.5" />}
                  </div>
                  <div className="text-xs text-ive-text-dim truncate">
                    {e.subjectType === 'agent' ? (e.cliName || '') : `@${e.subjectId}${e.source === 'sync' ? ` · ${t('rosterAutoSynced')}` : ''}`}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {ROLE_KEYS.map(k => (
                    <button
                      key={k}
                      type="button"
                      disabled={!data.canEdit || saving}
                      title={t(`roleHint_${k}`)}
                      onClick={() => save(e, { ...roles, [k]: !roles[k] })}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all disabled:opacity-40 ${roles[k] ? 'bg-ive-green/10 border-ive-green text-ive-green' : 'bg-ive-bg-deep border-ive-border-subtle text-ive-text-dim'}`}
                    >
                      {t(`role_${k}`)}
                    </button>
                  ))}
                </div>
                {data.canEdit && ROLE_KEYS.some(k => roles[k]) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => save(e, NO_ROLES)}
                    className="text-ive-red/60 hover:text-ive-red transition-colors p-1"
                    title={t('rosterRemove')}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                )}
                {/* 역할을 모두 끈 줄(제외 기록)은 뺄 것이 없다 — 칩 정렬이 어긋나지 않게 같은 폭만 비워 둔다 */}
                {data.canEdit && !ROLE_KEYS.some(k => roles[k]) && <span className="p-1 invisible" aria-hidden><i className="fa-solid fa-xmark" /></span>}
              </div>
              {rated.length > 0 && (
                // 단가 배수 — 이 프로젝트에서 그 역할을 할 때 (기본 단가 × 배수). 입력은 개발자 카드의 배수 칸과 같은 모양, 칸을 벗어나면 저장
                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs font-bold pl-9" title={t('rateMultiplierHint')}>
                  <span className="text-ive-text-dim"><i className="fa-solid fa-coins mr-1" />{t('rateMultiplier')}</span>
                  {rated.map(k => {
                    const key = `${e.subjectId}:${k}`
                    return (
                      <span key={k} className="inline-flex items-center gap-1">
                        <span className="text-ive-text-muted">{t(`role_${k}`)}</span>
                        <span className="text-ive-text-dim">×</span>
                        <input
                          type="number" inputMode="decimal" min="0.1" step="0.1"
                          disabled={!data.canEdit || saving}
                          value={rateDraft[key] ?? String(e.rates?.[k] ?? 1)}
                          onChange={ev => setRateDraft(d => ({ ...d, [key]: ev.target.value }))}
                          onBlur={() => saveRate(e, k)}
                          onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLInputElement).blur() } }}
                          className="w-14 px-2 py-0.5 rounded-lg bg-ive-bg-input border border-ive-border-dark text-ive-text font-bold text-sm text-right focus:outline-none focus:border-ive-cyan/50 disabled:opacity-60"
                        />
                      </span>
                    )
                  })}
                </div>
              )}
              </div>
            )
          })}
          {rosterFiltered.length > rosterShown.length && (
            <button type="button" onClick={() => setShown(n => n + PAGE)}
              className="w-full py-2 text-sm font-bold text-ive-cyan border border-ive-cyan/30 rounded-lg hover:bg-ive-cyan/10 transition-all">
              {t('showMore', { count: rosterFiltered.length - rosterShown.length })}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-users-slash mr-1" />{t('rosterEmpty')}</p>
      )}

      {data.canEdit && (
        candidatesAll.length > 0 ? (
          <div className="space-y-2 border-t border-ive-border-dark pt-3">
            <label className="block text-sm font-bold text-ive-text-muted ml-1"><i className="fa-solid fa-user-plus mr-1.5 text-xs" />{t('rosterAdd')}</label>
            <Segmented
              value={addRole}
              onChange={setAddRole}
              items={ROLE_KEYS.map(k => ({ value: k, label: t(`role_${k}`) }))}
            />
            <input type="text" value={addQuery} onChange={ev => setAddQuery(ev.target.value)}
              onKeyDown={ev => { if (ev.key === 'Enter') ev.preventDefault() }}
              placeholder={t('rosterAddSearch', { count: candidatesAll.length })} className={SEARCH_CLS} />
            <div className="space-y-1">
              {addQuery.trim() && candidates.length === 0 && <p className="text-xs text-ive-text-dim">{t('rosterNoMatch')}</p>}
              {candidates.map(e => (
                <button
                  key={`c:${e.subjectType}:${e.subjectId}`}
                  type="button"
                  disabled={saving}
                  onClick={() => save(e, { ...NO_ROLES, [addRole]: true })}
                  className="w-full text-left px-3 py-2.5 text-sm bg-ive-bg-deep rounded-lg border border-ive-border-dark hover:border-ive-cyan/40 hover:bg-ive-cyan/5 transition-all flex items-center gap-2 disabled:opacity-40"
                >
                  <AgentAvatar avatar={e.avatar || 'av-01'} size="sm" />
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-ive-text">{e.name}</span>
                    <span className="text-ive-text-dim text-xs ml-1.5">
                      {e.subjectType === 'agent' ? `${e.cliName || ''}${e.ownerName ? ` · ${e.ownerName}` : ''}` : `@${e.subjectId}`}
                    </span>
                  </div>
                  <i className="fa-solid fa-plus text-xs text-ive-cyan/60" />
                </button>
              ))}
              {(addQuery.trim() ? candidatesFound.length : candidatesAll.length) > candidates.length && (
                <p className="text-xs text-ive-text-dim ml-1">{t('rosterMoreCandidates', { count: (addQuery.trim() ? candidatesFound.length : candidatesAll.length) - candidates.length })}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-users-slash mr-1" />{t('rosterNoCandidates')}</p>
        )
      )}
      {!data.canEdit && <p className="text-xs text-ive-text-dim"><i className="fa-solid fa-lock mr-1" />{t('readOnly')}</p>}
    </div>
  )
}
