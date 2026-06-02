import type { ReportData, DiagnosisResult, I18nMessage } from '@/lib/report-diagnosis'
import type { ResolvedCurrency } from '@/lib/currency'

export type ReportType = 'weekly' | 'monthly' | 'yearly'

// Shared utility functions passed from orchestrator
export interface ReportHelpers {
  fmtCost: (n: number) => string   // USD 금액을 표시 통화로 환산 + 통화기호 포함 포맷
  cur: ResolvedCurrency            // 적용 중인 표시 통화/환율 (배지·직접 포맷용)
  fmtDur: (min: number) => string
  diffBadge: (cur: number, prev: number) => string | null
  diffColor: (cur: number, prev: number, invert?: boolean) => string
  resolveMsg: (msg: I18nMessage) => string
}

export type { ReportData, DiagnosisResult, I18nMessage }
