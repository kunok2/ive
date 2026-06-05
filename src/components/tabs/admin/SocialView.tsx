'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateFull } from '@/lib/format-date'
import Modal from '@/components/ui/Modal'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// 게시 채널 — DB에는 key 문자열로 저장. 라벨/아이콘은 표시용.
export const SOCIAL_CHANNELS: { key: string; label: string; icon: string }[] = [
  { key: 'geeknews', label: '긱뉴스', icon: 'fa-solid fa-newspaper' },
  { key: 'disquiet', label: '디스콰이엇', icon: 'fa-solid fa-rocket' },
  { key: 'producthunt', label: 'Product Hunt', icon: 'fa-brands fa-product-hunt' },
]
export function channelMeta(key: string) {
  return SOCIAL_CHANNELS.find(c => c.key === key) ?? { key, label: key, icon: 'fa-solid fa-link' }
}

interface PostSummary {
  id: string; title: string; status: string; createdAt: string
  channelCount: number; clickCount: number; visitorCount: number; conversionCount: number
}
interface PostLink { id: string; channel: string; url: string }
interface PostDetail { id: string; title: string; body: string; createdAt: string; links: PostLink[] }
interface ChannelStat { channel: string; clicks: number; visitors: number; conversions: number }

/** 본문에 {{link}}가 있으면 치환, 없으면 끝에 추가 — 채널별 복사 텍스트 생성 */
function renderCopy(body: string, url: string): string {
  return body.includes('{{link}}') ? body.split('{{link}}').join(url) : `${body}\n\n${url}`
}

export default function SocialView() {
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const { confirm } = useDialog()
  const { toast } = useToast()

  const [posts, setPosts] = useState<PostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [composeOpen, setComposeOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [channels, setChannels] = useState<Set<string>>(new Set(['geeknews']))
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<PostDetail | null>(null)
  const [stats, setStats] = useState<ChannelStat[] | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/social?limit=100')
      if (res.ok) setPosts((await res.json()).posts)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { fetchPosts() }, [fetchPosts])

  function toggleChannel(k: string) {
    setChannels(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  async function handleCreate() {
    if (!body.trim()) { toast(t('socialBodyRequired'), 'info'); return }
    if (channels.size === 0) { toast(t('socialChannelRequired'), 'info'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/social', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body, channels: Array.from(channels) }),
      })
      const data = await res.json()
      if (res.ok) {
        setComposeOpen(false)
        setTitle(''); setBody(''); setChannels(new Set(['geeknews']))
        await fetchPosts()
        openDetailFromData(data.post)
      } else {
        toast(data.error || tc('saveFailed'), 'error')
      }
    } finally { setSaving(false) }
  }

  function openDetailFromData(post: PostDetail) {
    setDetail(post)
    setStats(null)
    fetch(`/api/admin/social/${post.id}/stats`).then(r => r.ok ? r.json() : null).then(d => d && setStats(d.channels)).catch(() => {})
  }

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/social/${id}`)
      if (res.ok) {
        openDetailFromData((await res.json()).post)
      } else {
        toast(t('detailLoadFailed'), 'error')
      }
    } finally { setDetailLoading(false) }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({ title: t('socialDeleteTitle'), message: t('socialDeleteConfirm'), confirmText: tc('delete'), variant: 'danger' })
    if (!ok) return
    const res = await fetch(`/api/admin/social/${id}`, { method: 'DELETE' })
    if (res.ok) { toast(t('deleted'), 'success'); setDetail(null); fetchPosts() }
    else toast(t('deleteFailed'), 'error')
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast(t('copied'), 'success') }
    catch { toast(t('copyFailed'), 'error') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-ive-text-dim">{t('socialTotal', { count: posts.length })}</span>
        <button
          onClick={() => setComposeOpen(o => !o)}
          className="text-xs px-3 py-1.5 rounded-lg bg-ive-green text-ive-bg-deep font-bold active:scale-[0.97]"
        >
          <i className={`fa-solid ${composeOpen ? 'fa-xmark' : 'fa-plus'} mr-1`} />{composeOpen ? tc('cancel') : t('socialNew')}
        </button>
      </div>

      {composeOpen && (
        <div className="mb-4 bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-3">
          <input
            value={title} onChange={e => setTitle(e.target.value)} placeholder={t('socialTitlePlaceholder')}
            className="w-full bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green"
          />
          <div>
            <textarea
              value={body} onChange={e => setBody(e.target.value)} placeholder={t('socialBodyPlaceholder')}
              className="w-full min-h-[7rem] bg-ive-bg-input border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green resize-y"
            />
            <p className="text-[11px] text-ive-text-dim mt-1">{t('socialLinkHint')}</p>
          </div>
          <div>
            <div className="text-xs font-bold text-ive-text-muted mb-1.5">{t('socialChannels')}</div>
            <div className="flex flex-wrap gap-1.5">
              {SOCIAL_CHANNELS.map(ch => {
                const on = channels.has(ch.key)
                return (
                  <button
                    key={ch.key} type="button" onClick={() => toggleChannel(ch.key)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg font-bold border transition-all flex items-center gap-1.5 ${
                      on ? 'bg-ive-green/15 text-ive-green border-ive-green/30' : 'bg-ive-bg-deep text-ive-text-dim border-ive-border-subtle'
                    }`}
                  >
                    <i className={ch.icon} />{ch.label}
                  </button>
                )
              })}
            </div>
          </div>
          <button
            onClick={handleCreate} disabled={saving || !body.trim() || channels.size === 0}
            className="w-full bg-ive-green-dark text-white font-bold py-2.5 rounded-lg text-sm active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tc('save')}...</> : <><i className="fa-solid fa-floppy-disk mr-1" />{t('socialSaveAndLinks')}</>}
          </button>
        </div>
      )}

      {loading && posts.length === 0 ? (
        <div className="text-center py-10 text-ive-text-dim">{tc('loading')}</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-10">
          <i className="fa-solid fa-share-nodes text-3xl text-ive-text-dim mb-3 block" />
          <p className="text-sm text-ive-text-dim">{t('socialEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {posts.map(p => (
            <button
              key={p.id} onClick={() => openDetail(p.id)}
              className="w-full text-left bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5 active:scale-[0.99] transition-transform hover:border-ive-border"
            >
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-share-nodes text-ive-text-dim text-xs shrink-0" />
                <span className="text-xs font-bold text-ive-text flex-1 truncate">{p.title || t('socialNoTitle')}</span>
                <span className="text-[11px] text-ive-text-dim shrink-0">{p.channelCount}ch</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 text-ive-cyan font-bold"><i className="fa-solid fa-arrow-pointer" />{t('accessCount', { count: p.clickCount })}</span>
                <span className="inline-flex items-center gap-1 text-ive-text-dim font-bold"><i className="fa-solid fa-user" />{p.visitorCount}</span>
                <span className="inline-flex items-center gap-1 text-ive-green font-bold"><i className="fa-solid fa-user-plus" />{p.conversionCount}</span>
                <span className="ml-auto text-ive-text-dim">{formatDateFull(p.createdAt, userLocale, userTz)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 pointer-events-none">
          <i className="fa-solid fa-circle-notch fa-spin text-2xl text-white" />
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('socialDetailTitle')}>
        {detail && (
          <div className="space-y-3">
            {detail.title && <div className="text-sm text-ive-text font-bold break-words bg-ive-bg-deep rounded-lg px-3 py-2">{detail.title}</div>}

            <div>
              <div className="text-xs text-ive-text-dim font-bold mb-1">{t('socialChannelLinks')}</div>
              <p className="text-[11px] text-ive-text-dim mb-2">{t('socialCopyHint')}</p>
              <div className="space-y-1.5">
                {detail.links.map(l => {
                  const m = channelMeta(l.channel)
                  const st = stats?.find(s => s.channel === l.channel)
                  return (
                    <div key={l.id} className="bg-ive-bg-deep rounded-lg px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <i className={`${m.icon} text-ive-text-muted`} />
                        <span className="text-xs font-bold text-ive-text flex-1">{m.label}</span>
                        {st && (
                          <span className="text-[11px] text-ive-text-dim">
                            <i className="fa-solid fa-arrow-pointer mr-0.5 text-ive-cyan" />{st.clicks}
                            <i className="fa-solid fa-user-plus ml-2 mr-0.5 text-ive-green" />{st.conversions}
                          </span>
                        )}
                        <button onClick={() => copy(renderCopy(detail.body, l.url))} className="text-[11px] px-2 py-1 rounded-md bg-ive-green/15 text-ive-green border border-ive-green/30 font-bold shrink-0">
                          <i className="fa-solid fa-copy mr-1" />{t('socialCopyText')}
                        </button>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <code className="flex-1 text-[10px] text-ive-text-dim truncate">{l.url}</code>
                        <button onClick={() => copy(l.url)} title={t('socialCopyLink')} className="text-[10px] text-ive-cyan px-1.5 py-0.5 rounded shrink-0">
                          <i className="fa-solid fa-link" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="text-xs text-ive-text-dim font-bold mb-1">{t('subject')}</div>
              <pre className="bg-ive-bg-deep text-ive-text rounded-lg p-3 text-xs whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{detail.body}</pre>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => handleDelete(detail.id)} className="flex-1 py-2 rounded-lg bg-ive-red/10 text-ive-red border border-ive-red/30 text-xs font-bold active:scale-[0.98]">
                <i className="fa-solid fa-trash mr-1" />{tc('delete')}
              </button>
              <button onClick={() => setDetail(null)} className="flex-1 py-2 rounded-lg bg-ive-bg-deep text-ive-text-dim border border-ive-border-subtle text-xs font-bold active:scale-[0.98]">
                {tc('close')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
