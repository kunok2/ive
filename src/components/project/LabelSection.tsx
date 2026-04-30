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
  labelConfirmWait: string
  labelConfirm: string
  labelEnd: string
}

export interface LabelSectionProps {
  existing?: Project
  values: LabelValues
  onChange: (field: keyof LabelValues, value: string) => void
}

interface LabelInputProps {
  colorClass: string
  title: string
  desc: string
  value: string
  placeholder: string
  onChange: (v: string) => void
}

function LabelInput({ colorClass, title, desc, value, placeholder, onChange }: LabelInputProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-2.5 h-2.5 rounded-full ${colorClass} shrink-0`} />
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
        <span className="text-xs font-bold text-ive-text-muted truncate">{title}</span>
        <span className="text-[10px] text-ive-text-dim/70 truncate">{desc}</span>
      </span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-20 shrink-0 bg-ive-bg-deep border border-ive-border rounded-lg px-2 py-1.5 text-sm text-ive-text focus:outline-none focus:border-ive-green font-bold text-center"
      />
    </div>
  )
}

interface StageGroupProps {
  title: string
  desc: string
  children: React.ReactNode
}

function StageGroup({ title, desc, children }: StageGroupProps) {
  return (
    <div className="bg-white/[0.02] border border-ive-border-subtle rounded-lg p-2.5 space-y-2">
      <div className="leading-tight">
        <div className="text-xs font-bold text-ive-text-muted">
          <i className="fa-solid fa-angle-right mr-1 text-[10px] text-ive-text-dim" />
          {title}
        </div>
        <div className="text-[10px] text-ive-text-dim mt-0.5 ml-2.5">{desc}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-2">
        {children}
      </div>
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
      <p className="text-xs text-ive-text-dim mb-3 ml-1 leading-relaxed">
        {t('labelSystemHint')}
      </p>

      <div className="space-y-2.5">
        <LabelInput
          colorClass="bg-ive-cyan"
          title={t('labelTarget')}
          desc={t('labelTargetDesc')}
          value={values.labelTarget}
          placeholder="IVE"
          onChange={v => onChange('labelTarget', v)}
        />

        <StageGroup title={t('stageProcess')} desc={t('stageProcessDesc')}>
          <LabelInput
            colorClass="bg-ive-cyan"
            title={t('labelSchedule')}
            desc={t('labelScheduleDesc')}
            value={values.labelSchedule}
            placeholder="IVE-S"
            onChange={v => onChange('labelSchedule', v)}
          />
          <LabelInput
            colorClass="bg-ive-cyan"
            title={t('labelDev')}
            desc={t('labelDevDesc')}
            value={values.labelDev}
            placeholder="IVE-D"
            onChange={v => onChange('labelDev', v)}
          />
        </StageGroup>

        <StageGroup title={t('stageVerify')} desc={t('stageVerifyDesc')}>
          <LabelInput
            colorClass="bg-ive-amber"
            title={t('labelVerifyWait')}
            desc={t('labelVerifyWaitDesc')}
            value={values.labelVerifyWait}
            placeholder="IVE-W"
            onChange={v => onChange('labelVerifyWait', v)}
          />
          <LabelInput
            colorClass="bg-ive-amber"
            title={t('labelVerify')}
            desc={t('labelVerifyDesc')}
            value={values.labelVerify}
            placeholder="IVE-V"
            onChange={v => onChange('labelVerify', v)}
          />
        </StageGroup>

        <StageGroup title={t('stageConfirm')} desc={t('stageConfirmDesc')}>
          <LabelInput
            colorClass="bg-ive-amber"
            title={t('labelConfirmWait')}
            desc={t('labelConfirmWaitDesc')}
            value={values.labelConfirmWait}
            placeholder="IVE-P"
            onChange={v => onChange('labelConfirmWait', v)}
          />
          <LabelInput
            colorClass="bg-ive-amber"
            title={t('labelConfirm')}
            desc={t('labelConfirmDesc')}
            value={values.labelConfirm}
            placeholder="IVE-C"
            onChange={v => onChange('labelConfirm', v)}
          />
        </StageGroup>

        <LabelInput
          colorClass="bg-ive-green"
          title={t('labelEnd')}
          desc={t('labelEndDesc')}
          value={values.labelEnd}
          placeholder="IVE-E"
          onChange={v => onChange('labelEnd', v)}
        />
      </div>

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
