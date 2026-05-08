'use client'

/**
 * Next.js App Router 의 page-level error boundary.
 * 어떤 페이지든 unhandled exception 이 나도 화면이 빈 페이지가 되지 않게,
 * 친절한 메시지 + 재시도 버튼을 노출한다.
 *
 * 회귀 방지 사고 (운영 2026-05-07~05-08):
 *   resolvedAt='REPLACE_END' 같은 dirty data 한 건이 클라이언트 렌더에서
 *   throw → 페이지 전체 빈 화면. 사용자는 무엇이 잘못됐는지 모르고 다시 접속만 시도.
 */
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 운영 모니터링 도입 시 외부 보고. 지금은 콘솔만.
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-ive-bg p-4">
      <div className="max-w-md w-full bg-ive-bg-card border border-ive-border-subtle rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <i className="fa-solid fa-triangle-exclamation text-ive-amber text-2xl" />
          <h1 className="text-lg font-bold text-ive-text">페이지 표시 중 오류</h1>
        </div>
        <p className="text-sm text-ive-text-dim leading-relaxed">
          이 페이지를 그리다가 예상치 못한 문제가 발생했습니다. 잠시 후 다시 시도하거나, 계속 발생하면 관리자에게 문의해주세요.
        </p>
        {error.message && (
          <details className="text-xs text-ive-text-dim bg-ive-bg-deep rounded-lg p-3">
            <summary className="cursor-pointer">세부 오류</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all">{error.message}</pre>
            {error.digest && <div className="mt-1 opacity-60">digest: {error.digest}</div>}
          </details>
        )}
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 bg-ive-cyan/20 hover:bg-ive-cyan/30 text-ive-cyan font-bold rounded-lg px-4 py-2 text-sm"
          >
            다시 시도
          </button>
          <button
            onClick={() => { window.location.href = '/' }}
            className="flex-1 bg-ive-bg-deep hover:bg-ive-bg text-ive-text-dim rounded-lg px-4 py-2 text-sm"
          >
            홈으로
          </button>
        </div>
      </div>
    </div>
  )
}
