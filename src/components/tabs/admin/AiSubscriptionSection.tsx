'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useToast } from '@/components/ui/Toast'
import CustomSelect from '@/components/ui/CustomSelect'
import CliLogo from '@/components/ui/CliLogo'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'
import { CliName } from '@/types'

const CLIS: { name: CliName; label: string }[] = [
  { name: 'claude', label: 'Claude' },
  { name: 'codex', label: 'Codex' },
  { name: 'agy', label: 'Antigravity CLI' },
  { name: 'opencode', label: 'OpenCode' },
]

// 월 요금을 주 단위로 보여줄 때 쓰는 근사 (표시 전용).
// 실제 보고서 배부는 서버가 하루씩 훑어 그 달의 실제 일수로 나눈다.
const AVG_DAYS_PER_MONTH = 365 / 12

interface Resp {
  subscriptions: Record<string, number>  // cliName → 월 요금 USD
  inputCurrency: string
  rates: Record<string, number>
}

interface Props {
  expanded: boolean
  onToggle: () => void
}

export default function AiSubscriptionSection({ expanded, onToggle }: Props) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const locale = useLocale()
  const { toast } = useToast()

  const [loaded, setLoaded] = useState(false)
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 })
  const [currency, setCurrency] = useState('USD')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loc = locale === 'ko' ? 'ko-KR' : 'en-US'
  const decimals = (code: string) => (code === 'KRW' || code === 'JPY') ? 0 : 2

  function fmtAmount(v: number, code: string): string {
    if (!isFinite(v) || v <= 0) return '0'
    return (Math.round(v * 100) / 100).toFixed(decimals(code)).replace(/\.00$/, '')
  }
  function fmtMoney(v: number, code: string, maxFrac: number): string {
    try {
      return new Intl.NumberFormat(loc, { style: 'currency', currency: code, maximumFractionDigits: maxFrac, minimumFractionDigits: Math.min(2, maxFrac) }).format(v)
    } catch {
      return `${v.toFixed(maxFrac)} ${code}`
    }
  }

  function applyResp(d: Resp, cur: string) {
    const r = d.rates || { USD: 1 }
    setRates(r)
    setCurrency(cur)
    const rate = r[cur] || 1
    const next: Record<string, string> = {}
    for (const { name } of CLIS) next[name] = fmtAmount((d.subscriptions[name] ?? 0) * rate, cur)
    setAmounts(next)
  }

  useEffect(() => {
    let alive = true
    fetch('/api/settings/ai-subscription')
      .then(r => r.ok ? r.json() : null)
      .then((d: Resp | null) => {
        if (!alive || !d) return
        applyResp(d, d.inputCurrency || 'USD')
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => { alive = false }
    // 최초 1회 로드 전용 — applyResp 는 setState 만 하므로 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 값 변경 즉시 저장 (다른 환경설정과 동일한 UX).
  async function commit(cli: CliName, next?: { amount?: string; currency?: string }) {
    if (!loaded) return
    const cur = next?.currency ?? currency
    const amt = parseFloat(next?.amount ?? amounts[cli] ?? '0') || 0
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/ai-subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliName: cli, amount: amt, currency: cur }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error === 'rate_unavailable' ? t('hrRateUnavailable') : (data.error || tc('saveFailed')), 'error')
        return
      }
      applyResp(await res.json(), cur)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  // 통화 전환 시 입력값의 실질 가치를 보존(USD 기준 동일)하도록 환산.
  // 저장값 자체는 USD 라 서버 재요청 없이 표시만 바꾸면 된다.
  function onCurrencyChange(next: string) {
    const oldRate = rates[currency] || 1
    const newRate = rates[next] || 1
    const converted: Record<string, string> = {}
    for (const { name } of CLIS) {
      const usd = (parseFloat(amounts[name] || '0') || 0) / oldRate
      converted[name] = fmtAmount(usd * newRate, next)
    }
    setCurrency(next)
    setAmounts(converted)
    // 입력 통화 기억용으로 한 건만 재저장 (금액은 동일 USD 값)
    commit(CLIS[0].name, { currency: next, amount: converted[CLIS[0].name] })
  }

  const rate = rates[currency] || 1
  const symbol = SUPPORTED_CURRENCIES.find(c => c.code === currency)?.symbol ?? '$'

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
      >
        <i className="fa-solid fa-receipt text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('aiSubscription')}</span>
        {saving && <i className="fa-solid fa-circle-notch fa-spin text-xs text-ive-text-dim" />}
        {!saving && saved && <i className="fa-solid fa-check text-xs text-ive-green" />}
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-ive-border-dark pt-3">
          <div className="text-xs text-ive-text-dim mb-3">{t('aiSubscriptionDesc')}</div>

          <div className="bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2.5">
            <div className="w-28 mb-2.5">
              <div className="text-xs text-ive-text-dim mb-0.5">{t('hrInputCurrency')}</div>
              <CustomSelect
                size="sm"
                value={currency}
                onChange={onCurrencyChange}
                options={SUPPORTED_CURRENCIES.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}` }))}
              />
            </div>

            <div className="space-y-2">
              {CLIS.map(({ name, label }) => {
                const amtCur = parseFloat(amounts[name] || '0') || 0
                const perWeekUsd = (amtCur / rate) * 7 / AVG_DAYS_PER_MONTH
                return (
                  <div key={name} className="flex items-center gap-3">
                    <div className="w-24 flex items-center gap-2 shrink-0">
                      <CliLogo cli={name} />
                      <span className="text-xs font-bold text-ive-text">{label}</span>
                    </div>
                    <div className="flex-1">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm font-bold text-ive-text-dim">{symbol}</span>
                        <input
                          type="number" step="any" min="0"
                          value={amounts[name] ?? '0'}
                          onChange={e => { setAmounts(p => ({ ...p, [name]: e.target.value })); setSaved(false) }}
                          onBlur={() => commit(name)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg pl-6 pr-14 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ive-text-dim">/{t('asPerMonthUnit')}</span>
                      </div>
                    </div>
                    <div className="w-28 text-right shrink-0">
                      <div className="text-[10px] text-ive-text-dim">{t('asPerWeek')}</div>
                      <div className="text-xs font-bold text-ive-cyan">
                        {amtCur > 0 ? fmtMoney(perWeekUsd, 'USD', 2) : '—'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="text-[11px] text-ive-text-dim mt-2.5 pt-2.5 border-t border-ive-border-dark">
              {t('asMeteredHint')}
            </div>
          </div>

          <div className="text-[11px] text-ive-text-dim mt-2.5 leading-relaxed">
            <i className="fa-solid fa-circle-info mr-1 opacity-60" />
            {t('asNotice')}
          </div>
        </div>
      )}
    </div>
  )
}
