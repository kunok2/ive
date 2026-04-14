'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import ModelSelect from './ModelSelect'
import ModelPricingSection from './ModelPricingSection'
import HumanPricingSection from './HumanPricingSection'

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

// ── SettingsPanel ──

export default function SettingsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { alert } = useDialog()
  const { toast } = useToast()
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
        toast(data.error || tc('saveFailed'), 'error')
      }
    } finally { setSaving(false) }
  }

  async function handleTestMail() {
    if (!testEmail) {
      toast(t('recipientPlaceholder'), 'warning')
      return
    }
    setTesting(true)
    try {
      await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const res = await fetch('/api/admin/mail/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      })
      const data = await res.json()
      if (res.ok) {
        toast(t('testMailSent', { email: testEmail }), 'success')
      } else {
        toast(data.error || t('sendFailed'), 'error')
      }
    } catch {
      toast(t('testFailed'), 'error')
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

      <ModelPricingSection
        expanded={expandedGroup === 'pricing-model'}
        onToggle={() => setExpandedGroup(expandedGroup === 'pricing-model' ? null : 'pricing-model')}
        pricingItems={pricingItems}
        setPricingItems={setPricingItems}
        pricingSaved={pricingSaved}
        setPricingSaved={setPricingSaved}
      />

      <HumanPricingSection
        expanded={expandedGroup === 'pricing-human'}
        onToggle={() => setExpandedGroup(expandedGroup === 'pricing-human' ? null : 'pricing-human')}
        pricingItems={pricingItems}
        setPricingItems={setPricingItems}
        pricingSaved={pricingSaved}
        setPricingSaved={setPricingSaved}
      />

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
