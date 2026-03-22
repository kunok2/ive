'use client'

import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'

interface VoiceInputButtonProps {
  onResult: (text: string) => void
  className?: string
}

export default function VoiceInputButton({ onResult, className = '' }: VoiceInputButtonProps) {
  const { isListening, isSupported, errorMessage, toggle } = useSpeechRecognition({
    lang: 'ko-KR',
    continuous: true,
    onResult,
  })

  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-ive-bg-card border border-ive-border text-ive-text-dim opacity-30 cursor-not-allowed ${className}`}
        title="이 브라우저에서는 음성 입력을 지원하지 않습니다"
        aria-label="음성 입력 미지원"
      >
        <i className="fa-solid fa-microphone-slash" />
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${
          isListening
            ? 'bg-ive-red/20 text-ive-red animate-pulse border border-ive-red/40'
            : 'bg-ive-bg-card border border-ive-border text-ive-text-dim hover:text-ive-green hover:border-ive-green/30'
        } ${className}`}
        title={isListening ? '음성 입력 중지' : '음성으로 입력'}
        aria-label={isListening ? '음성 입력 중지' : '음성으로 입력'}
      >
        <i className={`fa-solid ${isListening ? 'fa-stop' : 'fa-microphone'}`} />
      </button>
      {errorMessage && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-ive-red/90 text-white text-[10px] rounded-md whitespace-nowrap z-50">
          {errorMessage}
        </div>
      )}
    </div>
  )
}
