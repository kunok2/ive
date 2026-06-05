'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher'
import type { LegalConfig } from '@/lib/legal-config'

type Section = { heading: string; body?: string; items?: string[] }
type Doc = { title: string; intro: string; sections: Section[] }

// 약관 본문은 i18n 템플릿이고, 회사·담당자 값은 관리자 설정(config)에서 주입한다.
function fillTokens(text: string, c: LegalConfig): string {
  return text
    .replace(/\{companyName\}/g, c.companyName)
    .replace(/\{companyAddress\}/g, c.companyAddress)
    .replace(/\{officerName\}/g, c.officerName)
    .replace(/\{officerEmail\}/g, c.officerEmail)
    .replace(/\{serviceUrl\}/g, c.serviceUrl)
}

export default function LegalDocument({ docKey, config }: { docKey: 'privacy' | 'terms'; config: LegalConfig }) {
  const t = useTranslations('legal')
  const doc = t.raw(docKey) as Doc
  const f = (s: string) => fillTokens(s, config)

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <Link href="/login" className="text-sm font-bold text-ive-text-muted hover:text-ive-green transition-colors">
            <i className="fa-solid fa-arrow-left mr-1.5" />{t('ui.back')}
          </Link>
          <LanguageSwitcher />
        </div>

        <h1 className="text-2xl font-bold text-ive-text mb-1">{doc.title}</h1>
        <p className="text-xs font-bold text-ive-text-dim mb-6">
          {t('ui.effectiveLabel')}: {config.effectiveDate}
        </p>

        <p className="text-sm text-ive-text-muted leading-relaxed mb-8">{f(doc.intro)}</p>

        <div className="flex flex-col gap-6">
          {doc.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-base font-bold text-ive-text mb-2">{f(s.heading)}</h2>
              {s.body && (
                <p className="text-sm text-ive-text-muted leading-relaxed mb-2">{f(s.body)}</p>
              )}
              {s.items && (
                <ul className="flex flex-col gap-1.5">
                  {s.items.map((item, j) => (
                    <li key={j} className="flex gap-2 text-sm text-ive-text-muted leading-relaxed">
                      <span className="text-ive-text-dim shrink-0">·</span>
                      <span>{f(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-ive-border-dark flex justify-center gap-4 text-sm font-bold">
          <Link href="/legal/terms" className="text-ive-text-muted hover:text-ive-green transition-colors">
            {t('ui.termsLink')}
          </Link>
          <Link href="/legal/privacy" className="text-ive-text-muted hover:text-ive-green transition-colors">
            {t('ui.privacyLink')}
          </Link>
          <Link href="/legal/licenses" className="text-ive-text-muted hover:text-ive-green transition-colors">
            {t('ui.licensesLink')}
          </Link>
        </div>
      </div>
    </div>
  )
}
