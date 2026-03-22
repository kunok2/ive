'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSpeechRecognitionOptions {
  lang?: string
  continuous?: boolean
  onResult?: (transcript: string) => void
}

interface UseSpeechRecognitionReturn {
  isListening: boolean
  isSupported: boolean
  toggle: () => void
  stop: () => void
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const { lang = 'ko-KR', continuous = true, onResult } = options
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const onResultRef = useRef(onResult)

  onResultRef.current = onResult

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setIsSupported(!!SpeechRecognition)
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
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
        setIsListening(false)
      } else if (event.error === 'no-speech') {
        // 무시 — 사용자가 아직 말하지 않은 상태
      } else {
        setIsListening(false)
      }
    }

    recognition.onend = () => {
      // continuous 모드에서 자동 재시작
      if (recognitionRef.current && isListeningRef.current) {
        try { recognition.start() } catch { /* already started */ }
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition

    return () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try { recognition.stop() } catch { /* noop */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, continuous])

  const isListeningRef = useRef(isListening)
  isListeningRef.current = isListening

  const stop = useCallback(() => {
    isListeningRef.current = false
    setIsListening(false)
    try { recognitionRef.current?.stop() } catch { /* noop */ }
  }, [])

  const toggle = useCallback(() => {
    if (!recognitionRef.current) return

    if (isListeningRef.current) {
      stop()
    } else {
      isListeningRef.current = true
      setIsListening(true)
      try { recognitionRef.current.start() } catch { /* noop */ }
    }
  }, [stop])

  return { isListening, isSupported, toggle, stop }
}
