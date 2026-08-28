// CLI 도구 브랜드 로고 (각 제품 공식 파비콘/로고 → public/cli/).
// codex(OpenAI) 로고는 단색 검정이라 다크 UI에서 invert로 흰색 처리한다.
const CLI_LOGOS: Record<string, { src: string; invert?: boolean }> = {
  claude: { src: '/cli/claude.svg' },
  agy: { src: '/cli/agy.png' },
  gemini: { src: '/cli/gemini.png' }, // 레거시(과거 실행 이력 표시용)
  codex: { src: '/cli/codex.png', invert: true },
  opencode: { src: '/cli/opencode.svg' },
}

/** 브랜드 로고가 등록된 CLI 이름 목록 (아바타 등에서 유효성 가드용) */
export const CLI_LOGO_NAMES = Object.keys(CLI_LOGOS)

interface Props {
  cli: string
  /** 크기/여백 등 Tailwind 클래스 (기본 w-4 h-4) */
  className?: string
}

/** CLI 이름에 해당하는 브랜드 로고를 <img>로 렌더. 미등록 CLI면 아무것도 렌더하지 않음. */
export default function CliLogo({ cli, className = 'w-4 h-4' }: Props) {
  const logo = CLI_LOGOS[cli]
  if (!logo) return null
  return (
    <img
      src={logo.src}
      alt=""
      aria-hidden
      draggable={false}
      className={`inline-block object-contain align-[-0.125em] ${logo.invert ? 'invert' : ''} ${className}`}
    />
  )
}
