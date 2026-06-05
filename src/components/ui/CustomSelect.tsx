'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import AgentAvatar from '@/components/agent/AgentAvatar'

export interface CustomSelectOption {
  value: string
  label: string
  hint?: string
  /** FontAwesome 클래스 (예: 'fa-solid fa-moon') */
  icon?: string
  /** 아이콘에 적용할 색상 클래스 (예: 'text-ive-amber') */
  iconClass?: string
  /** 옵션 앞에 표시할 아바타 ID ('av-01' | 'photo' | URL). 사용자 옵션 통일용. */
  avatar?: string
  /** avatar==='photo' 일 때 사진 URL 생성을 위한 사용자 ID */
  avatarUserId?: string | null
}

interface CustomSelectProps {
  value: string
  onChange: (v: string) => void
  options: CustomSelectOption[]
  placeholder?: string
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
}

/**
 * 표준 콤보박스. ive-* 색상과 fa-chevron 어포던스를 사용하며,
 * 외부 클릭/Esc로 닫힌다. 드롭다운은 Portal로 렌더링해 overflow:hidden 클리핑에서 벗어난다.
 */
export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  size = 'md',
  className = '',
  disabled = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  useEffect(() => { setMounted(true) }, [])

  // 버튼 위치 기준으로 드롭다운 fixed 좌표 계산
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const DROPDOWN_MAX_H = 240 // max-h-60
    const spaceBelow = viewportHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    // 아래 공간이 부족하고 위 공간이 더 넓으면 위에 표시
    const showAbove = spaceBelow < Math.min(DROPDOWN_MAX_H, 120) && spaceAbove > spaceBelow

    setDropdownStyle(
      showAbove
        ? {
            position: 'fixed',
            bottom: viewportHeight - rect.top + 4,
            left: rect.left,
            width: rect.width,
            maxHeight: Math.min(spaceAbove, DROPDOWN_MAX_H),
            zIndex: 9999,
          }
        : {
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            maxHeight: Math.min(spaceBelow, DROPDOWN_MAX_H),
            zIndex: 9999,
          },
    )
  }, [])

  // 드롭다운 열릴 때 위치 계산 + 스크롤/리사이즈 시 닫기
  useEffect(() => {
    if (!open) return
    updatePosition()

    const onScrollOrResize = (e: Event) => {
      // 드롭다운 내부 스크롤은 무시 (Window 등 Non-Node target은 항상 닫기)
      const target = e.target
      if (target instanceof Node && dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, { capture: true })
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updatePosition])

  // 외부 클릭/Esc 처리 (드롭다운 포털 포함)
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (wrapperRef.current?.contains(t) || dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = useMemo(() => options.find(o => o.value === value), [options, value])
  const displayLabel = selected?.label ?? placeholder ?? ''
  const isPlaceholder = !selected

  const padding = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full bg-ive-bg-input border border-ive-border rounded-lg ${padding} text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate flex items-center gap-1.5 ${isPlaceholder ? 'text-ive-text-dim' : 'text-ive-text'}`}>
          {selected?.icon && <i className={`${selected.icon} ${selected.iconClass ?? ''} shrink-0`} />}
          {selected?.avatar && <AgentAvatar avatar={selected.avatar} userId={selected.avatarUserId} size="xs" />}
          <span className="truncate">{displayLabel}</span>
        </span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-xs text-ive-text-dim ml-2 shrink-0`} />
      </button>

      {/* 드롭다운: Portal로 document.body에 렌더링 — overflow:hidden 컨테이너에 클리핑되지 않음 */}
      {open && mounted && createPortal(
        <div
          ref={dropdownRef}
          className="overflow-y-auto overscroll-contain border border-ive-border-subtle rounded-lg [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ive-text-dim/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ive-text-dim/50"
          style={{ ...dropdownStyle, backgroundColor: '#1c1c20' }}
        >
          {options.map(o => {
            const isSel = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full ${padding} text-left hover:bg-white/[0.05] flex items-center gap-2 ${
                  isSel ? 'text-ive-green font-bold' : 'text-ive-text'
                }`}
              >
                <i className={`fa-solid fa-check text-xs shrink-0 ${isSel ? '' : 'invisible'}`} />
                {o.icon && <i className={`${o.icon} ${o.iconClass ?? ''} shrink-0 w-4 text-center`} />}
                {o.avatar && <AgentAvatar avatar={o.avatar} userId={o.avatarUserId} size="xs" />}
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-[11px] text-ive-text-dim shrink-0">{o.hint}</span>}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
