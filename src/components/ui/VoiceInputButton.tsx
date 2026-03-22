'use client'

import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'

interface VoiceInputButtonProps {
  onResult: (text: string) => void
  className?: string
}

export default function VoiceInputButton({ onResult, className = '' }: VoiceInputButtonProps) {
  const { isListening, isSupported, toggle } = useSpeechRecognition({
    lang: 'ko-KR',
    continuous: true,
    onResult,
  })

  if (!isSupported) return null

  return (
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
  )
}
