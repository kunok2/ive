'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/Toast'
import ModelSelect from './ModelSelect'
import ModelPricingSection from './ModelPricingSection'
import HumanPricingSection from './HumanPricingSection'
import AiSubscriptionSection from './AiSubscriptionSection'
import CustomSelect from '@/components/ui/CustomSelect'

// ── Types ──

interface SettingField {
  key: string; label: string; type: 'text' | 'password' | 'number' | 'textarea' | 'model-select' | 'select' | 'boolean'
  placeholder?: string; defaultValue?: string; rows?: number; cliName?: string
  options?: { value: string; label: string }[]
  hint?: string
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
      { key: 'cli.codex.path', label: 'Codex', type: 'text', placeholder: '/usr/local/bin/codex', defaultValue: '/usr/local/bin/codex' },
      { key: 'cli.codex.model', label: 'Codex Model', type: 'model-select', cliName: 'codex' },
      { key: 'cli.agy.path', label: 'agy (Antigravity CLI)', type: 'text', placeholder: '/usr/local/bin/agy', defaultValue: '/usr/local/bin/agy' },
      { key: 'cli.agy.model', label: 'Antigravity CLI Model', type: 'model-select', cliName: 'agy' },
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
    key: 'legal', label: 'legalSettings', icon: 'fa-solid fa-file-contract',
    fields: [
      { key: 'legal.enabled', label: 'legal.enabledLabel', type: 'boolean', defaultValue: 'true', hint: 'legal.enabledHint' },
      { key: 'legal.company_name', label: 'legal.companyName', type: 'text', placeholder: '(주) 스프링웨어' },
      { key: 'legal.company_address', label: 'legal.companyAddress', type: 'text', placeholder: '서울특별시 관악구 …' },
      { key: 'legal.officer_name', label: 'legal.officerName', type: 'text', placeholder: '홍길동' },
      { key: 'legal.officer_email', label: 'legal.officerEmail', type: 'text', placeholder: 'privacy@example.com' },
      { key: 'legal.service_url', label: 'legal.serviceUrl', type: 'text', placeholder: 'https://ive.example.com' },
      { key: 'legal.effective_date', label: 'legal.effectiveDate', type: 'text', placeholder: '2026-06-05' },
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
        hint: 'mcpConfigHint',
        placeholder: `{\n  "github": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-github"],\n    "environment": { "GITHUB_TOKEN": "ghp_xxx" }\n  }\n}`,
      },
    ],
  },
  {
    key: 'logging', label: 'logging', icon: 'fa-solid fa-file-lines',
    fields: [
      {
        key: 'log.level',
        label: 'log.level',
        type: 'select',
        defaultValue: 'info',
        hint: 'log.levelHint',
        options: [
          { value: 'trace', label: 'trace' },
          { value: 'debug', label: 'debug' },
          { value: 'info', label: 'info' },
          { value: 'warn', label: 'warn' },
          { value: 'error', label: 'error' },
          { value: 'fatal', label: 'fatal' },
        ],
      },
      {
        key: 'log.file_enabled',
        label: 'log.fileEnabled',
        type: 'boolean',
        defaultValue: 'true',
        hint: 'log.fileEnabledHint',
      },
      {
        key: 'log.dir',
        label: 'log.dir',
        type: 'text',
        placeholder: 'data/logs/app',
        hint: 'log.dirHint',
      },
      {
        key: 'log.frequency',
        label: 'log.frequency',
        type: 'select',
        defaultValue: 'daily',
        options: [
          { value: 'daily', label: 'log.frequencyDaily' },
          { value: 'hourly', label: 'log.frequencyHourly' },
        ],
      },
      {
        key: 'log.max_size_mb',
        label: 'log.maxSizeMb',
        type: 'number',
        defaultValue: '50',
        placeholder: '50',
      },
      {
        key: 'log.max_files',
        label: 'log.maxFiles',
        type: 'number',
        defaultValue: '14',
        placeholder: '14',
      },
    ],
  },
]

// CLI 경로/모델은 CLI 단위로 묶어서 렌더 (가독성). 아이콘은 단순 형태 구분용(중립색).
const CLI_ITEMS: { cliName: string; label: string; icon: string; pathKey: string; modelKey: string; pathPlaceholder: string }[] = [
  { cliName: 'claude', label: 'Claude Code', icon: 'fa-solid fa-bolt', pathKey: 'cli.claude.path', modelKey: 'cli.claude.model', pathPlaceholder: '/usr/local/bin/claude' },
  { cliName: 'codex', label: 'Codex', icon: 'fa-solid fa-code', pathKey: 'cli.codex.path', modelKey: 'cli.codex.model', pathPlaceholder: '/usr/local/bin/codex' },
  { cliName: 'agy', label: 'agy (Antigravity CLI)', icon: 'fa-solid fa-gem', pathKey: 'cli.agy.path', modelKey: 'cli.agy.model', pathPlaceholder: '/usr/local/bin/agy' },
  { cliName: 'opencode', label: 'OpenCode', icon: 'fa-solid fa-cube', pathKey: 'cli.opencode.path', modelKey: 'cli.opencode.model', pathPlaceholder: '/usr/local/bin/opencode' },
]

// ── SettingsPanel ──

export default function SettingsPanel() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { toast } = useToast()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [passwordsSet, setPasswordsSet] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState<string | null>(null)
  const [savedGroup, setSavedGroup] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  // pricing
  const [pricingItems, setPricingItems] = useState<PricingItem[]>([])
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

  // 입력 중에는 상태만 갱신(텍스트류). 저장은 blur 시 saveGroup() 으로 일어난다.
  function updateSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSavedGroup(g => (g ? null : g))
  }

  // 선택/토글/모델 등 단일값 컨트롤: 변경 즉시 저장 (override 로 최신값 직접 전달).
  function commitField(group: SettingGroup, key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
    saveGroup(group, { [key]: value })
  }

  // 그룹(섹션) 단위 저장 — 해당 그룹의 필드만 전송. 저장 버튼 없이 blur/change 시 자동 저장.
  async function saveGroup(group: SettingGroup, override?: Record<string, string>) {
    const merged = override ? { ...settings, ...override } : settings
    const subset: Record<string, string> = {}
    for (const f of group.fields) {
      if (merged[f.key] !== undefined) subset[f.key] = merged[f.key]
    }
    setSavingGroup(group.key)
    try {
      const res = await fetch('/api/admin/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: subset }),
      })
      if (res.ok) {
        setSavedGroup(group.key)
        setTimeout(() => setSavedGroup(g => (g === group.key ? null : g)), 1500)
      } else {
        const data = await res.json()
        toast(data.error || tc('saveFailed'), 'error')
      }
    } finally {
      setSavingGroup(g => (g === group.key ? null : g))
    }
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
    // PC 폭: 설정 묶음을 2단으로 흘린다(펼친 묶음은 단 안에서 길어진다)
    <main className="space-y-3 desk:space-y-0 desk:columns-2 desk:gap-3 desk:*:mb-3 desk:*:break-inside-avoid">
      <div className="text-xs text-ive-text-dim mb-1 desk:[column-span:all]">
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
            {savingGroup === group.key && <i className="fa-solid fa-circle-notch fa-spin text-xs text-ive-text-dim" />}
            {savingGroup !== group.key && savedGroup === group.key && <i className="fa-solid fa-check text-xs text-ive-green" />}
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

              {group.key === 'cli_paths' && (
                <p className="text-[11px] text-ive-text-dim leading-snug -mt-1">{t('cliPathDesc')}</p>
              )}

              {group.key === 'legal' && (
                <p className="text-[11px] text-ive-text-dim leading-snug -mt-1">{t('legal.intro')}</p>
              )}

              {group.key === 'cli_paths' ? (
                CLI_ITEMS.map(item => (
                  <div key={item.cliName} className="bg-ive-bg-deep border border-ive-border-subtle rounded-lg px-3 py-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <i className={`${item.icon} text-xs text-ive-text-dim w-4 text-center`} />
                      <span className="text-sm font-bold text-ive-text">{item.label}</span>
                    </div>
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-bold text-ive-text-muted mb-1">{t('cliExecPath')}</label>
                        <input
                          type="text"
                          value={settings[item.pathKey] || ''}
                          onChange={e => updateSetting(item.pathKey, e.target.value)}
                          onBlur={() => saveGroup(group)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          placeholder={item.pathPlaceholder}
                          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-ive-text-muted mb-1">{t('cliModel')}</label>
                        <ModelSelect
                          models={cliModels[item.cliName] || []}
                          value={settings[item.modelKey] || ''}
                          onChange={v => commitField(group, item.modelKey, v)}
                        />
                      </div>
                    </div>
                  </div>
                ))
              ) : group.fields.map(field => {
                // Allow `field.label` and option labels to be either literal text
                // or an i18n key for the `admin` namespace (used by the logging group).
                const tr = (s: string) => {
                  if (!s.includes('.') && !/^[a-z]+[A-Z]/.test(s)) return s
                  try { return t(s as any) } catch { return s }
                }
                return (
                <div key={field.key}>
                  <label className="block text-xs font-bold text-ive-text-muted mb-1">{tr(field.label)}</label>
                  {field.type === 'model-select' ? (
                    <ModelSelect
                      models={cliModels[field.cliName || ''] || []}
                      value={settings[field.key] || ''}
                      onChange={v => commitField(group, field.key, v)}
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={settings[field.key] || ''}
                      onChange={e => updateSetting(field.key, e.target.value)}
                      onBlur={() => saveGroup(group)}
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
                        onBlur={() => saveGroup(group)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        placeholder={passwordsSet[field.key] ? t('newPasswordPlaceholder') : field.placeholder}
                        autoComplete="new-password"
                        className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                      />
                    )
                  ) : field.type === 'select' ? (
                    <CustomSelect
                      value={settings[field.key] || field.defaultValue || ''}
                      onChange={v => commitField(group, field.key, v)}
                      options={(field.options || []).map(opt => ({ value: opt.value, label: tr(opt.label) }))}
                    />
                  ) : field.type === 'boolean' ? (
                    (() => {
                      const on = (settings[field.key] ?? field.defaultValue ?? 'false') === 'true'
                      return (
                        <button
                          type="button"
                          onClick={() => commitField(group, field.key, on ? 'false' : 'true')}
                          className="flex items-center gap-2 text-sm text-ive-text"
                        >
                          <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-ive-green' : 'bg-ive-border'}`}>
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
                          </span>
                          {on ? t('log.fileEnabledOn') : t('log.fileEnabledOff')}
                        </button>
                      )
                    })()
                  ) : (
                    <input
                      type={field.type}
                      value={settings[field.key] || ''}
                      onChange={e => updateSetting(field.key, e.target.value)}
                      onBlur={() => saveGroup(group)}
                      onKeyDown={e => { if (field.type !== 'textarea' && e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      placeholder={field.placeholder}
                      className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                    />
                  )}
                  {field.hint && (
                    <p className="mt-1 text-[11px] text-ive-text-dim leading-snug">{tr(field.hint)}</p>
                  )}
                </div>
                )
              })}

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
      />

      <AiSubscriptionSection
        expanded={expandedGroup === 'pricing-ai-sub'}
        onToggle={() => setExpandedGroup(expandedGroup === 'pricing-ai-sub' ? null : 'pricing-ai-sub')}
      />

      <HumanPricingSection
        expanded={expandedGroup === 'pricing-human'}
        onToggle={() => setExpandedGroup(expandedGroup === 'pricing-human' ? null : 'pricing-human')}
        setPricingItems={setPricingItems}
      />

    </main>
  )
}
