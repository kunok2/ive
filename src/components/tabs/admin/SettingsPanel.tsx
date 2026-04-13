'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'

// ── Types ──

interface SettingField {
  key: string; label: string; type: 'text' | 'password' | 'number' | 'textarea' | 'model-select'
  placeholder?: string; defaultValue?: string; rows?: number; cliName?: string
}
interface SettingGroup {
  key: string
  label: string
  icon: string
  fields: SettingField[]
}

interface PricingItem {
  id: string; cliName: string; modelName: string
  inputPrice: number; outputPrice: number; updatedAt: string
}

// ── Constants ──

const SETTING_GROUPS: SettingGroup[] = [
  {
    key: 'cli_paths', label: 'cliPathLabel', icon: 'fa-solid fa-terminal',
    fields: [
      { key: 'cli.claude.path', label: 'Claude Code', type: 'text', placeholder: '/usr/local/bin/claude', defaultValue: '/usr/local/bin/claude' },
      { key: 'cli.claude.model', label: 'Claude Model', type: 'model-select', cliName: 'claude' },
      { key: 'cli.opencode.path', label: 'OpenCode', type: 'text', placeholder: '/usr/local/bin/opencode', defaultValue: '/usr/local/bin/opencode' },
      { key: 'cli.opencode.model', label: 'OpenCode Model', type: 'model-select', cliName: 'opencode' },
    ],
  },
  {
    key: 'mail', label: 'smtpMail', icon: 'fa-solid fa-envelope',
    fields: [
      { key: 'mail.smtp_host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com' },
      { key: 'mail.smtp_port', label: 'SMTP Port', type: 'text', placeholder: '587' },
      { key: 'mail.smtp_user', label: 'SMTP User', type: 'text', placeholder: 'user@gmail.com' },
      { key: 'mail.smtp_password', label: 'SMTP Password', type: 'password', placeholder: 'App Password' },
      { key: 'mail.from_name', label: 'From Name', type: 'text', placeholder: 'IVE' },
      { key: 'mail.domain', label: 'Mail Domain', type: 'text', placeholder: 'example.com' },
    ],
  },
  {
    key: 'retention', label: 'dataRetention', icon: 'fa-solid fa-database',
    fields: [
      { key: 'retention.executions_days', label: 'Execution Retention (days)', type: 'number', placeholder: '365' },
      { key: 'retention.snapshots_days', label: 'Snapshot Retention (days)', type: 'number', placeholder: '7' },
    ],
  },
  {
    key: 'oauth', label: 'oauthSettings', icon: 'fa-solid fa-key',
    fields: [
      {
        key: 'oauth.redirect_base',
        label: 'Redirect Base URL',
        type: 'text',
        placeholder: 'https://ive.dazzleat.link',
        defaultValue: 'https://ive.dazzleat.link',
      },
    ],
  },
  {
    key: 'mcp', label: 'mcpServer', icon: 'fa-solid fa-plug',
    fields: [
      {
        key: 'mcp.config',
        label: 'MCP Config (JSON)',
        type: 'textarea',
        rows: 8,
        placeholder: `{\n  "github": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-github"],\n    "environment": { "GITHUB_TOKEN": "ghp_xxx" }\n  }\n}`,
      },
    ],
  },
]

// ── ModelSelect ──

function ModelSelect({ models, value, onChange }: { models: string[]; value: string; onChange: (v: string) => void }) {
  const t = useTranslations('admin')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const options = [{ value: '', label: t('cliDefault') }, ...models.map(m => ({ value: m, label: m }))]
  const selected = options.find(o => o.value === value) || options[0]

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50"
      >
        <span className={value ? 'text-ive-text' : 'text-ive-text-dim'}>{selected.label}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-ive-text-dim`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg max-h-52 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ive-text-dim/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ive-text-dim/50">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-white/[0.05] ${
                o.value === value ? 'text-ive-green font-bold' : 'text-ive-text'
              } ${o.value === '' ? 'text-ive-text-dim' : ''}`}
            >
              {o.value === value && <i className="fa-solid fa-check text-xs mr-2" />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SettingsPanel ──

export default function SettingsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { alert } = useDialog()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [passwordsSet, setPasswordsSet] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  // pricing
  const [pricingItems, setPricingItems] = useState<PricingItem[]>([])
  const [pricingFetching, setPricingFetching] = useState(false)
  const [pricingSaving, setPricingSaving] = useState(false)
  const [pricingSaved, setPricingSaved] = useState(false)
  // CLI 모델 목록
  const [cliModels, setCliModels] = useState<Record<string, string[]>>({})

  useEffect(() => {
    fetch('/api/admin/env')
      .then(r => r.json())
      .then(data => {
        const s = data.settings || {}
        const pwSet: Record<string, boolean> = {}
        for (const group of SETTING_GROUPS) {
          for (const field of group.fields) {
            if (field.defaultValue && !s[field.key]) {
              s[field.key] = field.defaultValue
            }
            // 비밀번호 마스크 처리: __password_set__ 값은 "저장됨" 표시용으로 변환
            if (field.type === 'password' && s[field.key] === '__password_set__') {
              pwSet[field.key] = true
              s[field.key] = ''
            }
          }
        }
        setPasswordsSet(pwSet)
        setSettings(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    fetch('/api/settings/pricing').then(r => r.json()).then(setPricingItems).catch(() => {})
    fetch('/api/settings/cli-models').then(r => r.json()).then(setCliModels).catch(() => {})
  }, [])

  function updateSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        const data = await res.json()
        await alert({ message: data.error || tc('saveFailed'), variant: 'error' })
      }
    } finally { setSaving(false) }
  }

  async function handleTestMail() {
    if (!testEmail) {
      await alert({ message: t('recipientPlaceholder'), variant: 'error' })
      return
    }
    setTesting(true)
    try {
      // 먼저 현재 설정 저장
      await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      // 테스트 메일 발송 (입력한 주소로만)
      const res = await fetch('/api/admin/mail/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      })
      const data = await res.json()
      if (res.ok) {
        await alert({ title: t('sendSuccess'), message: t('testMailSent', { email: testEmail }), variant: 'success' })
      } else {
        await alert({ message: data.error || t('sendFailed'), variant: 'error' })
      }
    } catch {
      await alert({ message: t('testFailed'), variant: 'error' })
    } finally { setTesting(false) }
  }

  if (loading) return <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>

  return (
    <main className="space-y-3">
      <div className="text-xs text-ive-text-dim mb-1">
        {t('systemSettingsDesc')}
      </div>

      {SETTING_GROUPS.map((group, groupIdx) => (
        <div key={group.key} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg relative" style={{ zIndex: SETTING_GROUPS.length - groupIdx }}>
          <button
            onClick={() => setExpandedGroup(expandedGroup === group.key ? null : group.key)}
            className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
          >
            <i className={`${group.icon} text-sm text-ive-text-dim`} />
            <span className="text-sm font-bold text-ive-text flex-1">{t(group.label as any)}</span>
            <span className="text-xs text-ive-text-dim">
              {group.fields.filter(f => settings[f.key] || passwordsSet[f.key]).length}/{group.fields.length}
            </span>
            <i className={`fa-solid fa-chevron-${expandedGroup === group.key ? 'up' : 'down'} text-xs text-ive-text-dim`} />
          </button>

          {expandedGroup === group.key && (
            <div className="px-4 pb-4 border-t border-ive-border-dark space-y-3 pt-3">
              {/* Gmail 앱 비밀번호 안내 */}
              {group.key === 'mail' && (
                <div className="bg-ive-amber/10 border border-ive-amber/30 rounded-lg px-3 py-2.5 text-xs text-ive-amber leading-relaxed">
                  <i className="fa-solid fa-triangle-exclamation mr-1.5" />
                  {t('gmailAppPasswordGuide')}
                </div>
              )}

              {group.fields.map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-bold text-ive-text-muted mb-1">{field.label}</label>
                  {field.type === 'model-select' ? (
                    <ModelSelect
                      models={cliModels[field.cliName || ''] || []}
                      value={settings[field.key] || ''}
                      onChange={v => updateSetting(field.key, v)}
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={settings[field.key] || ''}
                      onChange={e => updateSetting(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={field.rows ?? 5}
                      className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50 font-mono resize-y"
                    />
                  ) : field.type === 'password' ? (
                    // 비밀번호 필드: 저장된 경우 "저장됨" 표시 + 변경 버튼
                    passwordsSet[field.key] && !settings[field.key] ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-xs text-ive-green flex items-center gap-1.5">
                          <i className="fa-solid fa-circle-check" />
                          <span>{t('passwordSaved')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPasswordsSet(prev => ({ ...prev, [field.key]: false }))}
                          className="px-3 py-2 text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim rounded-lg active:scale-[0.98] transition-all"
                        >
                          {t('changePassword')}
                        </button>
                      </div>
                    ) : (
                      <input
                        type="password"
                        value={settings[field.key] || ''}
                        onChange={e => updateSetting(field.key, e.target.value)}
                        placeholder={passwordsSet[field.key] ? t('newPasswordPlaceholder') : field.placeholder}
                        autoComplete="new-password"
                        className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                      />
                    )
                  ) : (
                    <input
                      type={field.type}
                      value={settings[field.key] || ''}
                      onChange={e => updateSetting(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                    />
                  )}
                </div>
              ))}

              {/* 메일 그룹에 테스트 발송 */}
              {group.key === 'mail' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    placeholder={t('recipientPlaceholder')}
                    className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                  />
                  <button
                    onClick={handleTestMail}
                    disabled={testing || !testEmail}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan active:scale-[0.98] transition-all disabled:opacity-40 whitespace-nowrap"
                  >
                    {testing
                      ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('testSending')}</>
                      : <><i className="fa-solid fa-paper-plane mr-1" />{t('test')}</>
                    }
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* 모델 단가 설정 섹션 */}
      <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedGroup(expandedGroup === 'pricing-model' ? null : 'pricing-model')}
          className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
        >
          <i className="fa-solid fa-coins text-sm text-ive-text-dim" />
          <span className="text-sm font-bold text-ive-text flex-1">{t('modelPricing')}</span>
          <span className="text-xs text-ive-text-dim">{pricingItems.filter(it => it.cliName !== 'human').length}</span>
          <i className={`fa-solid fa-chevron-${expandedGroup === 'pricing-model' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>

        {expandedGroup === 'pricing-model' && (
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
                          else { const data = await res.json(); await alert({ message: data.error || tc('saveFailed'), variant: 'error' }) }
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
                    if (res.ok) { setPricingItems(await res.json()); setPricingSaved(false); await alert({ title: t('fetchComplete'), message: t('latestPricingApplied'), variant: 'success' }) }
                    else { const data = await res.json(); await alert({ message: data.error || t('fetchFailed'), variant: 'error' }) }
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
                    else { const data = await res.json(); await alert({ message: data.error || tc('saveFailed'), variant: 'error' }) }
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
        )}
      </div>

      {/* 사람 단가 설정 섹션 */}
      <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedGroup(expandedGroup === 'pricing-human' ? null : 'pricing-human')}
          className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-white/[0.02]"
        >
          <i className="fa-solid fa-user-tie text-sm text-ive-text-dim" />
          <span className="text-sm font-bold text-ive-text flex-1">{t('humanPricing')}</span>
          <i className={`fa-solid fa-chevron-${expandedGroup === 'pricing-human' ? 'up' : 'down'} text-xs text-ive-text-dim`} />
        </button>

        {expandedGroup === 'pricing-human' && (
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

      <button
        onClick={handleSave}
        disabled={saving}
        className={`w-full font-bold py-3 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40 ${
          saved ? 'bg-ive-green/20 text-ive-green' : 'bg-ive-green-dark text-white'
        }`}
      >
        {saving
          ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('saving')}</>
          : saved
            ? <><i className="fa-solid fa-check mr-1" />{t('saved')}</>
            : <><i className="fa-solid fa-floppy-disk mr-1" />{tc('save')}</>
        }
      </button>
    </main>
  )
}
