'use client'

import { useState, useCallback, useRef } from 'react'

const slides = [
  {
    icon: 'fa-solid fa-hand-wave',
    iconColor: 'text-ive-amber',
    title: 'Spring IVE에 오신 것을 환영합니다',
    description: 'AI 기반 통합 개발 환경으로\n프로젝트를 더 스마트하게 관리하세요.',
  },
  {
    icon: 'fa-solid fa-folder-plus',
    iconColor: 'text-ive-green',
    title: '프로젝트 등록',
    description: 'GitLab/GitHub 저장소를 연결하고\n이슈와 MR을 자동으로 추적합니다.',
  },
  {
    icon: 'fa-solid fa-robot',
    iconColor: 'text-ive-cyan',
    title: '개발자(에이전트) 등록',
    description: 'AI 에이전트를 등록하면\n이슈를 자동으로 분석하고 해결합니다.',
  },
  {
    icon: 'fa-solid fa-list-check',
    iconColor: 'text-ive-lime',
    title: '작업 등록 & 자동 유입',
    description: '이슈가 등록되면 자동으로 작업 큐에 추가되고\nAI 에이전트가 순서대로 처리합니다.',
  },
  {
    icon: 'fa-solid fa-wand-magic-sparkles',
    iconColor: 'text-purple-400',
    title: 'AI 자동 해결',
    description: 'AI가 코드를 분석하고 수정하여\nMerge Request를 자동으로 생성합니다.',
  },
  {
    icon: 'fa-solid fa-clipboard-check',
    iconColor: 'text-ive-green-light',
    title: '검수 & 보고서',
    description: '실행 결과를 실시간으로 모니터링하고\n상세 보고서를 확인하세요.',
  },
]

interface IntroSlidesProps {
  onComplete: () => void
}

export default function IntroSlides({ onComplete }: IntroSlidesProps) {
  const [current, setCurrent] = useState(0)
  const touchStartX = useRef(0)
  const touchDeltaX = useRef(0)

  const goNext = useCallback(() => {
    if (current < slides.length - 1) setCurrent(c => c + 1)
    else onComplete()
  }, [current, onComplete])

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
        건너뛰기 <i className="fa-solid fa-forward ml-1" />
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
              className="flex-1 py-3 rounded-lg text-base font-semibold border border-ive-border text-ive-text-muted hover:bg-ive-bg-card transition-colors"
            >
              <i className="fa-solid fa-chevron-left mr-1.5" />이전
            </button>
          )}
          <button
            onClick={goNext}
            className="flex-1 py-3 rounded-lg text-base font-bold text-white transition-colors bg-ive-green-dark active:bg-ive-green/80"
          >
            {isLast ? (
              <><i className="fa-solid fa-right-to-bracket mr-1.5" />시작하기</>
            ) : (
              <>다음 <i className="fa-solid fa-chevron-right ml-1.5" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
