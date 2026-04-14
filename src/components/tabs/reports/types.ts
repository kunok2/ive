import type { ReportData, DiagnosisResult, I18nMessage } from '@/lib/report-diagnosis'

export type ReportType = 'weekly' | 'monthly' | 'yearly'

// Shared utility functions passed from orchestrator
export interface ReportHelpers {
  fmtCost: (n: number) => string
  fmtDur: (min: number) => string
  diffBadge: (cur: number, prev: number) => string | null
  diffColor: (cur: number, prev: number, invert?: boolean) => string
  resolveMsg: (msg: I18nMessage) => string
}

export type { ReportData, DiagnosisResult, I18nMessage }
