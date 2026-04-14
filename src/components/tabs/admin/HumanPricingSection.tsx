'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'

interface PricingItem {
  id: string; cliName: string; modelName: string
  inputPrice: number; outputPrice: number; updatedAt: string
}

interface HumanPricingSectionProps {
  expanded: boolean
  onToggle: () => void
  pricingItems: PricingItem[]
  setPricingItems: React.Dispatch<React.SetStateAction<PricingItem[]>>
  pricingSaved: boolean
  setPricingSaved: React.Dispatch<React.SetStateAction<boolean>>
}

export default function HumanPricingSection({
  expanded, onToggle, pricingItems, setPricingItems, pricingSaved, setPricingSaved,
}: HumanPricingSectionProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { alert } = useDialog()
  const [pricingSaving, setPricingSaving] = useState(false)

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
      >
        <i className="fa-solid fa-user-tie text-sm text-ive-text-dim" />
        <span className="text-sm font-bold text-ive-text flex-1">{t('humanPricing')}</span>
        <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-ive-border-dark pt-3">
          <div className="text-xs text-ive-text-dim mb-2">{t('humanPricingDesc')}</div>
          {pricingItems.filter(it => it.cliName === 'human').map(it => (
            <div key={it.id} className="bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2.5">
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="text-xs text-ive-text-dim mb-0.5">월급 (USD)</div>
                  <input
                    type="number" step="100" min="0"
                    value={it.inputPrice}
                    onChange={e => { setPricingItems(prev => prev.map(p => p.id === it.id ? { ...p, inputPrice: parseFloat(e.target.value) || 0 } : p)); setPricingSaved(false) }}
                    className="w-full text-sm font-bold text-ive-text bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-ive-cyan"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-ive-text-dim mb-0.5">시급 (160h 기준)</div>
                  <div className="w-full text-sm font-bold text-ive-text-muted bg-ive-bg-deep border border-ive-border rounded-lg px-2 py-1.5 text-right cursor-not-allowed">
                    {((it.inputPrice || 0) / 160).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={async () => {
              setPricingSaving(true)
              try {
                const res = await fetch('/api/settings/pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: pricingItems.map(it => ({ id: it.id, cliName: it.cliName, modelName: it.modelName, inputPrice: it.inputPrice, outputPrice: it.outputPrice })) }) })
                if (res.ok) { setPricingItems(await res.json()); setPricingSaved(true); setTimeout(() => setPricingSaved(false), 2000) }
                else { const data = await res.json(); await alert({ message: data.error || tc('saveFailed'), variant: 'error' }) }
              } finally { setPricingSaving(false) }
            }}
            disabled={pricingSaving}
            className={`w-full mt-3 py-2 rounded-lg text-xs font-bold active:scale-[0.98] transition-all disabled:opacity-40 ${pricingSaved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'}`}
          >
            {pricingSaving
              ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('saving')}</>
              : pricingSaved
                ? <><i className="fa-solid fa-check mr-1" />{t('saved')}</>
                : <><i className="fa-solid fa-floppy-disk mr-1" />{tc('save')}</>
            }
          </button>
        </div>
      )}
    </div>
  )
}
