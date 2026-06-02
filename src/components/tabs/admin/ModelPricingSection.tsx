'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/Toast'

interface PricingItem {
  id: string; cliName: string; modelName: string
  inputPrice: number; outputPrice: number; updatedAt: string
}

interface ModelPricingSectionProps {
  expanded: boolean
  onToggle: () => void
  pricingItems: PricingItem[]
  setPricingItems: React.Dispatch<React.SetStateAction<PricingItem[]>>
}

export default function ModelPricingSection({
  expanded, onToggle, pricingItems, setPricingItems,
}: ModelPricingSectionProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  // 응답(전체 단가)으로 목록을 갱신하되, 아직 저장 안 된 로컬 신규행(tp-new-)은 보존
  function mergeFresh(fresh: PricingItem[], keepExceptId?: string) {
    setPricingItems(prev => {
      const localNew = prev.filter(p => p.id.startsWith('tp-new-') && p.id !== keepExceptId)
      return [...fresh, ...localNew]
    })
  }

  // 행 1개 즉시 저장 (이름 없으면 보류). 값 변경 후 blur 시 호출.
  async function saveItem(item: PricingItem) {
    if (!item.modelName.trim()) return
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: item.id, cliName: item.cliName, modelName: item.modelName, inputPrice: item.inputPrice, outputPrice: item.outputPrice }] }),
      })
      if (res.ok) { mergeFresh(await res.json(), item.id); flashSaved() }
      else { const data = await res.json(); toast(data.error || tc('saveFailed'), 'error') }
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(item: PricingItem) {
    if (item.id.startsWith('tp-new-')) {
      setPricingItems(prev => prev.filter(p => p.id !== item.id))
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings/pricing', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
      if (res.ok) { mergeFresh(await res.json()); flashSaved() }
      else { const data = await res.json(); toast(data.error || tc('saveFailed'), 'error') }
    } finally {
      setSaving(false)
    }
  }

  async function applyLatest() {
    setFetching(true)
    try {
      const res = await fetch('/api/settings/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto-fetch' }) })
      if (res.ok) { mergeFresh(await res.json()); toast(t('latestPricingApplied'), 'success') }
      else { const data = await res.json(); toast(data.error || t('fetchFailed'), 'error') }
    } finally {
      setFetching(false)
    }
  }

  const updateField = (id: string, patch: Partial<PricingItem>) =>
    setPricingItems(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
      >
        <i className="fa-solid fa-coins text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('modelPricing')}</span>
        {saving && <i className="fa-solid fa-circle-notch fa-spin text-xs text-ive-text-dim" />}
        {!saving && saved && <i className="fa-solid fa-check text-xs text-ive-green" />}
        <span className="text-xs text-ive-text-dim">{pricingItems.filter(it => it.cliName !== 'human').length}</span>
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-ive-border-dark pt-3">
          <div className="text-xs text-ive-text-dim mb-2">{t('modelPricingDesc')}</div>
          <div className="space-y-1.5">
            {pricingItems.filter(it => it.cliName !== 'human').map(it => (
              <div key={it.id} className="bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={it.modelName}
                    onChange={e => updateField(it.id, { modelName: e.target.value })}
                    onBlur={() => saveItem(it)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    className="flex-1 text-xs font-bold text-ive-text bg-transparent border-b border-ive-border-dark focus:border-ive-green focus:outline-none px-1 py-0.5"
                    placeholder={t('modelName')}
                  />
                  <button
                    onClick={() => deleteItem(it)}
                    className="text-xs text-ive-text-dim hover:text-ive-red p-1"
                    title={tc('delete')}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <div className="text-xs text-ive-text-dim mb-0.5">{t('input')}</div>
                    <input
                      type="number" step="0.01" min="0"
                      value={it.inputPrice}
                      onChange={e => updateField(it.id, { inputPrice: parseFloat(e.target.value) || 0 })}
                      onBlur={() => saveItem(it)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-ive-text-dim mb-0.5">{t('output')}</div>
                    <input
                      type="number" step="0.01" min="0"
                      value={it.outputPrice}
                      onChange={e => updateField(it.id, { outputPrice: parseFloat(e.target.value) || 0 })}
                      onBlur={() => saveItem(it)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                const id = `tp-new-${Date.now()}`
                setPricingItems(prev => [...prev, { id, cliName: 'model', modelName: '', inputPrice: 0, outputPrice: 0, updatedAt: new Date().toISOString() }])
              }}
              className="py-2 px-3 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim active:scale-[0.98] transition-all"
            >
              <i className="fa-solid fa-plus mr-1" />{t('addModel')}
            </button>
            <div className="flex-1" />
            <button
              onClick={applyLatest}
              disabled={fetching}
              className="py-2 px-3 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {fetching
                ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('fetching')}</>
                : <><i className="fa-solid fa-rotate mr-1" />{t('applyLatestPricing')}</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
