'use client'

/**
 * 한 컴포넌트의 렌더 에러가 트리 전체를 죽이는 것을 막는 경계.
 *
 * 회귀 방지 사고 (운영 2026-05-07~05-08):
 *   resolvedAt='REPLACE_END' 같은 dirty row 한 건이 utcISOToKSTDateTime 에서
 *   RangeError 를 throw → React 가 트리 unmount → 보고서 페이지 전체 다운.
 *
 * 정책: 한 영역의 렌더 실패는 그 영역만 fallback UI 로 대체. 다른 영역은 정상 표시.
 */
import React from 'react'

interface Props {
  /** fallback UI. (error, reset) 을 받는다. 기본은 작은 빨간 배지. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
  /** 어떤 컴포넌트/영역인지 식별용 라벨 (콘솔/메시지에 노출) */
  label?: string
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 운영 모니터링 환경 도입 시 여기서 외부로 보고. 지금은 콘솔만.
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div className="text-xs text-ive-red bg-ive-red/10 border border-ive-red/30 rounded-lg px-3 py-2">
          <div className="font-bold">표시 중 오류 발생{this.props.label ? ` — ${this.props.label}` : ''}</div>
          <div className="opacity-70 mt-0.5">{this.state.error.message || String(this.state.error)}</div>
          <button onClick={this.reset} className="mt-1 underline">다시 시도</button>
        </div>
      )
    }
    return this.props.children
  }
}
