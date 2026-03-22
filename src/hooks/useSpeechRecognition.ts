'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSpeechRecognitionOptions {
  lang?: string
  continuous?: boolean
  onResult?: (transcript: string) => void
  onError?: (error: string) => void
}

interface UseSpeechRecognitionReturn {
  isListening: boolean
  isSupported: boolean
  errorMessage: string
  toggle: () => void
  stop: () => void
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const { lang = 'ko-KR', continuous = true, onResult, onError } = options
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)
  const isListeningRef = useRef(false)

  onResultRef.current = onResult
  onErrorRef.current = onError

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    setIsSupported(!!SR)
    if (!SR) return

    const recognition = new SR()
    recognition.lang = lang
    recognition.continuous = continuous
    recognition.interimResults = false

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript
        }
      }
      if (transcript && onResultRef.current) {
        onResultRef.current(transcript)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        setErrorMessage('마이크 권한이 필요합니다')
        onErrorRef.current?.('마이크 권한이 필요합니다')
        isListeningRef.current = false
        setIsListening(false)
      } else if (event.error === 'no-speech') {
        // 무시 — 사용자가 아직 말하지 않은 상태
      } else if (event.error === 'aborted') {
        isListeningRef.current = false
        setIsListening(false)
      } else {
        setErrorMessage('음성 인식 오류가 발생했습니다')
        onErrorRef.current?.('음성 인식 오류가 발생했습니다')
        isListeningRef.current = false
        setIsListening(false)
      }
    }

    recognition.onend = () => {
      if (recognitionRef.current && isListeningRef.current) {
        // continuous 모드에서 자동 재시작
        try { recognition.start() } catch { /* already started */ }
      } else {
        isListeningRef.current = false
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition

    return () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      isListeningRef.current = false
      try { recognition.stop() } catch { /* noop */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, continuous])

  const stop = useCallback(() => {
    isListeningRef.current = false
    setIsListening(false)
    try { recognitionRef.current?.stop() } catch { /* noop */ }
  }, [])

  const toggle = useCallback(() => {
    if (!recognitionRef.current) return
    setErrorMessage('')

    if (isListeningRef.current) {
      stop()
    } else {
      isListeningRef.current = true
      setIsListening(true)
      try { recognitionRef.current.start() } catch { /* noop */ }
    }
  }, [stop])

  return { isListening, isSupported, errorMessage, toggle, stop }
}
