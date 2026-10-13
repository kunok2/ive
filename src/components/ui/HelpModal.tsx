'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useTab } from '@/lib/tab-context'

interface HelpModalProps {
  open: boolean
  onClose: () => void
  onShowIntro: () => void
  onStartTour: (tabKey: string) => void
  /** 「변경 이력」 창 열기 — 도움말 아래 판 표시를 누르면 */
  onShowReleaseNotes: () => void
}

/**
 * 이 도움말 내용이 기준으로 삼은 판 — 도움말을 고쳐 쓸 때 함께 올린다.
 * 지금 판(APP_VERSION)을 그대로 쓰면 도움말이 낡아도 늘 「최신 기준」처럼 보이므로 따로 둔다.
 */
const HELP_BASED_ON = '1.21.0'

/** a 가 b 보다 새 판인가 (x.y.z) */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

// tour: 가이드 투어가 있는 탭만(「넓은 화면」은 탭이 아니라 투어가 없다)
const tabSections = [
  { key: 'projects', icon: 'fa-solid fa-folder', steps: 8, tour: true },
  { key: 'agents', icon: 'fa-solid fa-bolt', steps: 7, tour: true },
  { key: 'issues', icon: 'fa-solid fa-list-check', steps: 9, tour: true },
  { key: 'reports', icon: 'fa-solid fa-chart-line', steps: 6, tour: true },
  { key: 'admin', icon: 'fa-solid fa-gear', steps: 5, tour: true },
  { key: 'layout', icon: 'fa-solid fa-desktop', steps: 4, tour: false },
] as const

// Slack 연동은 특정 탭이 아니라 '내 정보'(워크스페이스 추가·알림)와 '프로젝트 공유'에 걸쳐 있어
// 별도 섹션으로 안내한다. 가이드 투어가 없으므로 흐름별 단계만 보여준다.
const slackFlows = [
  { key: 'slackUser', icon: 'fa-solid fa-user', steps: 6 },
  { key: 'slackShare', icon: 'fa-solid fa-share-nodes', steps: 4 },
  { key: 'slackNotify', icon: 'fa-solid fa-bell', steps: 3 },
] as const

export default function HelpModal({ open, onClose, onShowIntro, onStartTour, onShowReleaseNotes }: HelpModalProps) {
  const t = useTranslations('help')
  const tt = useTranslations('tour')
  const { activeTab } = useTab()
  const [expandedKey, setExpandedKey] = useState('')

  useEffect(() => {
    if (open) setExpandedKey(activeTab || 'projects')
  }, [open, activeTab])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className="relative w-full max-w-md bg-ive-bg-card border border-ive-border rounded-2xl max-h-[85vh] flex flex-col animate-slide-up overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-dark shrink-0">
          <h2 className="text-base font-bold text-ive-text">
            <i className="fa-solid fa-circle-question text-ive-cyan mr-2" />
            {t('title')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ive-text-muted hover:bg-ive-bg-deep transition-colors text-xl"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-2">
            {tabSections.map(({ key, icon, steps, tour }) => {
              const isExpanded = expandedKey === key
              return (
                <div
                  key={key}
                  className={`rounded-lg transition-colors ${
                    isExpanded
                      ? 'bg-ive-cyan/5 border border-ive-cyan/20'
                      : 'bg-ive-bg/50 border border-ive-border-dark'
                  }`}
                >
                  {/* Section header */}
                  <button
                    onClick={() => setExpandedKey(isExpanded ? '' : key)}
                    className="w-full flex items-center justify-between p-3"
                  >
                    <h3 className={`text-sm font-bold ${isExpanded ? 'text-ive-cyan' : 'text-ive-text'}`}>
                      <i className={`${icon} mr-1.5`} />
                      {t(key)}
                    </h3>
                    <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-3 pb-3">
                      {/* Description */}
                      <p className="text-xs font-bold text-ive-text-secondary mb-2.5">
                        {t(`${key}Desc` as keyof IntlMessages['help'])}
                      </p>

                      {/* Steps */}
                      <ol className="flex flex-col gap-2 mb-2.5">
                        {Array.from({ length: steps }, (_, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs font-bold text-ive-text-muted">
                            <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-cyan/15 text-ive-cyan flex items-center justify-center text-xs">
                              {i + 1}
                            </span>
                            <span className="pt-0.5 leading-relaxed">
                              {t(`${key}Step${i + 1}` as keyof IntlMessages['help'])}
                            </span>
                          </li>
                        ))}
                      </ol>

                      {/* Tip */}
                      <div className="flex items-start gap-1.5 text-xs font-bold text-ive-text-dim bg-ive-bg-deep/50 rounded-lg px-2.5 py-2 mb-2.5">
                        <i className="fa-solid fa-lightbulb text-ive-amber shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          {t(`${key}Tip` as keyof IntlMessages['help'])}
                        </span>
                      </div>

                      {/* Start guide tour button */}
                      {tour && (
                        <button
                          onClick={() => onStartTour(key)}
                          className="w-full py-2 rounded-lg text-xs font-bold text-ive-cyan border border-ive-cyan/20 hover:bg-ive-cyan/10 transition-colors"
                        >
                          <i className="fa-solid fa-route mr-1.5" />
                          {tt('startGuide')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Slack 연동 (탭 아님 — 흐름별 안내, 투어 없음) */}
            {(() => {
              const isExpanded = expandedKey === 'slack'
              return (
                <div
                  className={`rounded-lg transition-colors ${
                    isExpanded
                      ? 'bg-ive-cyan/5 border border-ive-cyan/20'
                      : 'bg-ive-bg/50 border border-ive-border-dark'
                  }`}
                >
                  <button
                    onClick={() => setExpandedKey(isExpanded ? '' : 'slack')}
                    className="w-full flex items-center justify-between p-3"
                  >
                    <h3 className={`text-sm font-bold ${isExpanded ? 'text-ive-cyan' : 'text-ive-text'}`}>
                      <i className="fa-brands fa-slack mr-1.5" />
                      {t('slack')}
                    </h3>
                    <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3">
                      {/* Description */}
                      <p className="text-xs font-bold text-ive-text-secondary mb-3">
                        {t('slackDesc')}
                      </p>

                      {/* 흐름별 단계 (2가지 시나리오) */}
                      {slackFlows.map(({ key, icon, steps }) => (
                        <div key={key} className="mb-3 last:mb-0">
                          <h4 className="text-xs font-bold text-ive-cyan mb-2 flex items-center gap-1.5">
                            <i className={icon} />
                            {t(`${key}Title` as keyof IntlMessages['help'])}
                          </h4>
                          <ol className="flex flex-col gap-2">
                            {Array.from({ length: steps }, (_, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs font-bold text-ive-text-muted">
                                <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-cyan/15 text-ive-cyan flex items-center justify-center text-xs">
                                  {i + 1}
                                </span>
                                <span className="pt-0.5 leading-relaxed">
                                  {t(`${key}Step${i + 1}` as keyof IntlMessages['help'])}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}

                      {/* Tip */}
                      <div className="flex items-start gap-1.5 text-xs font-bold text-ive-text-dim bg-ive-bg-deep/50 rounded-lg px-2.5 py-2">
                        <i className="fa-solid fa-lightbulb text-ive-amber shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          {t('slackTip')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* 이 도움말의 기준 판 — 지금 판이 더 새로우면 그 사이 변경은 변경 이력에서 */}
            <p className="pt-1 text-center text-xs font-bold text-ive-text-secondary leading-relaxed">
              {t('basedOn', { version: HELP_BASED_ON })}
              {process.env.APP_VERSION && isNewerVersion(process.env.APP_VERSION, HELP_BASED_ON) && (
                <><br />{t('basedOnNewer', { current: process.env.APP_VERSION })}</>
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-ive-border-dark shrink-0">
          <button
            onClick={() => { onClose(); onShowIntro() }}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-ive-cyan border border-ive-cyan/30 hover:bg-ive-cyan/10 transition-colors"
          >
            <i className="fa-solid fa-circle-play mr-1.5" />
            {t('showIntro')}
          </button>
          {/* 판 — package.json version(빌드 때 APP_VERSION). 누르면 판별 변경 이력 */}
          <button
            onClick={() => { onClose(); onShowReleaseNotes() }}
            className="w-full mt-2 py-1.5 rounded-lg text-xs font-bold text-ive-text-secondary hover:text-ive-text hover:bg-white/[0.04] transition-colors"
          >
            IVE v{process.env.APP_VERSION} · {t('releaseNotes')}
          </button>
        </div>
      </div>
    </div>
  )
}
