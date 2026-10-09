'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

/** 새 판 말풍선이 처음 나타난 뒤 스스로 접히기까지 — 그 뒤로는 올려 두거나 초점이 갈 때만 */
const AUTO_HIDE_MS = 10_000

/**
 * 우측 툴바의 새 판 알림 — 이 탭이 옛 번들을 돌고 있을 때만 그린다. 누르면 페이지를 다시 연다.
 * 눈에 띄게: 아이콘이 몇 초마다 한 바퀴 돌고 빨간 점이 퍼진다(움직임 줄이기 설정이면 멈춤 — globals.css).
 * 나타나는 순간 아래에 말풍선(새 판 번호 + 눌러서 새로고침)을 잠시 띄운다 — 폰은 올려 둘 수 없어 title 로는 못 본다.
 * 말풍선도 버튼 안에 있어 눌러도 새로고침된다.
 */
export default function AppUpdateButton({ latestVersion, onReload }: { latestVersion: string | null; onReload: () => void }) {
  const tc = useTranslations('common')
  const [auto, setAuto] = useState(true)
  const [hover, setHover] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAuto(false), AUTO_HIDE_MS)
    return () => clearTimeout(t)
  }, [])
  const label = tc('appUpdate.title')
  const open = auto || hover
  // 판 번호는 릴리스 때만 오르고 배포는 커밋마다 — 번호가 그대로면(같은 판의 새 배포) 번호 없이 「새 업데이트」로
  const newer = latestVersion && latestVersion !== process.env.APP_VERSION ? latestVersion : null

  return (
    <button
      onClick={onReload}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="relative w-8 h-8 rounded-lg bg-ive-green/20 border border-ive-green/40 flex items-center justify-center text-ive-green hover:bg-ive-green/30 active:scale-95 transition-all"
      aria-label={newer ? `${label} (v${newer})` : label}
    >
      <i className="fa-solid fa-arrows-rotate text-sm animate-update-nudge" />
      <span className="absolute -top-1 -right-1 w-2.5 h-2.5">
        <span className="absolute inset-0 rounded-full bg-ive-red animate-ping motion-reduce:animate-none" />
        <span className="absolute inset-0 rounded-full bg-ive-red" />
      </span>
      {open && (
        <span role="tooltip" className="absolute top-full right-0 mt-2.5 z-50 animate-update-tip text-left whitespace-nowrap px-3 py-2 rounded-lg bg-ive-bg-deep border border-ive-green/40">
          {/* 꼬리 — 버튼 가운데를 가리킨다 */}
          <span className="absolute -top-[5px] right-3 w-2.5 h-2.5 rotate-45 bg-ive-bg-deep border-l border-t border-ive-green/40" />
          <span className="block text-sm font-bold text-ive-green">
            {newer ? tc('appUpdate.tipTitleVersion', { version: newer }) : tc('appUpdate.tipTitle')}
          </span>
          <span className="block text-xs font-bold text-ive-text-secondary mt-0.5">{tc('appUpdate.tipHint')}</span>
        </span>
      )}
    </button>
  )
}
