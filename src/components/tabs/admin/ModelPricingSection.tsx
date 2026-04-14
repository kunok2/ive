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
  pricingSaved: boolean
  setPricingSaved: React.Dispatch<React.SetStateAction<boolean>>
}

export default function ModelPricingSection({
  expanded, onToggle, pricingItems, setPricingItems, pricingSaved, setPricingSaved,
}: ModelPricingSectionProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { toast } = useToast()

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
      >
        <i className="fa-solid fa-coins text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('modelPricing')}</span>
        <span className="text-xs text-ive-text-dim">{pricingItems.filter(it => it.cliName !== 'human').length}</span>
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>

      {expanded && (
        <ModelPricingContent
          pricingItems={pricingItems}
          setPricingItems={setPricingItems}
          pricingSaved={pricingSaved}
          setPricingSaved={setPricingSaved}
        />
      )}
    </div>
  )
}

function ModelPricingContent({
  pricingItems, setPricingItems, pricingSaved, setPricingSaved,
}: Pick<ModelPricingSectionProps, 'pricingItems' | 'setPricingItems' | 'pricingSaved' | 'setPricingSaved'>) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [pricingFetching, setPricingFetching] = useState(false)
  const [pricingSaving, setPricingSaving] = useState(false)

  return (
    <div className="px-4 pb-4 border-t border-ive-border-dark pt-3">
      <div className="text-xs text-ive-text-dim mb-2">{t('modelPricingDesc')}</div>
      <div className="space-y-1.5">
        {pricingItems.filter(it => it.cliName !== 'human').map(it => (
          <div key={it.id} className="bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2 mb-2">
              <input
                value={it.modelName}
                onChange={e => { setPricingItems(prev => prev.map(p => p.id === it.id ? { ...p, modelName: e.target.value } : p)); setPricingSaved(false) }}
                className="flex-1 text-xs font-bold text-ive-text bg-transparent border-b border-ive-border-dark focus:border-ive-green focus:outline-none px-1 py-0.5"
                placeholder={t('modelName')}
              />
              <button
                onClick={async () => {
                  if (it.id.startsWith('tp-new-')) {
                    setPricingItems(prev => prev.filter(p => p.id !== it.id))
                    setPricingSaved(false)
                    return
                  }
                  try {
                    const res = await fetch('/api/settings/pricing', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id }) })
                    if (res.ok) setPricingItems(await res.json())
                    else { const data = await res.json(); toast(data.error || tc('saveFailed'), 'error') }
                  } catch {}
                }}
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
                  onChange={e => { setPricingItems(prev => prev.map(p => p.id === it.id ? { ...p, inputPrice: parseFloat(e.target.value) || 0 } : p)); setPricingSaved(false) }}
                  className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                />
              </div>
              <div className="flex-1">
                <div className="text-xs text-ive-text-dim mb-0.5">{t('output')}</div>
                <input
                  type="number" step="0.01" min="0"
                  value={it.outputPrice}
                  onChange={e => { setPricingItems(prev => prev.map(p => p.id === it.id ? { ...p, outputPrice: parseFloat(e.target.value) || 0 } : p)); setPricingSaved(false) }}
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
            setPricingSaved(false)
          }}
          className="py-2 px-3 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim active:scale-[0.98] transition-all"
        >
          <i className="fa-solid fa-plus mr-1" />{t('addModel')}
        </button>
        <div className="flex-1" />
        <button
          onClick={async () => {
            setPricingFetching(true)
            try {
              const res = await fetch('/api/settings/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto-fetch' }) })
if (res.ok) { setPricingItems(await res.json()); setPricingSaved(false); toast(t('latestPricingApplied'), 'success') }
                else { const data = await res.json(); toast(data.error || t('fetchFailed'), 'error') }
            } finally { setPricingFetching(false) }
          }}
          disabled={pricingFetching}
          className="py-2 px-3 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {pricingFetching
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('fetching')}</>
            : <><i className="fa-solid fa-rotate mr-1" />{t('applyLatestPricing')}</>
          }
        </button>
        <button
          onClick={async () => {
            setPricingSaving(true)
            try {
              const res = await fetch('/api/settings/pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: pricingItems.map(it => ({ id: it.id, cliName: it.cliName, modelName: it.modelName, inputPrice: it.inputPrice, outputPrice: it.outputPrice })) }) })
if (res.ok) { setPricingItems(await res.json()); setPricingSaved(true); setTimeout(() => setPricingSaved(false), 2000) }
                else { const data = await res.json(); toast(data.error || tc('saveFailed'), 'error') }
            } finally { setPricingSaving(false) }
          }}
          disabled={pricingSaving}
          className={`py-2 px-3 rounded-lg text-xs font-bold active:scale-[0.98] transition-all disabled:opacity-40 ${pricingSaved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'}`}
        >
          {pricingSaving
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('saving')}</>
            : pricingSaved
              ? <><i className="fa-solid fa-check mr-1" />{t('saved')}</>
              : <><i className="fa-solid fa-floppy-disk mr-1" />{tc('save')}</>
          }
        </button>
      </div>
    </div>
  )
}

