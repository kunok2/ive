// 클라이언트/서버 공용 상수 (서버 전용 모듈을 import 하지 않음)

/**
 * 시드로 생성되는 기본 관리자 계정 이메일.
 * 받을 수 없는 자리표시자 주소이므로 메일 인증(코드 발송) 흐름에서 제외한다.
 */
export const DEFAULT_ADMIN_EMAIL = 'admin@ive.local'
