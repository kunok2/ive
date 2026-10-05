'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Modal from '@/components/ui/Modal'
import MarkdownNote from '@/components/ui/MarkdownNote'
import type { Release } from '@/lib/changelog'

/**
 * 변경 이력 — 판별로 무엇이 바뀌었는지(CHANGELOG.md). 도움말 아래 「IVE vX.Y.Z · 변경 이력」에서 연다.
 * 최신 판은 펼쳐 두고 나머지는 접는다. 지금 돌고 있는 판에는 「현재」를 붙인다.
 */
export default function ReleaseNotesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('help')
  const [data, setData] = useState<{ version: string; releases: Release[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open || data) return
    let alive = true
    fetch('/api/changelog')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { version: string; releases: Release[] }) => {
        if (!alive) return
        setData(d)
        if (d.releases[0]) setExpanded(new Set([d.releases[0].version]))
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [open, data])

  const toggle = (v: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(v)) next.delete(v); else next.add(v)
    return next
  })

  return (
    <Modal open={open} onClose={onClose} title={t('releaseNotes')}>
      {!data && !failed && <div className="text-sm font-bold text-ive-text-secondary"><i className="fa-solid fa-circle-notch fa-spin mr-1.5" />{t('releaseNotesLoading')}</div>}
      {failed && <div className="text-sm font-bold text-ive-red">{t('releaseNotesFailed')}</div>}
      {data && (
        <div className="flex flex-col gap-2">
          {data.releases.map(r => {
            const isOpen = expanded.has(r.version)
            return (
              <div key={r.version} className="rounded-lg border border-ive-border-subtle bg-ive-bg-deep/40">
                <button
                  type="button"
                  onClick={() => toggle(r.version)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                >
                  <span className="text-sm font-bold text-ive-text">v{r.version}</span>
                  {r.version === data.version && (
                    <span className="px-1.5 py-0.5 rounded-lg text-xs font-bold bg-ive-green/15 text-ive-green">{t('currentVersion')}</span>
                  )}
                  {r.date && <span className="text-xs font-bold text-ive-text-secondary tabular-nums">{r.date}</span>}
                  <i className={`fa-solid fa-chevron-down ml-auto text-xs text-ive-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 text-sm text-ive-text-secondary leading-relaxed border-t border-ive-border-dark pt-2">
                    <MarkdownNote body={r.body} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
