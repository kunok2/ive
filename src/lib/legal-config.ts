import { getSystemSettings } from '@/lib/db'

// 약관·개인정보처리방침 문서/화면에 주입되는 운영주체 정보 + 표시 여부.
// 문서 본문(조항)은 i18n(messages/*/legal.json)에 두고, 회사별 값만 아래 설정으로 주입한다.
// 사내 전용 설치처럼 외부 가입이 없는 경우 enabled=false 로 로그인/회원가입 화면의 동의 문구·링크를 숨긴다.
export type LegalConfig = {
  enabled: boolean
  companyName: string
  companyAddress: string
  officerName: string
  officerEmail: string
  serviceUrl: string
  effectiveDate: string
}

// 설정이 비어 있을 때의 기본값(현재 운영주체). 관리자가 설정에서 덮어쓴다.
export const LEGAL_DEFAULTS: Omit<LegalConfig, 'enabled'> = {
  companyName: '(주) 스프링웨어',
  companyAddress: '서울특별시 관악구 남부순환로247 나길 35, 301호',
  officerName: '개인정보 보호책임자',
  officerEmail: 'privacy@dazzleat.link',
  serviceUrl: 'https://ive.springware.kr',
  effectiveDate: '2026-06-05',
}

export function getLegalConfig(): LegalConfig {
  let s: Record<string, string> = {}
  try { s = getSystemSettings('legal.') } catch { /* DB not ready */ }
  const v = (k: string, d: string) => {
    const x = s['legal.' + k]
    return x && x.trim() ? x.trim() : d
  }
  return {
    // 기본값은 표시(true). 명시적으로 'false'일 때만 숨김.
    enabled: (s['legal.enabled'] ?? 'true') !== 'false',
    companyName: v('company_name', LEGAL_DEFAULTS.companyName),
    companyAddress: v('company_address', LEGAL_DEFAULTS.companyAddress),
    officerName: v('officer_name', LEGAL_DEFAULTS.officerName),
    officerEmail: v('officer_email', LEGAL_DEFAULTS.officerEmail),
    serviceUrl: v('service_url', LEGAL_DEFAULTS.serviceUrl),
    effectiveDate: v('effective_date', LEGAL_DEFAULTS.effectiveDate),
  }
}
