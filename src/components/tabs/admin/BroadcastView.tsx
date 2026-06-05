'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { User } from '@/types'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import MultiSelectPicker from '@/components/ui/MultiSelectPicker'
import { userToOption } from '@/lib/user-display'

export default function BroadcastView() {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { confirm, alert } = useDialog()
  const { toast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; skipped?: number } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers).catch(() => {})
  }, [])

  // 사용자 옵션: 어디서나 동일한 `아바타 + 이름(이메일)` 형태. 수신거부자는 표시로 구분.
  const userOptions = useMemo(() => users.map(u => {
    const o = userToOption(u)
    return u.mailUnsubscribed ? { ...o, hint: `${o.hint} · ${t('unsubscribedTag')}` } : o
  }), [users, t])

  // 실제 발송 대상(선택 없음=전체) 중 수신거부로 제외될 인원 수.
  const excludedCount = useMemo(() => {
    const effective = selectedIds.length > 0 ? users.filter(u => selectedIds.includes(u.id)) : users
    return effective.filter(u => u.mailUnsubscribed).length
  }, [users, selectedIds])

  /** 본문 textarea 커서 위치에 개인화 태그 삽입 */
  function insertTag(tag: string) {
    const el = bodyRef.current
    const token = `{{${tag}}}`
    if (!el) { setBody(b => b + token); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      toast(t('subjectContentRequired'), 'info')
      return
    }
    const targets = selectedIds.length > 0 ? selectedIds : undefined
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
        setResult({ sent: data.sent, failed: data.failed, skipped: data.skipped })
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
        <label className="block text-sm font-bold text-ive-text-muted mb-2">{t('recipients')}</label>
        <MultiSelectPicker
          values={selectedIds}
          onChange={setSelectedIds}
          options={userOptions}
          allLabel={t('noSelectionAllSend')}
          searchable
        />
        <p className="text-xs text-ive-text-dim mt-1">
          {selectedIds.length === 0 ? t('noSelectionAllSend') : t('selectedCount', { count: selectedIds.length })}
          {excludedCount > 0 && <span className="text-ive-amber"> · {t('unsubscribedExcluded', { count: excludedCount })}</span>}
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
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-ive-text-muted">{t('contentHtml')}</label>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-ive-text-dim font-bold">{t('insertTag')}</span>
              <button type="button" onClick={() => insertTag('name')} className="text-[11px] px-1.5 py-0.5 rounded-md bg-ive-bg-card text-ive-cyan border border-ive-border-subtle font-bold">
                {'{{name}}'}
              </button>
              <button type="button" onClick={() => insertTag('email')} className="text-[11px] px-1.5 py-0.5 rounded-md bg-ive-bg-card text-ive-cyan border border-ive-border-subtle font-bold">
                {'{{email}}'}
              </button>
            </div>
          </div>
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
          ref={bodyRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={t('contentPlaceholder')}
          className="w-full flex-1 min-h-[8rem] bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2.5 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-none"
        />
        <p className="text-[11px] text-ive-text-dim mt-1 shrink-0">{t('tagHint')}</p>
      </div>

      {result && (
        <div className={`mb-3 text-sm rounded-lg px-3 py-2 shrink-0 ${result.failed ? 'bg-ive-amber/10 text-ive-amber' : 'bg-ive-green/10 text-ive-green'}`}>
          {t('sendComplete', { sent: result.sent })}{result.failed > 0 && t('sendCompleteFailed', { failed: result.failed })}{result.skipped ? t('sendCompleteSkipped', { count: result.skipped }) : ''}
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
