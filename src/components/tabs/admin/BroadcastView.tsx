'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { User } from '@/types'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'

export default function BroadcastView() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { confirm, alert } = useDialog()
  const { toast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers).catch(() => {})
  }, [])

  function toggleUser(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === users.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(users.map(u => u.id)))
    }
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      toast(t('subjectContentRequired'), 'info')
      return
    }
    const targets = selectedIds.size > 0 ? Array.from(selectedIds) : undefined
    const isAll = !targets
    const recipientCount = isAll ? users.length : targets!.length
    const ok = await confirm({
      title: isAll ? t('sendToAll') : t('sendConfirmTitle'),
      message: isAll
        ? t('sendToAllConfirm')
        : t('sendConfirmMessage', { count: recipientCount }),
      confirmText: t('send'),
      variant: 'warning',
    })
    if (!ok) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim(), userIds: targets }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ sent: data.sent, failed: data.failed })
        if (data.failed > 0) {
          toast(t('sendComplete', { sent: data.sent, failed: data.failed }), 'error')
        } else {
          toast(t('sendComplete', { sent: data.sent }), 'success')
        }
      } else {
        toast(data.error || t('sendFailed'), 'error')
      }
    } finally {
      setSending(false)
    }
  }

  async function handleClearBody() {
    if (!body) return
    const ok = await confirm({
      title: t('clearBody'),
      message: t('clearBodyConfirm'),
      confirmText: tc('confirm'),
      variant: 'warning',
    })
    if (ok) setBody('')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 수신자 선택 */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-bold text-ive-text-muted">{t('recipients')}</label>
          <button onClick={toggleAll} className="text-xs text-ive-cyan font-bold">
            {selectedIds.size === users.length ? t('unselectAll') : t('selectAll')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => toggleUser(u.id)}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                selectedIds.has(u.id)
                  ? 'bg-ive-green/20 text-ive-green border border-ive-green/30'
                  : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-ive-text-dim mt-1">
          {selectedIds.size === 0 ? t('noSelectionAllSend') : t('selectedCount', { count: selectedIds.size })}
        </p>
      </div>

      {/* 제목 */}
      <div className="mb-3 shrink-0">
        <label className="block text-sm font-bold text-ive-text-muted mb-1">{t('subject')}</label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder={t('subjectPlaceholder')}
          className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
        />
      </div>

      {/* 본문 */}
      <div className="mb-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-1 shrink-0">
          <label className="text-sm font-bold text-ive-text-muted">{t('contentHtml')}</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              disabled={!body.trim()}
              className="text-xs px-2 py-1 rounded-lg bg-ive-bg-card text-ive-cyan border border-ive-border-subtle font-bold disabled:opacity-40"
            >
              <i className="fa-solid fa-eye mr-1" />{t('preview')}
            </button>
            <button
              type="button"
              onClick={handleClearBody}
              disabled={!body}
              className="text-xs px-2 py-1 rounded-lg bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle font-bold disabled:opacity-40"
            >
              <i className="fa-solid fa-eraser mr-1" />{t('clearBody')}
            </button>
          </div>
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={t('contentPlaceholder')}
          className="w-full flex-1 min-h-[8rem] bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none"
        />
      </div>

      {result && (
        <div className={`mb-3 text-sm rounded-lg px-3 py-2 shrink-0 ${result.failed ? 'bg-ive-amber/10 text-ive-amber' : 'bg-ive-green/10 text-ive-green'}`}>
          {t('sendComplete', { sent: result.sent })}{result.failed > 0 && t('sendCompleteFailed', { failed: result.failed })}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending || !subject.trim() || !body.trim()}
        className="w-full bg-ive-green-dark text-white font-bold py-3 rounded-lg text-sm active:scale-[0.98] transition-all disabled:opacity-40 shrink-0"
      >
        {sending ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{t('sending')}</> : <><i className="fa-solid fa-paper-plane mr-1" />{t('mailSend')}</>}
      </button>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('previewTitle')}>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-ive-text-dim font-bold mb-1">{t('subject')}</div>
            <div className="text-sm text-ive-text font-bold break-words">{subject || <span className="text-ive-text-dim font-normal italic">({t('subjectPlaceholder')})</span>}</div>
          </div>
          <div>
            <div className="text-xs text-ive-text-dim font-bold mb-1">{t('contentHtml')}</div>
            <div
              className="bg-white text-black rounded-lg p-4 text-sm border border-ive-border-subtle break-words overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: body || `<span style="color:#999;font-style:italic">(${t('contentPlaceholder')})</span>` }}
            />
            <p className="text-xs text-ive-text-dim mt-1">{t('previewHint')}</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
