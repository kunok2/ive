/**
 * CLI stderr 노이즈 필터 + 사용량 한도(rate limit/quota) 감지.
 *
 * 각 CLI는 정상 실행 중에도 stderr로 양성(benign) 배너를 찍는다. IVE는 stderr를
 * 그대로 'warn' 로그로 표시하므로, 거르지 않으면 실행 상세보기가 경고로 도배되어
 * 실제 출력이 묻힌다(#463: "출력은 안 나오고 경고만 나온다"). 진짜 오류(인증 실패,
 * 한도 초과 등)는 통과시켜야 하므로 알려진 줄만 제거한다.
 */

// ──────────────── opencode 양성 stderr ────────────────
// opencode는 자기 내부 DB를 처음 만들 때 "Performing one time database migration..."
// 류 배너를 stderr에 찍는다. IVE DB와 무관하며 이를 끄는 플래그가 없다(실측).
const OPENCODE_BENIGN_STDERR: RegExp[] = [
  /performing one time database migration/i,
  /^sqlite-migration:/i,
  /database migration complete/i,
  /service=db\b.*\b(opening database|applying migrations)/i,
];

// ──────────────── gemini 양성 stderr ────────────────
// gemini는 매 실행마다 아래 배너를 stderr로 찍는다(--yolo/--skip-trust 사용 시 더 많음).
// 모두 무해하며 끄는 플래그가 없어 IVE 쪽에서 거른다.
//   "Warning: 256-color support not detected..."
//   "YOLO mode is enabled. All tool calls will be automatically approved."  (2회 반복)
//   "Ripgrep is not available. Falling back to GrepTool."
const AGY_BENIGN_STDERR: RegExp[] = [
  /256-color support not detected/i,
  /yolo mode is enabled/i,
  /all tool calls will be automatically approved/i,
  /ripgrep is not available/i,
  /falling back to greptool/i,
  /loaded cached credentials/i,
];

function stripBenignLines(raw: string, patterns: RegExp[]): string {
  return raw
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true; // 빈 줄은 join 후 정리됨
      return !patterns.some((re) => re.test(t));
    })
    .join('\n');
}

export function stripBenignOpencodeStderr(raw: string): string {
  return stripBenignLines(raw, OPENCODE_BENIGN_STDERR);
}

export function stripBenignAgyStderr(raw: string): string {
  return stripBenignLines(raw, AGY_BENIGN_STDERR);
}

// ──────────────── 사용량 한도(rate limit / quota) 감지 ────────────────
// CLI마다 한도 초과를 알리는 문구가 다르다. 공통 패턴으로 분류해 실패 시
// 사용자에게 "한도 초과로 추정"을 명시한다(#463 후속). 라이브러리/모델별 표현:
//   Anthropic(claude) : rate_limit_error, "usage limit reached", 429, overloaded(529)
//   OpenAI(codex)     : 429, "Too Many Requests", insufficient_quota, rate limit
//   Google(agy)       : RESOURCE_EXHAUSTED, "exhausted your capacity", quota
//   opencode          : provider 따라 위 표현이 그대로 전달됨
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate[\s_-]?limit/i,
  /\b429\b/,
  /\b529\b/,
  /too many requests/i,
  /overloaded/i,
  /quota/i,
  /resource[\s_-]?(?:has been )?exhausted/i,
  /exhausted your capacity/i,
  /usage limit reached/i,
  /insufficient[_\s-]?quota/i,
];

/**
 * 텍스트에서 한도 초과로 보이는 첫 줄을 찾아 돌려준다(없으면 null).
 * 여러 줄이면 매칭된 줄만 추려 가장 정보가 있는 한 줄을 반환한다.
 */
export function detectRateLimit(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (RATE_LIMIT_PATTERNS.some((re) => re.test(line))) {
      return line.length > 300 ? `${line.slice(0, 300)}…` : line;
    }
  }
  return null;
}
