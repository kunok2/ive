'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Status = { email: string; name: string; unsubscribed: boolean }

function UnsubscribeInner() {
  const t = useTranslations('unsubscribe')
  const token = useSearchParams().get('token') || ''
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return }
    fetch(`/api/mail/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Status) => setStatus(d))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [token])

  async function apply(subscribe: boolean) {
    setBusy(true)
    try {
      const res = await fetch('/api/mail/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, subscribe }),
      })
      if (res.ok) setStatus(await res.json())
      else setInvalid(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-ive-bg">
      <div className="w-full max-w-md bg-ive-bg-card border border-ive-border-subtle rounded-lg p-8">
        <div className="flex items-center gap-2 mb-6">
          <i className="fa-solid fa-envelope text-ive-green text-lg" />
          <span className="text-ive-text font-bold text-lg">Springware IVE</span>
        </div>

        {loading ? (
          <div className="text-ive-text-dim text-sm font-bold py-8 text-center">
            <i className="fa-solid fa-circle-notch fa-spin mr-2" />{t('loading')}
          </div>
        ) : invalid ? (
          <div className="text-ive-amber text-sm font-bold py-6 text-center">
            <i className="fa-solid fa-triangle-exclamation mr-2" />{t('invalid')}
          </div>
        ) : status ? (
          <div className="space-y-5">
            <p className="text-ive-text-dim text-sm font-bold break-all">{status.email}</p>
            {status.unsubscribed ? (
              <>
                <div className="rounded-lg bg-ive-green/10 border border-ive-green/30 px-4 py-3 text-ive-green text-sm font-bold">
                  <i className="fa-solid fa-circle-check mr-2" />{t('doneTitle')}
                </div>
                <p className="text-ive-text-dim text-xs font-bold leading-relaxed">{t('doneDesc')}</p>
                <button
                  onClick={() => apply(true)}
                  disabled={busy}
                  className="w-full bg-ive-bg-input border border-ive-border text-ive-text font-bold py-2.5 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  {busy ? <i className="fa-solid fa-circle-notch fa-spin" /> : t('resubscribe')}
                </button>
              </>
            ) : (
              <>
                <p className="text-ive-text text-sm font-bold leading-relaxed">{t('confirmDesc')}</p>
                <button
                  onClick={() => apply(false)}
                  disabled={busy}
                  className="w-full bg-ive-green-dark text-white font-bold py-2.5 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40"
                >
                  {busy ? <i className="fa-solid fa-circle-notch fa-spin" /> : t('unsubscribe')}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  )
}
