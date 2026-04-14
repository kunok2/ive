'use client'

import { useState } from 'react'
import { Project } from '@/types'
import { useTranslations } from 'next-intl'

export interface LabelValues {
  labelTarget: string
  labelSchedule: string
  labelDev: string
  labelVerifyWait: string
  labelVerify: string
  labelEnd: string
}

export interface LabelSectionProps {
  existing?: Project
  values: LabelValues
  onChange: (field: keyof LabelValues, value: string) => void
}

interface LabelRowProps {
  colorClass: string
  labelKey: string
  descKey: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  t: ReturnType<typeof useTranslations<'project'>>
}

function LabelRow({ colorClass, labelKey, descKey, value, placeholder, onChange, t }: LabelRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full ${colorClass} shrink-0`} />
      <span className="flex flex-row items-baseline gap-1.5 flex-1 min-w-0">
        <span className="text-xs text-ive-text-dim shrink-0">{t(labelKey)}</span>
        <span className="text-[10px] text-ive-text-dim/60 truncate">{t(descKey)}</span>
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-24 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold"
      />
    </div>
  )
}

export default function LabelSection({ existing, values, onChange }: LabelSectionProps) {
  const t = useTranslations('project')

  const [labelStatus, setLabelStatus] = useState<{ label: string; exists: boolean }[] | null>(null)
  const [labelCreating, setLabelCreating] = useState(false)
  const [labelMessage, setLabelMessage] = useState<string | null>(null)

  return (
    <div className="border-t border-ive-border-dark pt-3">
      <label className="block text-sm font-bold text-ive-text-muted mb-1.5 uppercase ml-1">
        <i className="fa-solid fa-tags mr-1.5 text-xs" />
        {t('targetLabel')}
      </label>
      <p className="text-xs text-ive-text-dim mb-2 ml-1 leading-relaxed">
        {t('labelSystemHint')}
      </p>
      <div className="space-y-2">
        <LabelRow colorClass="bg-ive-cyan" labelKey="labelTarget" descKey="labelTargetDesc" value={values.labelTarget} placeholder="IVE" onChange={v => onChange('labelTarget', v)} t={t} />
        <LabelRow colorClass="bg-ive-cyan" labelKey="labelSchedule" descKey="labelScheduleDesc" value={values.labelSchedule} placeholder="IVE-S" onChange={v => onChange('labelSchedule', v)} t={t} />
        <LabelRow colorClass="bg-ive-amber" labelKey="labelDev" descKey="labelDevDesc" value={values.labelDev} placeholder="IVE-D" onChange={v => onChange('labelDev', v)} t={t} />
        <LabelRow colorClass="bg-ive-amber" labelKey="labelVerifyWait" descKey="labelVerifyWaitDesc" value={values.labelVerifyWait} placeholder="IVE-W" onChange={v => onChange('labelVerifyWait', v)} t={t} />
        <LabelRow colorClass="bg-ive-amber" labelKey="labelVerify" descKey="labelVerifyDesc" value={values.labelVerify} placeholder="IVE-V" onChange={v => onChange('labelVerify', v)} t={t} />
        <LabelRow colorClass="bg-ive-green" labelKey="labelEnd" descKey="labelEndDesc" value={values.labelEnd} placeholder="IVE-E" onChange={v => onChange('labelEnd', v)} t={t} />
      </div>

      {/* Label creation button - existing projects only */}
      {existing && (
        <div className="mt-3">
          <button
            type="button"
            onClick={async () => {
              setLabelCreating(true)
              setLabelMessage(null)
              try {
                const res = await fetch(`/api/projects/${existing.id}/labels`, { method: 'POST' })
                const data = await res.json()
                setLabelStatus(data.results || null)
                setLabelMessage(data.message || null)
              } catch {
                setLabelMessage(t('labelCreateFailed'))
              }
              setLabelCreating(false)
            }}
            disabled={labelCreating}
            className="text-sm font-bold text-ive-cyan border border-ive-cyan/30 px-3 py-1.5 rounded-lg hover:bg-ive-cyan/10 transition-all disabled:opacity-40"
          >
            {labelCreating ? <i className="fa-solid fa-circle-notch fa-spin mr-1" /> : <i className="fa-solid fa-wand-magic-sparkles mr-1" />}
            {t('createLabels')}
          </button>
          {labelStatus && (
            <div className="mt-2 space-y-1">
              {labelStatus.map(s => (
                <div key={s.label} className={`text-xs flex items-center gap-1.5 ${s.exists ? 'text-ive-green' : 'text-ive-red'}`}>
                  <i className={`fa-solid ${s.exists ? 'fa-circle-check' : 'fa-circle-xmark'}`} />
                  <span className="font-bold">{s.label}</span>
                  <span className="text-ive-text-dim">{s.exists ? t('labelExists') : t('labelMissing')}</span>
                </div>
              ))}
            </div>
          )}
          {labelMessage && (
            <p className="text-xs text-ive-amber mt-1.5 ml-1">
              <i className="fa-solid fa-triangle-exclamation mr-1" />{labelMessage}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
