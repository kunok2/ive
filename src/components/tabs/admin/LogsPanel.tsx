'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

interface LogFile { name: string; size: number; mtime: number }
interface LogConfig {
  level: string; fileEnabled: boolean; dir: string
  frequency: string; maxSizeMb: number; maxFiles: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtTime(ms: number): string {
  try { return new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) } catch { return '' }
}

const TAIL = 2000

export default function LogsPanel() {
  const t = useTranslations('admin')
  const [files, setFiles] = useState<LogFile[]>([])
  const [config, setConfig] = useState<LogConfig | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    fetch('/api/admin/logs')
      .then(r => r.json())
      .then(d => {
        setFiles(d.files || [])
        setConfig(d.config || null)
        if (!selected && d.files?.[0]) setSelected(d.files[0].name)
      })
      .catch(() => {})
  }, [refreshKey])

  useEffect(() => {
    if (!selected) { setContent(''); return }
    setLoading(true)
    fetch(`/api/admin/logs/files?file=${encodeURIComponent(selected)}&tail=${TAIL}`)
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent(''))
      .finally(() => setLoading(false))
  }, [selected, refreshKey])

  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files])

  return (
    // PC 폭: 왼쪽(설정·파일 목록) + 오른쪽(로그 보기). 그보다 좁으면 위아래로 쌓는다
    <main className="space-y-3 desk:space-y-0 desk:grid desk:grid-cols-[360px_minmax(0,1fr)] desk:gap-4 desk:items-start">
      <div className="space-y-3 min-w-0">
      {config && (
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 text-xs space-y-1">
          <div className="font-bold text-ive-text-muted mb-1">{t('log.currentConfig')}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-ive-text-dim">
            <span>level: <span className="text-ive-text">{config.level}</span></span>
            <span>file: <span className="text-ive-text">{config.fileEnabled ? t('log.fileEnabledOn') : t('log.fileEnabledOff')}</span></span>
            <span>frequency: <span className="text-ive-text">{config.frequency}</span></span>
            <span>maxSize: <span className="text-ive-text">{config.maxSizeMb} MB</span></span>
            <span>keep: <span className="text-ive-text">{config.maxFiles}</span></span>
            <span>total: <span className="text-ive-text">{fmtBytes(totalSize)}</span></span>
          </div>
          <div className="text-ive-text-dim mt-1 break-all">dir: <span className="text-ive-text">{config.dir}</span></div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-ive-text-muted">{t('log.filesTitle')} ({files.length})</div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="px-2 py-1 text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-cyan rounded-lg active:scale-[0.98]"
        >
          <i className="fa-solid fa-rotate mr-1" />refresh
        </button>
      </div>

      {files.length === 0 ? (
        <div className="text-center py-8 text-xs text-ive-text-dim">{t('log.filesEmpty')}</div>
      ) : (
        <div className="space-y-1">
          {files.map(f => (
            <div
              key={f.name}
              className={`bg-ive-bg-card border rounded-lg px-3 py-2 flex items-center gap-2 ${
                selected === f.name ? 'border-ive-green/60' : 'border-ive-border-subtle'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelected(f.name)}
                className="flex-1 text-left min-w-0"
              >
                <div className="text-xs font-bold text-ive-text truncate">{f.name}</div>
                <div className="text-[11px] text-ive-text-dim">{fmtBytes(f.size)} · {fmtTime(f.mtime)}</div>
              </button>
              <a
                href={`/api/admin/logs/files?file=${encodeURIComponent(f.name)}&tail=10000`}
                download={f.name}
                className="px-2 py-1 text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim rounded-lg active:scale-[0.98]"
              >
                <i className="fa-solid fa-download" />
              </a>
            </div>
          ))}
        </div>
      )}
      </div>

      {selected && (
        <div className="bg-ive-bg-deep border border-ive-border-subtle rounded-lg overflow-hidden min-w-0">
          <div className="px-3 py-2 border-b border-ive-border-subtle flex items-center justify-between">
            <div className="text-xs font-bold text-ive-text truncate">{selected}</div>
            <div className="text-[11px] text-ive-text-dim">{t('log.tailLines', { n: TAIL })}</div>
          </div>
          <pre className="text-[11px] leading-relaxed p-3 max-h-[60vh] desk:max-h-[calc(100vh-200px)] overflow-auto whitespace-pre-wrap break-all text-ive-text font-mono">
            {loading ? t('log.loading') : (content || t('log.selectFile'))}
          </pre>
        </div>
      )}
    </main>
  )
}
