'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { User, UserActivityLog } from '@/types'
import { useStore } from '@/lib/store'
import { formatDateWithSeconds } from '@/lib/format-date'
import MultiSelectPicker from '@/components/ui/MultiSelectPicker'
import CustomSelect from '@/components/ui/CustomSelect'

// 카테고리는 아이콘으로 구분, 색은 의미가 있을 때만 (위험 admin / 정보 auth)
const CATEGORY_META: Record<string, { labelKey: string; icon: string; color: string }> = {
  auth: { labelKey: 'categoryAuth', icon: 'fa-solid fa-right-to-bracket', color: 'text-ive-cyan' },
  project: { labelKey: 'categoryProject', icon: 'fa-solid fa-folder', color: 'text-ive-text-muted' },
  agent: { labelKey: 'categoryAgent', icon: 'fa-solid fa-robot', color: 'text-ive-text-muted' },
  execution: { labelKey: 'categoryExecution', icon: 'fa-solid fa-play', color: 'text-ive-text-muted' },
  task: { labelKey: 'categoryTask', icon: 'fa-solid fa-list-check', color: 'text-ive-text-muted' },
  admin: { labelKey: 'categoryAdmin', icon: 'fa-solid fa-shield', color: 'text-ive-red' },
  settings: { labelKey: 'categorySettings', icon: 'fa-solid fa-gear', color: 'text-ive-text-muted' },
}

function getDateStr(daysAgo: number) {
  // toISOString()은 UTC 날짜 반환 — KST 09:00 이전이면 "어제" 날짜가 나온다.
  // KST(+9h)로 보정 후 날짜 문자열을 추출해야 사용자 기준 당일 날짜가 정확히 나온다.
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const kst = new Date(new Date().getTime() + KST_OFFSET_MS)
  kst.setUTCDate(kst.getUTCDate() - daysAgo)
  return kst.toISOString().slice(0, 10)
}

const DATE_PRESETS: { labelKey: string; days: number | null }[] = [
  { labelKey: 'dateToday', days: 0 },
  { labelKey: 'dateDays7', days: 7 },
  { labelKey: 'dateDays30', days: 30 },
  { labelKey: 'dateDays90', days: 90 },
  { labelKey: 'dateAll', days: null },
]

// 정렬 필드 — 필드 선택 + 방향(ASC/DESC) 토글의 표준 패턴.
// 방향은 사용자가 명시적으로 변경한 값을 유지(필드 전환 시 리셋하지 않음).
const SORT_FIELDS: { key: 'created_at' | 'category' | 'action' | 'user_name'; labelKey: string }[] = [
  { key: 'created_at', labelKey: 'sortFieldTime' },
  { key: 'category',   labelKey: 'sortFieldCategory' },
  { key: 'action',     labelKey: 'sortFieldAction' },
  { key: 'user_name',  labelKey: 'sortFieldUser' },
]

const ACTIVITY_FILTER_KEY = 'ive-admin-activity-filter'

function loadActivityFilter(): {
  categories: string[]
  userIds: string[]
  startDate: string
  endDate: string
  preset: number | null
} {
  const fallback = { categories: [], userIds: [], startDate: getDateStr(30), endDate: getDateStr(0), preset: 30 }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(ACTIVITY_FILTER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 하위 호환: 이전 단일 값(category/userId)도 배열로 변환
      const categories: string[] = Array.isArray(parsed.categories)
        ? parsed.categories
        : (parsed.category ? [parsed.category] : [])
      const userIds: string[] = Array.isArray(parsed.userIds)
        ? parsed.userIds
        : (parsed.userId ? [parsed.userId] : [])
      const preset = parsed.preset !== undefined ? parsed.preset : 30
      // 프리셋이 숫자(상대 기간: Today/7/30/90)면 저장된 날짜 대신 오늘 기준으로 재계산
      // 프리셋이 null(All)이거나 -1(커스텀)이면 저장된 날짜 그대로 사용
      let startDate: string, endDate: string
      if (typeof preset === 'number' && preset >= 0) {
        startDate = getDateStr(preset)
        endDate = getDateStr(0)
      } else {
        startDate = parsed.startDate ?? getDateStr(30)
        endDate = parsed.endDate ?? getDateStr(0)
      }
      return {
        categories,
        userIds,
        startDate,
        endDate,
        preset,
      }
    }
  } catch {}
  return fallback
}

export default function ActivityContent() {
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [logs, setLogs] = useState<UserActivityLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const savedFilter = loadActivityFilter()
  const [filterCategories, setFilterCategories] = useState<string[]>(savedFilter.categories)
  const [filterUserIds, setFilterUserIds] = useState<string[]>(savedFilter.userIds)
  const [filterStartDate, setFilterStartDate] = useState<string>(savedFilter.startDate)
  const [filterEndDate, setFilterEndDate] = useState<string>(savedFilter.endDate)
  const [activePreset, setActivePreset] = useState<number | null>(savedFilter.preset)
  const [users, setUsers] = useState<User[]>([])
  const offsetRef = useRef(0)
  const PAGE_SIZE = 30
  const [sortBy, setSortBy] = useState<string>('created_at')
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC')
  // 필터 영역 펼침/접힘 — 모바일 세로 공간 확보를 위해 기본 접힘
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITY_FILTER_KEY, JSON.stringify({
        categories: filterCategories,
        userIds: filterUserIds,
        startDate: filterStartDate,
        endDate: filterEndDate,
        preset: activePreset,
      }))
    } catch {}
  }, [filterCategories, filterUserIds, filterStartDate, filterEndDate, activePreset])

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers).catch(() => {})
  }, [])

  const fetchLogs = useCallback(async (reset: boolean = true) => {
    if (reset) { setLoading(true); offsetRef.current = 0 }
    else setLoadingMore(true)

    const sp = new URLSearchParams()
    sp.set('limit', String(PAGE_SIZE))
    sp.set('offset', String(offsetRef.current))
    if (filterCategories.length > 0) sp.set('category', filterCategories.join(','))
    if (filterUserIds.length > 0) sp.set('userId', filterUserIds.join(','))
    if (filterStartDate) sp.set('startDate', filterStartDate)
    if (filterEndDate) sp.set('endDate', filterEndDate)
    sp.set('sortBy', sortBy)
    sp.set('sortOrder', sortOrder)

    try {
      const res = await fetch(`/api/admin/activity-logs?${sp}`)
      if (res.ok) {
        const data = await res.json()
        if (reset) {
          setLogs(data.logs)
        } else {
          setLogs(prev => [...prev, ...data.logs])
        }
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filterCategories, filterUserIds, filterStartDate, filterEndDate, sortBy, sortOrder])

  useEffect(() => { fetchLogs(true) }, [fetchLogs])

  function handleLoadMore() {
    offsetRef.current += PAGE_SIZE
    fetchLogs(false)
  }

  function formatTime(iso: string) {
    return formatDateWithSeconds(iso, userLocale, userTz)
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  // 활성 필터 칩 데이터 — 사용자가 현재 어떤 필터를 걸고 있는지 한눈에 표시
  const dateChipLabel = (() => {
    if (activePreset === -1) return `${filterStartDate} ~ ${filterEndDate}`
    if (activePreset === null) return t('dateAll')
    const preset = DATE_PRESETS.find(p => p.days === activePreset)
    return preset ? t(preset.labelKey as any) : `${filterStartDate} ~ ${filterEndDate}`
  })()
  const resetDateFilter = () => {
    setActivePreset(30)
    setFilterStartDate(getDateStr(30))
    setFilterEndDate(getDateStr(0))
  }
  const categoryChipLabel = filterCategories.length === 1
    ? t(CATEGORY_META[filterCategories[0]]?.labelKey as any || 'unknown')
    : t('chipCategoriesMulti', { count: filterCategories.length })
  const userChipLabel = filterUserIds.length === 1
    ? (users.find(u => u.id === filterUserIds[0])?.name ?? '?')
    : t('chipUsersMulti', { count: filterUserIds.length })

  return (
    <>
      {/* 활성 필터 칩 + 펼치기 토글 — 접힌 상태에서 한눈에 현재 필터 파악 */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-lg text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30">
          <i className="fa-solid fa-calendar text-[10px]" />
          <span className="truncate max-w-[140px]">{dateChipLabel}</span>
          {(activePreset !== 30) && (
            <button
              onClick={resetDateFilter}
              title={tc('clearSelection')}
              aria-label={tc('clearSelection')}
              className="w-4 h-4 inline-flex items-center justify-center rounded-lg hover:bg-ive-green/20"
            >
              <i className="fa-solid fa-xmark text-[10px]" />
            </button>
          )}
        </span>
        {filterCategories.length > 0 && (
          <span className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-lg text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30">
            <i className="fa-solid fa-tags text-[10px]" />
            <span className="truncate max-w-[140px]">{categoryChipLabel}</span>
            <button
              onClick={() => setFilterCategories([])}
              title={tc('clearSelection')}
              aria-label={tc('clearSelection')}
              className="w-4 h-4 inline-flex items-center justify-center rounded-lg hover:bg-ive-green/20"
            >
              <i className="fa-solid fa-xmark text-[10px]" />
            </button>
          </span>
        )}
        {filterUserIds.length > 0 && (
          <span className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-lg text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30">
            <i className="fa-solid fa-user text-[10px]" />
            <span className="truncate max-w-[140px]">{userChipLabel}</span>
            <button
              onClick={() => setFilterUserIds([])}
              title={tc('clearSelection')}
              aria-label={tc('clearSelection')}
              className="w-4 h-4 inline-flex items-center justify-center rounded-lg hover:bg-ive-green/20"
            >
              <i className="fa-solid fa-xmark text-[10px]" />
            </button>
          </span>
        )}
        <button
          onClick={() => setFiltersExpanded(v => !v)}
          className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-bold bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim hover:text-ive-green hover:border-ive-green/40 transition-all"
        >
          <i className="fa-solid fa-sliders text-[10px]" />
          <span>{t('filtersToggle')}</span>
          <i className={`fa-solid fa-chevron-${filtersExpanded ? 'up' : 'down'} text-[9px]`} />
        </button>
      </div>

      {/* 펼친 영역 — 기본 접힘. 펼치면 모든 필터 컨트롤 노출 */}
      {filtersExpanded && (
        <div className="border-l-2 border-ive-border-subtle pl-2 mb-2 space-y-2">
          {/* 다중 선택 드롭다운 */}
          <div className="flex gap-2">
            <MultiSelectPicker
              size="sm"
              className="flex-1"
              values={filterCategories}
              onChange={setFilterCategories}
              allLabel={t('allCategories')}
              options={Object.entries(CATEGORY_META).map(([k, v]) => ({ value: k, label: t(v.labelKey as any) }))}
            />
            <MultiSelectPicker
              size="sm"
              className="flex-1"
              values={filterUserIds}
              onChange={setFilterUserIds}
              allLabel={t('allUsers')}
              options={users.map(u => ({ value: u.id, label: u.name }))}
            />
          </div>

          {/* 기간 프리셋 */}
          <div className="flex gap-1">
            {DATE_PRESETS.map(p => (
              <button
                key={p.labelKey}
                onClick={() => {
                  setActivePreset(p.days)
                  if (p.days === null) {
                    setFilterStartDate('')
                    setFilterEndDate('')
                  } else {
                    setFilterStartDate(getDateStr(p.days))
                    setFilterEndDate(getDateStr(0))
                  }
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activePreset === p.days
                    ? 'bg-ive-green/20 text-ive-green border border-ive-green/40'
                    : 'bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.96]'
                }`}
              >
                {t(p.labelKey as any)}
              </button>
            ))}
          </div>

          {/* 일자 범위 직접 입력 — 기간 프리셋과 한 묶음 */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filterStartDate}
              onChange={e => { setFilterStartDate(e.target.value); setActivePreset(-1) }}
              className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
            />
            <span className="text-xs text-ive-text-dim">~</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={e => { setFilterEndDate(e.target.value); setActivePreset(-1) }}
              className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
            />
          </div>
        </div>
      )}

      {/* 카운트 + 정렬 — 한 줄 결합으로 모바일 세로 공간 절약. 정렬은 데이터 영역 직전에 배치. */}
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs text-ive-text-dim flex-1 min-w-0 truncate">{filterStartDate && filterEndDate ? t('totalCountRange', { count: total, start: filterStartDate, end: filterEndDate }) : filterStartDate ? t('totalCountStartOnly', { count: total, start: filterStartDate }) : filterEndDate ? t('totalCountEndOnly', { count: total, end: filterEndDate }) : t('totalCount', { count: total })}</div>
        <CustomSelect
          size="sm"
          className="w-28 shrink-0"
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          options={SORT_FIELDS.map(f => ({ value: f.key, label: t(f.labelKey as any) }))}
        />
        <button
          onClick={() => setSortOrder(o => (o === 'ASC' ? 'DESC' : 'ASC'))}
          title={t(sortOrder === 'ASC' ? 'sortAsc' : 'sortDesc')}
          aria-label={t(sortOrder === 'ASC' ? 'sortAsc' : 'sortDesc')}
          className="shrink-0 w-9 h-[30px] rounded-lg flex items-center justify-center bg-ive-bg-input border border-ive-border text-ive-text-dim hover:text-ive-green hover:border-ive-green/40 transition-all"
        >
          <i className={`fa-solid ${sortOrder === 'ASC' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short'} text-xs`} />
        </button>
      </div>

      {/* 로그 목록 */}
      <div className="space-y-1.5">
        {logs.map(log => {
          const meta = CATEGORY_META[log.category] || CATEGORY_META.auth
          return (
            <div key={log.id} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-ive-bg-deep`}>
                  <i className={`${meta.icon} text-xs ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-lg ${meta.color} bg-ive-bg-deep`}>{t(meta.labelKey as any)}</span>
                    <span className="text-xs text-ive-text-dim">{formatTime(log.createdAt)}</span>
                  </div>
                  <div className="text-xs text-ive-text leading-relaxed">{log.detail}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-ive-text-muted">
                      <i className="fa-solid fa-user mr-0.5" />{log.userName || t('unknown')}
                    </span>
                    {log.ipAddress && log.ipAddress !== '0.0.0.0' && (
                      <span className="text-xs text-ive-text-dim">
                        <i className="fa-solid fa-globe mr-0.5" />{log.ipAddress}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-ive-text-dim text-sm">
          <i className="fa-solid fa-clock-rotate-left text-2xl opacity-30" />
          {t('noActivityRecords')}
        </div>
      )}

      {/* 더 보기 */}
      {logs.length < total && (
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="w-full mt-3 py-2.5 rounded-lg text-xs font-bold bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {loadingMore
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tc('loading')}</>
            : <><i className="fa-solid fa-chevron-down mr-1" />{t('loadMore', { current: logs.length, total })}</>
          }
        </button>
      )}
    </>
  )
}
