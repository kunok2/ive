import Database from 'better-sqlite3'
import path from 'path'
import { startScanner } from '../scanner'
import { initSchema } from './schema'
import { initLoggerFromDb } from '../logger'

declare global {
  var db: Database.Database | undefined;
  // server.ts 가 요청을 받기 전에 잡아 둔 루트 실행 컨텍스트에서 fn 을 실행한다 (없으면 그냥 실행)
  var __iveRunInRootContext: (<R>(fn: () => R) => R) | undefined;
}

export function getDb() {
  if (!global.db) {
    const dbPath = path.join(process.cwd(), 'data', 'springware-ive.db')
    const db = new Database(dbPath)

    // ── 동시성 튜닝 ──────────────────────────────────────────────────────────
    // WAL: 기본 rollback journal(delete) 은 쓰기 1건이 DB 전체에 배타 락을 걸어
    //   그동안 "모든 읽기"가 막힌다. 대시보드는 폴링(2~10초)으로 읽기가 압도적인데
    //   스캐너·통계 스냅샷(1분)·사용자 액션이 계속 쓰므로, 동접이 늘수록 읽기가
    //   쓰기 뒤에 줄서서 지연이 급증한다. WAL 은 읽기와 쓰기가 서로를 막지 않는다.
    //   (journal_mode 는 DB 파일에 저장되는 영속 속성이라 한 번 바뀌면 유지된다.)
    db.pragma('journal_mode = WAL')
    // busy_timeout: 기본값 0 → 쓰기가 겹치는 순간 즉시 SQLITE_BUSY 예외.
    //   락이 풀릴 때까지 최대 5초 재시도하게 해 동시 쓰기에서 요청이 실패하지 않게 한다.
    db.pragma('busy_timeout = 5000')
    // synchronous: WAL 에서는 NORMAL 이 표준 권장값. 매 커밋 fsync 를 없애고
    //   체크포인트 시점에만 동기화한다(프로세스 크래시엔 안전, OS 크래시 시 마지막
    //   몇 커밋 유실 가능 — 대시보드 통계 성격상 수용 가능한 트레이드오프).
    db.pragma('synchronous = NORMAL')
    // 페이지 캐시 2MB(기본) → 64MB. 운영 DB 가 88MB 라 사실상 대부분을 메모리에 얹는다.
    db.pragma('cache_size = -64000')
    db.pragma('temp_store = MEMORY')
    // 읽기를 mmap 으로 처리해 read() 시스템콜과 버퍼 복사를 줄인다.
    db.pragma('mmap_size = 268435456') // 256MB
    // ─────────────────────────────────────────────────────────────────────────

    db.pragma('foreign_keys = ON')
    initSchema(db)
    global.db = db

    // Logger needs the DB to read settings, so init it right after schema.
    initLoggerFromDb()

    // 백그라운드 작업(스캐너 + 통계 수집 + 리포트 스케줄러)은 프로세스당 1벌씩 뜬다.
    // 웹 서버를 여러 워커로 띄우는 경우(WEB_CONCURRENCY) 워커마다 스캐너가 돌면
    // 같은 이슈를 여러 번 집어 에이전트를 중복 실행한다(토큰 소진 사고). 그래서
    // 워커 0 을 제외한 워커는 IVE_BACKGROUND_JOBS=0 을 받아 여기서 걸러진다.
    //
    // 첫 getDb() 는 페이지 렌더링 도중일 수 있다. 그 컨텍스트를 타이머가 물려받으면 Next/React 의
    // 요청 단위 fetch 메모이즈가 스캐너에 영구 적용돼 Git 조회가 첫 응답에 고정된다.
    // 그래서 반드시 요청과 무관한 루트 컨텍스트에서 시작한다 (server.ts 참고).
    if (process.env.NODE_ENV !== 'test' && process.env.IVE_BACKGROUND_JOBS !== '0') {
      const runInRoot = global.__iveRunInRootContext ?? (<R>(fn: () => R) => fn());
      runInRoot(() => startScanner());
    }
  }
  return global.db
}
