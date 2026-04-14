'use client'

import { PROJECT_COLORS, ProjectColor } from '@/types'
import { useTranslations } from 'next-intl'

export interface ColorPickerSectionProps {
  color: ProjectColor
  onColorChange: (c: ProjectColor) => void
}

export default function ColorPickerSection({ color, onColorChange }: ColorPickerSectionProps) {
  const t = useTranslations('project')

  return (
    <div>
      <label className="block text-base font-bold text-ive-text-muted mb-2">{t('distinguishColor')}</label>
      <div className="grid grid-cols-5 gap-1.5">
        {PROJECT_COLORS.map(c => {
          const selected = color === c.value
          const isDark = !['#fbbf24', '#a3e635', '#e0e0e0'].includes(c.value)
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onColorChange(c.value)}
              className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                selected
                  ? 'ring-1 ring-offset-1 ring-offset-ive-bg-card'
                  : 'opacity-50 hover:opacity-80'
              }`}
              style={{
                backgroundColor: selected ? c.value : `${c.value}18`,
                color: selected ? (isDark ? '#fff' : '#1a1a2e') : c.value,
                ...(selected ? { ringColor: c.value } : {}),
              }}
            >
              {c.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
