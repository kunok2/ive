'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { locales, localeNames, Locale } from '@/i18n/config'

export default function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  async function switchLocale(newLocale: Locale) {
    if (newLocale === locale) { setOpen(false); return }
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`
    try {
      await fetch('/api/settings/locale', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      })
    } catch { /* ignore */ }
    setOpen(false)
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="h-8 px-2 rounded-full bg-ive-bg-card border border-ive-border-subtle flex items-center gap-1 text-xs font-bold text-ive-text-dim hover:text-ive-text active:scale-95 transition-all disabled:opacity-50"
      >
        <i className="fa-solid fa-globe text-xs" />
        {localeNames[locale as Locale]}
        <i className={`fa-solid fa-chevron-down text-[8px] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 min-w-[120px] bg-[#1c1c20] border border-ive-border-subtle rounded-lg overflow-hidden z-50">
          {locales.map((l) => (
            <button
              key={l}
              onClick={() => switchLocale(l)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                l === locale
                  ? 'text-ive-green font-bold bg-ive-green/10'
                  : 'text-ive-text hover:bg-ive-bg-hover'
              }`}
            >
              {localeNames[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
