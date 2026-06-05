'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'
import data from '@/data/third-party-licenses.json'

type Pkg = { name: string; version: string; license: string; repository: string; author: string }

export default function LicensesDocument() {
  const t = useTranslations('legal')
  const [q, setQ] = useState('')

  const packages = data.packages as Pkg[]
  const byLicense = data.byLicense as Record<string, number>

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return packages
    return packages.filter(p => p.name.toLowerCase().includes(s) || p.license.toLowerCase().includes(s))
  }, [q, packages])

  const summary = useMemo(
    () => Object.entries(byLicense).sort((a, b) => b[1] - a[1]),
    [byLicense],
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <Link href="/login" className="text-sm font-bold text-ive-text-muted hover:text-ive-green transition-colors">
            <i className="fa-solid fa-arrow-left mr-1.5" />{t('ui.back')}
          </Link>
          <LanguageSwitcher />
        </div>

        <h1 className="text-2xl font-bold text-ive-text mb-1">{t('licenses.title')}</h1>
        <p className="text-xs font-bold text-ive-text-dim mb-6">{t('licenses.total', { count: data.total })}</p>

        <p className="text-sm text-ive-text-muted leading-relaxed mb-6">{t('licenses.intro')}</p>

        {/* 라이선스별 집계 */}
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 mb-4">
          <h2 className="text-sm font-bold text-ive-text mb-3">{t('licenses.summaryTitle')}</h2>
          <div className="flex flex-wrap gap-1.5">
            {summary.map(([lic, n]) => (
              <span key={lic} className="px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-cyan/20 text-ive-cyan">
                {lic} <span className="text-ive-text-muted">· {n}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <a
            href="/third-party-notices.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-ive-cyan hover:opacity-80 transition-opacity"
          >
            <i className="fa-solid fa-file-lines mr-1.5" />{t('licenses.viewFull')}
          </a>
        </div>

        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('licenses.searchPlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-4 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green mb-4"
        />

        <div className="flex flex-col gap-1.5">
          {filtered.length === 0 && (
            <p className="text-sm text-ive-text-dim text-center py-6">{t('licenses.noResults')}</p>
          )}
          {filtered.map(p => (
            <div
              key={`${p.name}@${p.version}`}
              className="flex items-center gap-3 bg-ive-bg/50 border border-ive-border-dark rounded-lg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                {p.repository ? (
                  <a href={p.repository} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-ive-text hover:text-ive-green transition-colors break-all">
                    {p.name}
                  </a>
                ) : (
                  <span className="text-sm font-bold text-ive-text break-all">{p.name}</span>
                )}
                <span className="text-xs text-ive-text-dim ml-1.5">{p.version}</span>
              </div>
              <span className="shrink-0 text-xs font-bold text-ive-text-muted">{p.license}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 text-xs text-ive-text-dim leading-relaxed">
          <i className="fa-solid fa-circle-info mr-1.5" />{t('licenses.platformNote')}
        </div>

        <div className="mt-8 pt-6 border-t border-ive-border-dark flex justify-center gap-4 text-sm font-bold">
          <Link href="/legal/terms" className="text-ive-text-muted hover:text-ive-green transition-colors">{t('ui.termsLink')}</Link>
          <Link href="/legal/privacy" className="text-ive-text-muted hover:text-ive-green transition-colors">{t('ui.privacyLink')}</Link>
        </div>
      </div>
    </div>
  )
}
