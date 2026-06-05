'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'

export interface MultiSelectOption {
  value: string
  label: string
  /** 옵션 앞에 표시할 아바타 ID ('av-01' | 'photo' | URL 등). 지정 시 아바타 렌더. */
  avatar?: string
  /** avatar==='photo' 일 때 사진 URL 생성을 위한 사용자 ID */
  avatarUserId?: string | null
  /** 라벨 뒤에 흐리게 표시할 보조 텍스트 (예: 이메일/아이디). 검색 대상에도 포함된다. */
  hint?: string
}

interface MultiSelectPickerProps {
  values: string[]
  onChange: (values: string[]) => void
  options: MultiSelectOption[]
  /** Shown when nothing is selected (treated as "all"). */
  allLabel: string
  /** "+N more" label, with `{n}` placeholder. Example: "+{n}". */
  morePattern?: string
  /** Show inline search above the option list. Defaults to true if options >= 6. */
  searchable?: boolean
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
}

/**
 * 다중 선택 피커. 빈 선택은 "전체"로 취급한다.
 * 트리거에는 선택 개수에 따라:
 *   - 0개 → allLabel
 *   - 1개 → 해당 라벨
 *   - 2개 이상 → 첫 라벨 + " +N"
 */
export default function MultiSelectPicker({
  values,
  onChange,
  options,
  allLabel,
  morePattern = '+{n}',
  searchable,
  size = 'md',
  className = '',
  disabled = false,
}: MultiSelectPickerProps) {
  const tc = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Draft selection — only committed when 확인 is clicked. 취소/외부클릭/Esc는 폐기.
  const [draft, setDraft] = useState<string[]>(values)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  function cancel() {
    setOpen(false)
  }

  function commit() {
    onChange(draft)
    setOpen(false)
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Outside click = cancel (no commit)
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // When opening, snapshot current values into draft and focus search.
  useEffect(() => {
    if (open) {
      setDraft(values)
      setQuery('')
      const id = setTimeout(() => searchRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
    // when closing, the draft is discarded (next open re-snapshots from values)
  }, [open])

  // If the parent's `values` change while closed, keep the draft in sync so
  // a fresh open starts from the latest committed state.
  useEffect(() => {
    if (!open) setDraft(values)
  }, [values, open])

  const showSearch = searchable ?? options.length >= 6

  const draftSet = useMemo(() => new Set(draft), [draft])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q) ||
      (o.hint?.toLowerCase().includes(q) ?? false)
    )
  }, [options, query])

  const triggerLabel = useMemo(() => {
    if (values.length === 0) return allLabel
    const labelMap = new Map(options.map(o => [o.value, o.label]))
    const labels = values.map(v => labelMap.get(v)).filter(Boolean) as string[]
    if (labels.length === 0) return allLabel
    if (labels.length === 1) return labels[0]
    return `${labels[0]} ${morePattern.replace('{n}', String(labels.length - 1))}`
  }, [values, options, allLabel, morePattern])

  const padding = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'
  const isAll = values.length === 0
  const dirty = useMemo(() => {
    if (draft.length !== values.length) return true
    const v = new Set(values)
    return draft.some(x => !v.has(x))
  }, [draft, values])

  function toggle(v: string) {
    setDraft(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  function clearAll() {
    setDraft([])
  }

  /** Select all currently *visible* options, merging with existing draft. */
  function selectAllVisible() {
    setDraft(prev => {
      const merged = new Set(prev)
      for (const o of filtered) merged.add(o.value)
      return Array.from(merged)
    })
  }

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : ''} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full bg-ive-bg-input border border-ive-border rounded-lg ${padding} text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${isAll ? 'text-ive-text-dim' : 'text-ive-text'}`}>
          {triggerLabel}
        </span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-ive-text-dim ml-2 shrink-0`} />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg"
          style={{ backgroundColor: '#1c1c20', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
        >
          {showSearch && (
            <div className="px-2 py-1.5 border-b border-ive-border-subtle">
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass text-[10px] text-ive-text-dim absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={tc('searchPlaceholder')}
                  className="w-full bg-ive-bg-input border border-ive-border rounded-md pl-6 pr-6 py-1 text-xs text-ive-text placeholder:text-ive-text-dim focus:outline-none focus:border-ive-green/50"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ive-text-dim hover:text-ive-text"
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="px-2.5 py-1.5 border-b border-ive-border-subtle flex items-center justify-between text-[11px] font-bold">
            <span className="text-ive-text-dim">
              {draft.length === 0 ? allLabel : `${draft.length} / ${options.length}`}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={selectAllVisible} className="text-ive-cyan active:scale-[0.96]">
                <i className="fa-solid fa-check-double mr-1" />{tc('selectAll')}
              </button>
              <button type="button" onClick={clearAll} className="text-ive-text-dim active:scale-[0.96]">
                <i className="fa-solid fa-xmark mr-1" />{tc('clearSelection')}
              </button>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ive-text-dim/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ive-text-dim/50">
            {filtered.length === 0 ? (
              <div className={`${padding} text-ive-text-dim text-center`}>{tc('noResults')}</div>
            ) : filtered.map(o => {
              const isSel = draftSet.has(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className={`w-full ${padding} text-left hover:bg-white/[0.05] flex items-center gap-2 ${
                    isSel ? 'text-ive-green font-bold' : 'text-ive-text'
                  }`}
                >
                  <i className={`fa-${isSel ? 'solid fa-square-check' : 'regular fa-square'} text-xs shrink-0`} />
                  {o.avatar && <AgentAvatar avatar={o.avatar} userId={o.avatarUserId} size="xs" />}
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="text-ive-text-dim font-normal truncate ml-auto pl-2">{o.hint}</span>}
                </button>
              )
            })}
          </div>
          {/* 확정 / 취소 — 변경은 확인 시점에만 반영. 외부 클릭/Esc/취소는 폐기. */}
          <div className="px-2 py-1.5 border-t border-ive-border-subtle flex gap-1.5">
            <button
              type="button"
              onClick={cancel}
              className="flex-1 py-1.5 rounded-md text-xs font-bold bg-ive-bg-deep border border-ive-border-subtle text-ive-text-dim active:scale-[0.98] transition-all"
            >
              {tc('cancel')}
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!dirty}
              className="flex-1 py-1.5 rounded-md text-xs font-bold bg-ive-green/20 border border-ive-green/40 text-ive-green active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-check mr-1" />{tc('confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
