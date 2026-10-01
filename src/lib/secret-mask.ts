/**
 * 로그·코멘트·에러 메시지에 섞일 수 있는 비밀값 마스킹 (clone URL 의 토큰, gh/glab 토큰, 알려진 비밀값).
 * 단계 작업자(처리·확인 등)의 CLI 로그와 이슈 코멘트, 채팅 에이전트가 같은 규칙을 쓴다.
 */
export function maskSecrets(s: string, knownSecrets: string[] = []): string {
  let out = (s || '')
    .replace(/(x-access-token|oauth2):[^@\s]+@/gi, '$1:***@')
    .replace(/(https?:\/\/)[^/@\s:]+:[^@\s/]+@/gi, '$1***:***@')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, 'gh***')
    .replace(/\b(glpat-[A-Za-z0-9_-]{10,})\b/g, 'glpat-***')
    .replace(/\b(gloas-[A-Za-z0-9_-]{10,})\b/g, 'gloas-***')
  // 알려진 비밀값(프로젝트 토큰·staging 테스트 계정 비밀번호 등)은 그대로 치환. 3자 이하는 일반 글자와 겹쳐 건너뛴다.
  for (const secret of [...knownSecrets].sort((a, b) => (b?.length || 0) - (a?.length || 0))) {
    if (!secret || secret.length < 4) continue
    out = out.split(secret).join('***')
  }
  return out
}
