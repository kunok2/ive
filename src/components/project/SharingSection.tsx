'use client'

import { useState, useEffect, useCallback } from 'react'
import { Project, ShareRole } from '@/types'
import { useTranslations } from 'next-intl'

interface Share {
  id: string
  userId: string
  userName: string
  userEmail: string
  role: ShareRole
  createdAt: string
}

interface Candidate {
  id: string
  name: string
  email: string
}

export interface SharingSectionProps {
  existing: Project
}

export default function SharingSection({ existing }: SharingSectionProps) {
  const t = useTranslations('project')
  const tc = useTranslations('common')

  const [showSharing, setShowSharing] = useState(false)
  const [shares, setShares] = useState<Share[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [shareRole, setShareRole] = useState<ShareRole>('viewer')
  const [shareError, setShareError] = useState('')
  const [shareLoading, setShareLoading] = useState(false)

  const fetchShares = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${existing.id}/shares`)
      if (res.ok) {
        const data = await res.json()
        setShares(data.shares)
        setCandidates(data.candidates)
      }
    } catch { /* ignore */ }
  }, [existing.id])

  useEffect(() => {
    fetchShares()
  }, [fetchShares])

  useEffect(() => {
    if (showSharing) fetchShares()
  }, [showSharing, fetchShares])

  async function handleAddShare(userId: string) {
    if (!userId) return
    setShareError('')
    setShareLoading(true)
    try {
      const res = await fetch(`/api/projects/${existing.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: shareRole }),
      })
      if (!res.ok) {
        const data = await res.json()
        setShareError(data.error || t('shareAddFailed'))
      } else {
        fetchShares()
      }
    } catch { setShareError(tc('serverError')) }
    finally { setShareLoading(false) }
  }

  async function handleRemoveShare(shareId: string) {
    await fetch(`/api/projects/${existing.id}/shares`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId }),
    })
    fetchShares()
  }

  async function handleChangeShareRole(shareId: string, role: ShareRole) {
    await fetch(`/api/projects/${existing.id}/shares`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareId, role }),
    })
    fetchShares()
  }

  // Owner-only check
  if ((existing as any).shareRole) return null

  return (
    <div className="border-t border-ive-border-dark pt-2">
      <button
        type="button"
        onClick={() => setShowSharing(!showSharing)}
        className="flex items-center gap-1.5 text-base font-bold text-ive-cyan mb-3"
      >
        <i className={`fa-solid ${showSharing ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
        <i className="fa-solid fa-share-nodes mr-0.5" />
        {t('shareProject')}
        {shares.length > 0 && <span className="text-xs font-bold bg-ive-cyan/20 text-ive-cyan px-1.5 py-0.5 rounded-lg">{shares.length}</span>}
      </button>

      {showSharing && (
        <div className="space-y-3 pb-2 animate-in fade-in slide-in-from-top-2">
          {/* Shared user list */}
          {shares.length > 0 && (
            <div className="space-y-2">
              {shares.map(s => (
                <div key={s.id} className="flex items-center gap-2 bg-ive-bg-deep rounded-lg px-3 py-2 border border-ive-border-dark">
                  <i className="fa-solid fa-user-circle text-lg text-ive-text-dim" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-ive-text truncate">{s.userName}</div>
                    <div className="text-xs text-ive-text-dim truncate">{s.userEmail}</div>
                  </div>
                  <div className="flex bg-ive-bg-input rounded-lg overflow-hidden border border-ive-border">
                    <button
                      type="button"
                      onClick={() => handleChangeShareRole(s.id, 'viewer')}
                      className={`px-2 py-1 text-xs font-bold transition-all ${s.role === 'viewer' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
                    >{t('viewer')}</button>
                    <button
                      type="button"
                      onClick={() => handleChangeShareRole(s.id, 'editor')}
                      className={`px-2 py-1 text-xs font-bold transition-all border-l border-ive-border ${s.role === 'editor' ? 'bg-ive-amber/15 text-ive-amber' : 'text-ive-text-dim hover:text-ive-text'}`}
                    >{t('editor')}</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveShare(s.id)}
                    className="text-ive-red/60 hover:text-ive-red transition-colors p-1"
                    title={t('unshare')}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new user */}
          {candidates.length > 0 ? (
            <div className="space-y-2">
              <div className="flex bg-ive-bg-input rounded-lg overflow-hidden border border-ive-border">
                <button
                  type="button"
                  onClick={() => setShareRole('viewer')}
                  className={`flex-1 py-2 text-sm font-bold transition-all ${shareRole === 'viewer' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'}`}
                >{t('viewer')}</button>
                <button
                  type="button"
                  onClick={() => setShareRole('editor')}
                  className={`flex-1 py-2 text-sm font-bold transition-all border-l border-ive-border ${shareRole === 'editor' ? 'bg-ive-amber/15 text-ive-amber' : 'text-ive-text-dim hover:text-ive-text'}`}
                >{t('editor')}</button>
              </div>
              <div className="space-y-1">
                {candidates.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={shareLoading}
                    onClick={() => { setShareError(''); handleAddShare(u.id) }}
                    className="w-full text-left px-3 py-2.5 text-sm bg-ive-bg-deep rounded-lg border border-ive-border-dark hover:border-ive-cyan/40 hover:bg-ive-cyan/5 transition-all flex items-center gap-2 disabled:opacity-40"
                  >
                    <i className="fa-solid fa-user-circle text-lg text-ive-text-dim" />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-ive-text">{u.name}</span>
                      <span className="text-ive-text-dim text-xs ml-1.5">{u.email}</span>
                    </div>
                    <i className="fa-solid fa-plus text-xs text-ive-cyan/60" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ive-text-dim">
              <i className="fa-solid fa-users-slash mr-1" />{t('noUsersToAdd')}
            </p>
          )}
          {shareError && (
            <p className="text-xs text-ive-red font-bold"><i className="fa-solid fa-circle-exclamation mr-1" />{shareError}</p>
          )}
          <p className="text-xs text-ive-text-dim">
            <i className="fa-solid fa-info-circle mr-1" />
            {t('shareRoleHint')}
          </p>
        </div>
      )}
    </div>
  )
}
