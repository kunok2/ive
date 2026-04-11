'use client'

import { useState, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface IntroSlidesProps {
  onComplete: () => void
}

export default function IntroSlides({ onComplete }: IntroSlidesProps) {
  const t = useTranslations('intro')
  const tc = useTranslations('common')
  const [current, setCurrent] = useState(0)
  const touchStartX = useRef(0)
  const touchDeltaX = useRef(0)

  const slides = [
    {
      icon: 'fa-solid fa-hand-wave',
      iconColor: 'text-ive-amber',
      title: t('welcomeTitle'),
      description: t('welcomeDesc'),
    },
    {
      icon: 'fa-solid fa-folder-plus',
      iconColor: 'text-ive-green',
      title: t('projectRegTitle'),
      description: t('projectRegDesc'),
    },
    {
      icon: 'fa-solid fa-robot',
      iconColor: 'text-ive-cyan',
      title: t('agentRegTitle'),
      description: t('agentRegDesc'),
    },
    {
      icon: 'fa-solid fa-list-check',
      iconColor: 'text-ive-cyan',
      title: t('taskRegTitle'),
      description: t('taskRegDesc'),
    },
    {
      icon: 'fa-solid fa-wand-magic-sparkles',
      iconColor: 'text-ive-amber',
      title: t('aiResolveTitle'),
      description: t('aiResolveDesc'),
    },
    {
      icon: 'fa-solid fa-clipboard-check',
      iconColor: 'text-ive-green-light',
      title: t('reviewTitle'),
      description: t('reviewDesc'),
    },
  ]

  const goNext = useCallback(() => {
    if (current < slides.length - 1) setCurrent(c => c + 1)
    else onComplete()
  }, [current, onComplete, slides.length])

  const goPrev = useCallback(() => {
    if (current > 0) setCurrent(c => c - 1)
  }, [current])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') goNext()
    else if (e.key === 'ArrowLeft') goPrev()
    else if (e.key === 'Escape') onComplete()
  }, [goNext, goPrev, onComplete])

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
  }

  const handleTouchEnd = () => {
    if (touchDeltaX.current < -50) goNext()
    else if (touchDeltaX.current > 50) goPrev()
  }

  const slide = slides[current]
  const isLast = current === slides.length - 1

  return (
    <div
      className="fixed inset-0 z-50 bg-ive-bg-deep flex flex-col items-center justify-center px-6"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
    >
      {/* 건너뛰기 */}
      <button
        onClick={onComplete}
        className="absolute top-5 right-5 text-sm text-ive-text-muted hover:text-ive-text transition-colors"
      >
        {tc('skip')} <i className="fa-solid fa-forward ml-1" />
      </button>

      {/* 슬라이드 콘텐츠 */}
      <div className="flex flex-col items-center text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-ive-bg-card border border-ive-border-subtle flex items-center justify-center mb-6">
          <i className={`${slide.icon} ${slide.iconColor} text-3xl`} />
        </div>
        <h2 className="text-xl font-bold text-ive-text mb-3">{slide.title}</h2>
        <p className="text-base text-ive-text-secondary whitespace-pre-line leading-relaxed">
          {slide.description}
        </p>
      </div>

      {/* 하단 영역 */}
      <div className="absolute bottom-12 w-full flex flex-col items-center gap-6 px-6">
        {/* 인디케이터 */}
        <div className="flex gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === current ? 'bg-ive-green w-6' : 'bg-ive-border'
              }`}
            />
          ))}
        </div>

        {/* 네비게이션 버튼 */}
        <div className="flex gap-3 w-full max-w-sm">
          {current > 0 && (
            <button
              onClick={goPrev}
              className="flex-1 py-3 rounded-lg text-base font-bold border border-ive-border text-ive-text-muted hover:bg-ive-bg-card transition-colors"
            >
              <i className="fa-solid fa-chevron-left mr-1.5" />{tc('previous')}
            </button>
          )}
          <button
            onClick={goNext}
            className="flex-1 py-3 rounded-lg text-base font-bold text-white transition-colors bg-ive-green-dark active:bg-ive-green/80"
          >
            {isLast ? (
              <><i className="fa-solid fa-right-to-bracket mr-1.5" />{tc('getStarted')}</>
            ) : (
              <>{tc('next')} <i className="fa-solid fa-chevron-right ml-1.5" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
