'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { User, UserActivityLog } from '@/types'
import { useStore } from '@/lib/store'
import { formatDateWithSeconds } from '@/lib/format-date'
import MultiSelectPicker from '@/components/ui/MultiSelectPicker'

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
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

const DATE_PRESETS: { labelKey: string; days: number | null }[] = [
  { labelKey: 'dateToday', days: 0 },
  { labelKey: 'dateDays7', days: 7 },
  { labelKey: 'dateDays30', days: 30 },
  { labelKey: 'dateDays90', days: 90 },
  { labelKey: 'dateAll', days: null },
]

const SORT_OPTIONS: { labelKey: string; value: string }[] = [
  { labelKey: 'sortLatest', value: 'created_at-DESC' },
  { labelKey: 'sortOldest', value: 'created_at-ASC' },
  { labelKey: 'sortCategory', value: 'category-ASC' },
  { labelKey: 'sortAction', value: 'action-ASC' },
  { labelKey: 'sortUser', value: 'user_name-ASC' },
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
      return {
        categories,
        userIds,
        startDate: parsed.startDate ?? getDateStr(30),
        endDate: parsed.endDate ?? getDateStr(0),
        preset: parsed.preset !== undefined ? parsed.preset : 30,
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

  return (
    <>
      {/* 필터 — 다중 선택 (선택 없음 = 전체) */}
      <div className="flex gap-2 mb-2">
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
      <div className="flex gap-1 mb-2">
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

      {/* 정렬 버튼 */}
      <div className="flex gap-1 mb-2">
        <span className="text-xs text-ive-text-dim flex items-center mr-1">{t('sortBy')}:</span>
        {SORT_OPTIONS.map(opt => {
          const [col, order] = opt.value.split('-')
          const isActive = sortBy === col && sortOrder === order
          return (
            <button
              key={opt.value}
              onClick={() => { setSortBy(col); setSortOrder(order as 'ASC' | 'DESC') }}
              className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                isActive
                  ? 'bg-ive-green/20 text-ive-green border border-ive-green/40'
                  : 'bg-ive-bg-card border border-ive-border-subtle text-ive-text-dim active:scale-[0.96]'
              }`}
            >
              {t(opt.labelKey as any)}
            </button>
          )
        })}
      </div>

      {/* 일자 범위 직접 입력 */}
      <div className="flex items-center gap-1.5 mb-3">
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

      <div className="text-xs text-ive-text-dim mb-3">{filterStartDate && filterEndDate ? t('totalCountRange', { count: total, start: filterStartDate, end: filterEndDate }) : filterStartDate ? t('totalCountStartOnly', { count: total, start: filterStartDate }) : filterEndDate ? t('totalCountEndOnly', { count: total, end: filterEndDate }) : t('totalCount', { count: total })}</div>

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
