'use client'

/**
 * 역할·단계 자동화 설정 화면이 쓰는 컨트롤 — 전부 기존 화면의 패턴을 그대로 옮긴 것이다(새 모양을 만들지 않는다).
 *   입력·라벨      : ConnectionSection (프로젝트 설정 폼)
 *   스위치         : ScannerSettingsSection 「도구 사용 표시」
 *   스테퍼         : ScannerSettingsSection 「스냅샷 간격」
 *   세그먼트       : SharingSection 「보기/편집」
 *   자동저장 표시   : SettingsPanel·HumanPricingSection (헤더 스피너/체크, 1.5초 후 사라짐, 실패는 toast)
 */
import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/Toast'

export const INPUT_CLS = 'w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-3 text-base text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green'
export const LABEL_CLS = 'block text-base font-bold text-ive-text-muted mb-2'
export const HINT_CLS = 'text-xs text-ive-text-dim'
export const ROW_CLS = 'flex items-center gap-2 bg-ive-bg-deep rounded-lg px-3 py-2 border border-ive-border-dark'

/** 바로 저장 + 헤더 표시 상태. 실패는 toast 로 알린다. */
export function useAutosave() {
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const run = useCallback(async (fn: () => Promise<Response>): Promise<unknown> => {
    setSaving(true); setSaved(false)
    try {
      const res = await fn()
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast(data.error || tc('saveFailed'), 'error'); return null }
      setSaved(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setSaved(false), 1500)
      return data
    } catch {
      toast(tc('saveFailed'), 'error')
      return null
    } finally { setSaving(false) }
  }, [toast, tc])
  return { saving, saved, run }
}

export function SaveIndicator({ saving, saved }: { saving: boolean; saved: boolean }) {
  if (saving) return <i className="fa-solid fa-circle-notch fa-spin text-xs text-ive-text-dim" />
  if (saved) return <i className="fa-solid fa-check text-xs text-ive-green" />
  return null
}

export function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-11 h-6 rounded-full transition-all relative shrink-0 disabled:opacity-40 ${on ? 'bg-ive-green' : 'bg-ive-bg-deep border border-ive-border'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[1.375rem]' : 'left-0.5'}`} />
    </button>
  )
}

export function Stepper({ value, min, max, onChange, disabled }: { value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  const btn = 'px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold disabled:opacity-40'
  return (
    <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden w-fit">
      <button type="button" disabled={disabled} onClick={() => onChange(Math.max(min, value - 1))} className={btn}>−</button>
      <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{value}</span>
      <button type="button" disabled={disabled} onClick={() => onChange(Math.min(max, value + 1))} className={btn}>+</button>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, items }: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string; icon?: string }[]
}) {
  return (
    <div className="flex bg-ive-bg-input rounded-lg overflow-hidden border border-ive-border">
      {items.map((it, i) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={`flex-1 py-2 text-sm font-bold transition-all ${i > 0 ? 'border-l border-ive-border' : ''} ${value === it.value ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
        >
          {it.icon && <i className={`fa-solid ${it.icon} mr-1`} />}{it.label}
        </button>
      ))}
    </div>
  )
}
