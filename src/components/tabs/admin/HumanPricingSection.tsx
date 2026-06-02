'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useToast } from '@/components/ui/Toast'
import CustomSelect from '@/components/ui/CustomSelect'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'

interface PricingItem {
  id: string; cliName: string; modelName: string
  inputPrice: number; outputPrice: number; updatedAt: string
}

interface HumanPricingSectionProps {
  expanded: boolean
  onToggle: () => void
  setPricingItems: React.Dispatch<React.SetStateAction<PricingItem[]>>
}

// 서버(token-pricing.ts WEEKS_PER_MONTH)와 동일한 월 환산 주수.
const WEEKS_PER_MONTH = 4

interface HumanRateResp {
  monthlySalaryUsd: number
  daysPerWeek: number
  hoursPerDay: number
  monthlyMinutes: number
  costPerMinUsd: number
  inputCurrency: string
  rates: Record<string, number>
}

export default function HumanPricingSection({
  expanded, onToggle, setPricingItems,
}: HumanPricingSectionProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const locale = useLocale()
  const { toast } = useToast()

  const [loaded, setLoaded] = useState(false)
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 })
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('0')   // 선택 통화 기준 입력 월급
  const [days, setDays] = useState('5')
  const [hours, setHours] = useState('8')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/settings/human-rate')
      .then(r => r.ok ? r.json() : null)
      .then((d: HumanRateResp | null) => {
        if (!alive || !d) return
        const r = d.rates || { USD: 1 }
        const cur = d.inputCurrency || 'USD'
        setRates(r)
        setCurrency(cur)
        setDays(String(d.daysPerWeek))
        setHours(String(d.hoursPerDay))
        const rate = r[cur] || 1
        setAmount(fmtAmount(d.monthlySalaryUsd * rate, cur))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => { alive = false }
  }, [])

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

  const rate = rates[currency] || 1
  const amountNum = parseFloat(amount) || 0
  const salaryUsd = amountNum / rate
  const daysNum = parseFloat(days) || 0
  const hoursNum = parseFloat(hours) || 0
  const weeklyHours = daysNum * hoursNum
  const monthlyHours = weeklyHours * WEEKS_PER_MONTH
  const monthlyMinutes = monthlyHours * 60
  const perMinUsd = monthlyMinutes > 0 ? salaryUsd / monthlyMinutes : 0
  const perMinCur = perMinUsd * rate

  // 값 변경 즉시 저장 (다른 환경설정과 동일한 UX). overrides 로 최신값을 직접 전달.
  async function commit(next?: { amount?: string; currency?: string; days?: string; hours?: string }) {
    if (!loaded) return
    const cur = next?.currency ?? currency
    const amt = parseFloat(next?.amount ?? amount) || 0
    const d = parseFloat(next?.days ?? days) || 0
    const h = parseFloat(next?.hours ?? hours) || 0
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/human-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salary: amt, currency: cur, daysPerWeek: d, hoursPerDay: h }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error === 'rate_unavailable' ? t('hrRateUnavailable') : (data.error || tc('saveFailed')), 'error')
        return
      }
      const resp: HumanRateResp = await res.json()
      const r = resp.rates || rates
      setRates(r)
      setDays(String(resp.daysPerWeek))
      setHours(String(resp.hoursPerDay))
      setAmount(fmtAmount(resp.monthlySalaryUsd * (r[cur] || 1), cur))
      // 공용 pricingItems 의 human 행 USD 값을 동기화 (모델 단가 일괄 저장 시 덮어쓰기 방지)
      setPricingItems(prev => prev.map(p => p.cliName === 'human' ? { ...p, inputPrice: resp.monthlySalaryUsd } : p))
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  // 통화 전환 시 입력값의 실질 가치를 보존(USD 기준 동일)하도록 환산 후 저장
  function onCurrencyChange(next: string) {
    const oldRate = rates[currency] || 1
    const newRate = rates[next] || 1
    const usd = (parseFloat(amount) || 0) / oldRate
    const newAmount = fmtAmount(usd * newRate, next)
    setCurrency(next)
    setAmount(newAmount)
    commit({ currency: next, amount: newAmount })
  }

  const symbol = SUPPORTED_CURRENCIES.find(c => c.code === currency)?.symbol ?? '$'

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
      >
        <i className="fa-solid fa-user-tie text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('humanPricing')}</span>
        {saving && <i className="fa-solid fa-circle-notch fa-spin text-xs text-ive-text-dim" />}
        {!saving && saved && <i className="fa-solid fa-check text-xs text-ive-green" />}
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-ive-border-dark pt-3">
          <div className="text-xs text-ive-text-dim mb-3">{t('humanPricingDesc')}</div>

          {/* 입력 통화 + 월급 */}
          <div className="bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2.5 space-y-2.5">
            <div className="flex gap-3">
              <div className="w-28">
                <div className="text-xs text-ive-text-dim mb-0.5">{t('hrInputCurrency')}</div>
                <CustomSelect
                  size="sm"
                  value={currency}
                  onChange={onCurrencyChange}
                  options={SUPPORTED_CURRENCIES.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}` }))}
                />
              </div>
              <div className="flex-1">
                <div className="text-xs text-ive-text-dim mb-0.5">{t('hrMonthlySalary')}</div>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm font-bold text-ive-text-dim">{symbol}</span>
                  <input
                    type="number" step="any" min="0"
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setSaved(false) }}
                    onBlur={() => commit()}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg pl-6 pr-2 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                  />
                </div>
              </div>
            </div>
            {currency !== 'USD' && (
              <div className="text-[11px] text-ive-text-dim text-right">
                <i className="fa-solid fa-right-left mr-1 opacity-60" />
                {t('hrSavedAsUsd', { usd: salaryUsd.toLocaleString(loc, { maximumFractionDigits: 2 }) })}
              </div>
            )}
          </div>

          {/* 근무 일정 */}
          <div className="flex gap-3 mt-2.5">
            <div className="flex-1">
              <div className="text-xs text-ive-text-dim mb-0.5">{t('hrDaysPerWeek')}</div>
              <div className="relative">
                <input
                  type="number" step="0.5" min="1" max="7"
                  value={days}
                  onChange={e => { setDays(e.target.value); setSaved(false) }}
                  onBlur={() => commit()}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg pl-2 pr-9 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ive-text-dim">{t('hrDaysUnit')}</span>
              </div>
            </div>
            <div className="flex-1">
              <div className="text-xs text-ive-text-dim mb-0.5">{t('hrHoursPerDay')}</div>
              <div className="relative">
                <input
                  type="number" step="0.5" min="1" max="24"
                  value={hours}
                  onChange={e => { setHours(e.target.value); setSaved(false) }}
                  onBlur={() => commit()}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg pl-2 pr-12 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ive-text-dim">{t('hrHoursUnit')}</span>
              </div>
            </div>
          </div>

          {/* 산출 결과: 월 환산 근무시간 + 분당 비용 */}
          <div className="flex gap-3 mt-2.5">
            <div className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2">
              <div className="text-xs text-ive-text-dim mb-0.5">{t('hrMonthlyHours')}</div>
              <div className="text-sm font-bold text-ive-text">{t('hrMonthlyHoursValue', { hours: Math.round(monthlyHours) })}</div>
              <div className="text-[10px] text-ive-text-dim mt-0.5">{t('hrMonthlyHoursHint', { weekly: Math.round(weeklyHours), weeks: WEEKS_PER_MONTH })}</div>
            </div>
            <div className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2">
              <div className="text-xs text-ive-text-dim mb-0.5">{t('hrPerMinCost')}</div>
              <div className="text-sm font-bold text-ive-cyan">{fmtMoney(perMinUsd, 'USD', 4)}</div>
              {currency !== 'USD' && (
                <div className="text-[10px] text-ive-text-dim mt-0.5">{fmtMoney(perMinCur, currency, 2)}</div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
