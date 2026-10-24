'use client'

/**
 * 보고서 탭 — 보고서 모델(/api/reports/v2)을 그린다. 숫자는 서버의 보고서 모델에서만 계산한다(메일과 같은 값).
 *
 * 주간(개발팀장): 지금 안고 있는 일 → 지금 손쓸 것 → 어디에 → 누구 손에 → 프로젝트별 현황 → 끝낸 일 → 지난 기간 비교 → 투입과 비용 → 완료 목록
 * 월간·연간(경영진): 위 요약 + 산출 추이 · 프로젝트별 맡은 시간 비중 · 살펴볼 위험 · 작업 결과 평가
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney, type ResolvedCurrency } from '@/lib/currency'
import { formatDateMedium } from '@/lib/format-date'
import { useDialog } from '@/components/ui/ConfirmDialog'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { getKSTTodayString } from '@/lib/date-utils'
import { useTab, updateMainUrl } from '@/lib/tab-context'
import type { ReportModel, HeldIssue } from '@/lib/report-model/types'
import { periodOf, previousPeriod, nextPeriod, addDays, FINALIZE_AFTER_DAYS, type ReportType } from '@/lib/report-model/period'
import {
  HeldCard, ActionCards, WhereSection, PeopleSection, StageWorkSection, ProjectsSection, DoneSection, StageTimeSection, CostSection, CompletedList, MineSection, Card, SectionTitle,
} from '@/components/report/sections'
import { TrendCompare, HeldCompare } from '@/components/report/charts'
import { MonthsSection, ShareTrendSection, StageTrendSection, RiskSection, EvaluationSection } from '@/components/report/monthly'
import type { Tr } from '@/components/report/format'
import ProjectFilter, { type ProjectOption } from '@/components/report/ProjectFilter'
import SegmentTabs from '@/components/ui/SegmentTabs'

const USD_CURRENCY: ResolvedCurrency = { code: 'USD', rate: 1, source: 'usd', updatedAt: null }
/** API 응답 — 보고서 모델 + (진행 중인 기간이면) 지금 내 손에 있는 일 */
type ReportResponse = ReportModel & { mine?: HeldIssue[]; projectOptions?: ProjectOption[] }

/** 고른 프로젝트 — 이 브라우저에만 기억(보는 사람의 편의). 저장소를 못 쓰면 전체로 */
const FILTER_KEY = 'ive-report-projects'
function loadFilter(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FILTER_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}

export default function ReportsTab() {
  const trV = useTranslations('reportV2')
  const tr: Tr = useCallback((k, p) => trV(k as never, p as never), [trV])
  const { confirm } = useDialog()
  const locale = useLocale()

  const [cur, setCur] = useState<ResolvedCurrency>(USD_CURRENCY)
  useEffect(() => {
    fetch('/api/settings/currency').then(r => (r.ok ? r.json() : null)).then(d => { if (d?.code) setCur(d) }).catch(() => {})
  }, [])
  const fmtMoney = useCallback((usd: number) => formatMoney(usd, cur.code, cur.rate, locale), [cur, locale])

  // 메일 링크(?tab=reports&rtype=&rdate=)로 열렸으면 그 기간부터 — tab-context 가 넘겨준 값을 한 번만 쓴다
  const [linked] = useState<{ type: ReportType; date: string | null; mine?: boolean } | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = sessionStorage.getItem('ive-report-link')
      if (!raw) return null
      sessionStorage.removeItem('ive-report-link')
      return JSON.parse(raw)
    } catch { return null }
  })
  const [type, setType] = useState<ReportType>(linked?.type ?? 'weekly')
  const [date, setDate] = useState(linked?.date ?? getKSTTodayString())
  const [model, setModel] = useState<ReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [projectIds, setProjectIds] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadFilter()))
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const changeProjects = useCallback((ids: string[]) => {
    setProjectIds(ids)
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(ids)) } catch { /* 저장 못 해도 이번 화면엔 적용 */ }
  }, [])
  // 요청에 실을 필터 — 이제 고를 수 없는 프로젝트(공유 해제 등)는 뺀다. 목록을 받기 전엔 기억한 값 그대로
  const activeIds = useMemo(() => {
    const ids = projectOptions.length ? projectIds.filter(id => projectOptions.some(o => o.id === id)) : projectIds
    return [...ids].sort()
  }, [projectIds, projectOptions])
  const projectsQuery = activeIds.length ? `&projects=${encodeURIComponent(activeIds.join(','))}` : ''

  // 기간을 빠르게 넘기면 요청이 겹친다 — 마지막 요청의 응답만 화면에 쓴다
  const reqSeq = useRef(0)
  // 화면 숫자가 언제 기준인지 — 진행 중인 기간은 저절로 다시 받으므로 기준 시각을 함께 보인다
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  // silent: 자동 갱신 — 로딩 표시를 띄우지 않고, 실패해도 보던 숫자를 그대로 둔다
  const fetchReport = useCallback(async (silent = false) => {
    const seq = ++reqSeq.current
    if (!silent) { setLoading(true); setError(null) }
    try {
      const res = await fetch(`/api/reports/v2?type=${type}&date=${date}${projectsQuery}`)
      // 서버 문구는 언어가 고정이라 보이지 않고, 오류 코드만 함께 보인다
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.code || `http_${res.status}`)
      const m = await res.json()
      if (seq === reqSeq.current) { setModel(m); setFetchedAt(Date.now()); if (m.projectOptions) setProjectOptions(m.projectOptions) }
    } catch (e) {
      if (seq !== reqSeq.current || silent) return
      setError((e as Error).message)
      setModel(null)
    } finally { if (seq === reqSeq.current && !silent) setLoading(false) }
  }, [type, date, projectsQuery])

  useEffect(() => { fetchReport() }, [fetchReport])

  const regenerate = useCallback(async () => {
    const ok = await confirm({ title: tr('regenerateTitle'), message: tr('regenerateMessage'), confirmText: tr('regenerateConfirm'), variant: 'warning' })
    if (!ok) return
    setRegenerating(true)
    try {
      const res = await fetch(`/api/reports/v2?type=${type}&date=${date}${projectsQuery}`, { method: 'DELETE' }).catch(() => null)
      if (!res?.ok) { setError((await res?.json().catch(() => null))?.code || `http_${res?.status ?? 0}`); return }
      await fetchReport()
    } finally { setRegenerating(false) }
  }, [confirm, tr, type, date, projectsQuery, fetchReport])

  const dayLabels = useMemo(() => trV.raw('dayLabels') as string[], [trV])

  // 기간 이동·머리글은 지금 고른 날짜로만 정한다(응답을 기다리는 중이거나 실패해도 고른 기간이 보이게)
  const today = getKSTTodayString()
  const shown = periodOf(type, date)
  const periodLabel = () => {
    const s = new Date(`${shown.start}T00:00:00Z`)
    const e = new Date(`${shown.end}T00:00:00Z`); e.setUTCDate(e.getUTCDate() - 1)
    if (type === 'weekly') return tr('periodWeeklyLabel', { year: s.getUTCFullYear(), month1: s.getUTCMonth() + 1, day1: s.getUTCDate(), month2: e.getUTCMonth() + 1, day2: e.getUTCDate() })
    if (type === 'monthly') return tr('yearMonth', { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1 })
    return tr('yearUnit', { year: s.getUTCFullYear() })
  }
  // 배지·재생성은 지금 보이는 기간의 응답일 때만(다른 기간을 불러오는 중에 앞 기간의 상태를 보이지 않게)
  const current = !loading && model && model.type === type && model.period.start === shown.start ? model : null
  const prevLabel = tr(`prev.${type}`)
  const next = nextPeriod(shown)
  const isTodayPeriod = shown.start <= today && today < shown.end
  // 진행 중인 기간은 저절로 다시 받는다 — 주간 10초, 월간·연간 1분(범위가 넓어 계산이 무겁고 덜 자주 바뀐다)(보고서 탭을 보고 있을 때만). 끝난 기간은 고정
  const { activeTab } = useTab()
  // 보는 기간을 주소에 담는다(보고서 탭을 보는 동안만) — 북마크하면 그 기간이 열린다
  useEffect(() => {
    const on = activeTab === 'reports'
    updateMainUrl({ rtype: on ? type : null, rdate: on ? date : null })
  }, [activeTab, type, date])
  const live = isTodayPeriod && activeTab === 'reports'
  const liveSec = type === 'weekly' ? 10 : 60
  useEffect(() => {
    if (!live) return
    const refresh = () => { if (document.visibilityState === 'visible') fetchReport(true) }
    const timer = setInterval(refresh, liveSec * 1000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [live, liveSec, fetchReport])
  const asOf = fetchedAt ? new Date(fetchedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
  // 메일의 "내 일 열기"로 왔으면 내 손에 있는 일로 내린다(한 번만)
  const mineRef = useRef<HTMLDivElement>(null)
  const mineScrolled = useRef(false)
  useEffect(() => {
    if (!linked?.mine || mineScrolled.current || !mineRef.current) return
    mineScrolled.current = true
    mineRef.current.scrollIntoView({ block: 'start' })
  }, [linked, model])

  return (
    <PullToRefresh onRefresh={() => fetchReport()} className="w-full flex-1 flex flex-col max-w-lg desk:max-w-[1360px] mx-auto px-4 desk:px-6 overflow-hidden">
      <div className="shrink-0 pt-4 pb-2 w-full desk:max-w-3xl desk:mx-auto" data-tour="reports-period">
        {/* 위쪽 순서는 개발자 탭과 같다: 프로젝트 필터 → 종류(주간·월간·연간) → 기간 이동 */}
        <div className="desk:flex desk:items-start desk:gap-2">
          <ProjectFilter options={projectOptions} selected={activeIds} onChange={changeProjects} tr={tr} />
          <SegmentTabs<ReportType> value={type} onChange={setType}
            items={(['weekly', 'monthly', 'yearly'] as const).map(rt => ({ key: rt, label: tr(`type.${rt}`) }))} />
        </div>
        <div className="flex items-center justify-between desk:max-w-lg desk:mx-auto">
          <button aria-label={tr('prevPeriod')} onClick={() => setDate(previousPeriod(shown).start)} className="w-11 h-11 flex items-center justify-center rounded-lg text-ive-text-secondary hover:text-ive-text"><i className="fa-solid fa-chevron-left" /></button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ive-text">{periodLabel()}</span>
            {!isTodayPeriod && (
              <button onClick={() => setDate(today)} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-ive-cyan/20 text-ive-cyan hover:bg-ive-cyan/30">{tr('today')}</button>
            )}
            {current?.provisional && (
              <span title={tr('provisionalHint', { date: addDays(current.period.end, FINALIZE_AFTER_DAYS) })} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-ive-amber/20 text-ive-amber">
                {tr('provisionalBadge')}
              </span>
            )}
            {current?.snapshotAt && (
              <>
                <span title={tr('snapshotHint', { at: formatDateMedium(current.snapshotAt, locale) })} className="px-2 py-0.5 text-xs font-bold rounded-lg bg-white/5 text-ive-text-secondary border border-ive-border-subtle">
                  <i className="fa-solid fa-lock mr-1 opacity-70" />{tr('snapshotBadge')}
                </span>
                <button onClick={regenerate} disabled={regenerating} title={tr('regenerateTitle')} aria-label={tr('regenerateTitle')} className="w-8 h-8 flex items-center justify-center rounded-lg text-ive-text-secondary hover:text-ive-text hover:bg-white/5 disabled:opacity-40">
                  <i className={`fa-solid fa-rotate ${regenerating ? 'fa-spin' : ''}`} />
                </button>
              </>
            )}
          </div>
          {/* 진행 중인 기간 다음은 아직 오지 않은 기간이라 열지 않는다 */}
          <button aria-label={tr('nextPeriod')} disabled={next.start > today} onClick={() => setDate(next.start)} className="w-11 h-11 flex items-center justify-center rounded-lg text-ive-text-secondary hover:text-ive-text disabled:opacity-40"><i className="fa-solid fa-chevron-right" /></button>
        </div>
        {/* 진행 중인 기간: 몇 시 기준 숫자인지(주간 10초·월간 1분마다 저절로 갱신). 끝난 기간은 위의 확정·잠정 배지로 충분하다 */}
        {isTodayPeriod && asOf && (
          <div className="text-center text-xs font-bold text-ive-text-dim -mt-1">
            <i className="fa-solid fa-rotate mr-1 opacity-70" />{tr(liveSec < 60 ? 'liveAsOfSec' : 'liveAsOfMin', { time: asOf, n: liveSec < 60 ? liveSec : liveSec / 60 })}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-20 pad:pb-6">
          {loading && <div className="flex flex-col items-center justify-center py-10 gap-3 text-ive-text-secondary"><i className="fa-solid fa-circle-notch fa-spin text-2xl" />{tr('loadingCompact')}</div>}
          {!loading && error && (
            <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 text-sm font-bold text-ive-text flex flex-col gap-2">
              <span><i className="fa-solid fa-circle-xmark text-ive-red mr-1.5" />{tr('loadFailed')}</span>
              <span className="text-xs text-ive-text-secondary break-all">{tr('errorCode', { code: error })}</span>
              <button onClick={() => fetchReport()} className="self-start px-3 py-2 rounded-lg bg-white/5 border border-ive-border-subtle text-sm font-bold text-ive-text-muted">{tr('retry')}</button>
            </div>
          )}
          {/* PC 3단 — 카드 폭은 폰과 같게, 읽는 순서는 단마다 위에서 아래로(폰·패드는 1열 가운데) */}
          {!loading && model && (
            // 기간을 바꾸면 새로 그린다 — 숫자 튐(CountBump)은 같은 기간의 자동 갱신에서만
            <main key={`${model.type}:${model.period.start}`} className="flex flex-col gap-3 desk:block desk:columns-3 desk:gap-3 desk:*:mb-3 desk:*:break-inside-avoid">
              <ErrorBoundary label={tr('heldNow')}><HeldCard held={model.held} tr={tr} prevLabel={prevLabel} tracking={model.heldTrackingSince} /></ErrorBoundary>
              {model.actions && <ErrorBoundary label={tr('actTitle')}><ActionCards actions={model.actions} tr={tr} /></ErrorBoundary>}
              {model.mine && <div ref={mineRef} className="scroll-mt-2"><ErrorBoundary label={tr('mineTitle', { n: model.mine.length })}><MineSection mine={model.mine} tr={tr} highlight={!!linked?.mine} /></ErrorBoundary></div>}
              {model.risks && <ErrorBoundary label={tr('riskTitle')}><RiskSection risks={model.risks} held={model.held} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label={tr('whereTitle')}><WhereSection held={model.held} tr={tr} /></ErrorBoundary>
              <ErrorBoundary label={tr('peopleTitle')}><PeopleSection held={model.held} avatars={model.avatars} tr={tr} /></ErrorBoundary>
              <ErrorBoundary label={tr('workTitle')}><StageWorkSection work={model.stageWork} avatars={model.avatars} tr={tr} prevLabel={prevLabel} /></ErrorBoundary>
              {model.months && <ErrorBoundary label={tr('monthsTitle', { n: 6 })}><MonthsSection months={model.months} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label={tr('projectsTitle')}><ProjectsSection projects={model.projects} cost={model.cost} tr={tr} prevLabel={prevLabel} /></ErrorBoundary>
              {model.months && <ErrorBoundary label={tr('shareTrendTitle', { n: 6 })}><ShareTrendSection months={model.months} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label={tr('doneTitle')}><DoneSection done={model.done} tr={tr} prevLabel={prevLabel} /></ErrorBoundary>
              <ErrorBoundary label={tr('stageTimeTitle')}><StageTimeSection st={model.stageTime} tr={tr} prevLabel={prevLabel} /></ErrorBoundary>
              {model.months && <ErrorBoundary label={tr('stageTrendTitle', { n: 6 })}><StageTrendSection months={model.months} tr={tr} /></ErrorBoundary>}
              <ErrorBoundary label={tr('compareTitle', { label: prevLabel })}>
                <Card>
                  <SectionTitle>{tr('compareTitle', { label: prevLabel })}</SectionTitle>
                  <TrendCompare trend={model.trend} type={model.type} tr={tr} dayLabels={dayLabels} prevLabel={prevLabel} />
                  <div className="pt-1"><SectionTitle>{tr('heldCompareTitle', { label: prevLabel })}</SectionTitle></div>
                  <HeldCompare trend={model.trend} type={model.type} tr={tr} dayLabels={dayLabels} prevLabel={prevLabel} />
                  {model.trend.held.every(v => v == null) && <span className="text-xs font-bold text-ive-text-muted">{tr('heldTrendNoRecord')}</span>}
                </Card>
              </ErrorBoundary>
              <ErrorBoundary label={tr('costTitle')}><CostSection cost={model.cost} tr={tr} fmtMoney={fmtMoney} prevLabel={prevLabel} /></ErrorBoundary>
              {model.evaluation && <ErrorBoundary label={tr('evalTitle')}><EvaluationSection ev={model.evaluation} avatars={model.avatars} tr={tr} /></ErrorBoundary>}
              {/* 완료한 일은 펼치면 수십 줄 — PC 폭에서는 목록이 카드 안에서 스크롤되어(CompletedList) 다단의 다른 카드를 밀어내지 않는다 */}
              <ErrorBoundary label={tr('completedList')}><CompletedList items={model.completedList} tr={tr} /></ErrorBoundary>
              {model.type === 'weekly' && (
                <button onClick={() => setType('monthly')} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg min-h-12 px-4 flex items-center justify-between text-sm font-bold text-ive-text">
                  <span>{tr('evalTitle')}</span>
                  <span className="flex items-center gap-2 text-xs text-ive-text-muted">{tr('evalInMonthly')}<i className="fa-solid fa-chevron-right" /></span>
                </button>
              )}
              {model.done.total === 0 && model.held.inflow === 0 && (model.held.end ?? 0) === 0 && (
                <div className="text-center py-6 text-sm font-bold text-ive-text-secondary">{tr('noWorkInPeriod')}</div>
              )}
            </main>
          )}
        </div>
      </div>
    </PullToRefresh>
  )
}
