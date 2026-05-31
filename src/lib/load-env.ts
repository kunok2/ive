// .env* 파일을 Next.js와 동일한 규칙으로 로드한다.
// 커스텀 서버(server.ts)는 `tsx server.ts`로 실행돼 Next의 자동 env 로딩을 거치지 않으므로,
// 이 모듈을 server.ts의 "첫 import"로 두어 다른 모듈이 평가되기 전에 process.env를 채운다.
// (이미 process.env에 있는 값은 덮어쓰지 않으므로 운영의 주입 env와도 안전하다.)
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

export {}
