# Changelog

Springware IVE의 굵직한 변경 이력입니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

> 버전은 `package.json`을 단일 출처로 하며, [next.config.mjs](next.config.mjs)의 `APP_VERSION`을 통해 UI에 표시됩니다.
> 1.5.0 이전 버전은 git 태그가 없던 시기라 커밋 이력을 기반으로 소급 정리한 것으로, 날짜는 주요 변경이 머지된 시점입니다.

## [Unreleased]

### Added
- **검증자/확인자를 "라벨을 실제로 부착한 계정"으로 기록**: CLI 로 라벨을 옮기는 경로에서는 행위자 단서가 이슈 담당자(assignee)뿐이라, 담당자와 실제 검증·확인한 사람이 다르면 엉뚱하게 기록됐다. 이제 라벨 이벤트(GitLab `resource_label_events` / GitHub issue events)에서 **그 단계 라벨을 가장 최근 부착한 사람**을 1순위 행위자로 쓴다(`resolveStageActorAsync`). IVE 자신은 프로젝트 토큰(봇)으로 라벨을 달기 때문에 봇 계정은 건너뛰고, 그 경우(=화면 버튼 경로)는 종전대로 담당자로 떨어진다. 검증/확인 실행 기록의 작업자(user_id)도 같은 기준으로 채운다.
- **에이전트가 CLI 로 진행하는 검증·확인을 IVE 가 제대로 기록한다**: 검증/확인을 에이전트가 맡으면 IVE 화면 버튼이 아니라 `glab`/`gh` 로 라벨을 옮기는데, 그 경로가 세 군데서 새고 있었다. ① **승인이 반려로 기록**됐다 — 스캐너는 `verifying → done` 만 승인으로 봤고, 정상 흐름인 `verifying → 확인대기(IVE-P)` 는 "verifying 에서 벗어남"에 걸려 `rejected_at` 이 찍혔다(화면 버튼 경로는 `verified_at` 이 먼저 박혀 무해했다). 전이→마커 판정을 순수 함수 `markersForStageChange` 로 분리하고 확인대기/확인중/완료를 모두 승인으로 본다. ② **확인 단계가 통째로 미기록**이었다 — 라벨로 `IVE-P→IVE-C→IVE-E` 를 옮겨도 `confirm_started_at`/`confirmed_at` 이 남지 않았다. 이제 스캐너가 확인 시작·완료도 기록하고, 확인자는 git username → IVE 계정 역매핑으로 채운다. ③ **검증/확인 실행 기록(ex-verify-/ex-confirm-)이 화면 버튼으로만 생성**돼, CLI 로 진행한 검증·확인은 작업량도 비용도 0 이었다. 스캐너가 전이에 맞춰 같은 모양의 행을 만들고 닫는다(`src/lib/scanner/stage-records.ts`, 이미 열린 행이 있으면 중복 생성하지 않음).
- **에이전트가 수행한 검증·확인의 토큰·시간 집계 (`ive-meta stage:`)**: `ive-meta` 블록에 `stage: verify | confirm` 필드를 추가했다(없으면 종전대로 `dev` = 툴 직접개발, 하위호환). 에이전트가 검토·확인 **코멘트** 끝에 이 블록을 붙이면 스캐너가 그 단계의 실행 기록에 토큰·비용·구간을 채운다. 그런 행은 **AI 가 수행한 것**으로 계산돼 사람 시간 0 · 비용은 토큰으로 잡힌다(종전엔 라벨이 열려 있던 근무시간이 사람 비용으로 계상되거나, CLI 경로에서는 아예 0 이었다). 이슈 본문의 `dev` 블록만 툴 직접개발 동기화(`syncExternalToolSessions`) 대상이라 이중집계는 없다.
- **AI 도구 가이드에 "검증·확인을 에이전트가 수행할 때" 추가**: 검증(`IVE-V`)/확인(`IVE-C`)은 원래 사람 단계였으나 점점 에이전트가 대신하게 되어, 프로젝트에 설치되는 가이드(`POST /api/projects/:id/ai-guide` → `CLAUDE.md`/`AGENTS.md`)에 에이전트용 절차를 추가했다. **검증** = 브랜치 구현을 검토자 입장에서 객관적으로 보고 **틀린 곳은 직접 고쳐** 목표 브랜치(프로젝트의 `baseBranch`)에 머지 → 개발 브랜치 삭제 → 검토 코멘트 → `IVE-P`. **확인** = **실제 화면을 띄워 보고 그 화면을 캡처해 이슈에 업로드**(GitLab `/uploads` API, GitHub 은 첨부 API 가 없어 기본 브랜치 `.ive-assets/` 커밋 후 raw URL) → 확인 코멘트 → `IVE-E`(완료). 두 단계 모두 **착수 즉시 시작 라벨, 결론 즉시 다음 라벨**(그 라벨이 열려 있던 근무시간이 그대로 사람 비용으로 집계되므로). 이 밖에 자기가 개발한 것을 자기가 통과시키지 않기, 증거(명령·출력) 없는 통과 금지, 확인용 주소(`testSiteUrl`)나 목표 브랜치가 비어 있으면 추측하지 말고 코멘트로 묻고 멈추기, 사람을 불러야 하는 경우 목록을 포함. 라벨을 CLI 로 직접 옮기면 전이 주체가 이슈 담당자(assignee)로 기록된다는 점도 명시.
- **작업 접수를 "화면 붙이기 / API 연동" 두 갈래로**: 프로젝트 화면의 작업 접수 카드가 접수 URL 하나만 주던 것을, 쓰는 방식에 따라 나눴다. ① **화면 붙이기** — 종전대로 접수 페이지 URL(테마·언어를 고르고 복사해 링크·버튼으로 공유). ② **API 연동**(신규) — 다른 서비스의 자체 문의 화면에서 받은 내용을 API 로 보낼 때 필요한 **접수 주소·프로젝트 ID·접수 시크릿**을 각각 복사(시크릿은 가림 + 보기 토글). 종전엔 시크릿이 화면 어디에도 없어 `/api/projects/<id>/report-secret` 을 직접 열어야 했다. URL 에 붙는 토큰은 nonce 1회용 + 7일 만료라 다른 서비스 설정에 저장해 두면 **두 번째 접수부터 403**(`Token already used`)이 되는데, 부르는 쪽이 시크릿으로 접수마다 서명하면 그 제약이 없다 — 그래서 API 연동 칸은 토큰이 붙지 않은 주소를 준다. (첫 사용처: Meta-Shop 서비스 데스크의 IVE 접수 탭)
- **다일(多日) 작업의 날짜·주(週)별 통계 분배 (다세션 ive-meta)**: 한 외부 도구 이슈를 여러 날에 걸쳐 처리한 경우, 종전엔 본문 ive-meta 가 단일 `started_at`/`ended_at` 한 구간만 담아 토큰·비용·작업시간 전부가 **한 칸(첫 작업일)에 뭉쳐** 집계됐다(작성자가 `ended_at = started + 총시간`으로 손수 때우던 한계). 이제 ive-meta 블록을 **작업 세션마다 하나씩** 본문에 쌓으면(`parseIveMetaSessions` 가 모든 `<!-- ive-meta -->` 블록 수집), 스캐너가 **세션마다 execution 행을 멱등 생성/갱신**(`syncExternalToolSessions`)한다. 보고서는 행의 `started_at` 으로 날짜를 가르므로 **주 경계를 넘는 작업이 지난주·이번주 주간보고 양쪽에 각각 그 주에 수행한 만큼** 토큰·비용·작업시간이 분배된다. 세션 매칭 키는 `started_at`(타임리스 세션은 남은 행에 순서 폴백)이라 재스캔해도 신규 세션만 INSERT·변경분만 UPDATE(중복집계 없음), 블록 1개뿐인 기존 본문은 종전과 동일 동작(하위호환). 보고서 집계 쿼리는 이미 행 단위 합산·`issue_iid` dedup 이라 변경 없음. CLAUDE.md 작성 규칙도 "세션마다 ive-meta 블록 append·세션분 `/spend`"로 개정.
- **확인자는 프로젝트 멤버가 아니어도 IVE 사용자면 지정 가능**: 확인자(확인 단계)는 검증자/담당자와 달리 그 프로젝트의 git 멤버일 필요 없이 **IVE 사용자이기만 하면** 된다. 기존엔 확인자 picker(생성 폼·목록 카드·이슈 상세)가 검증자와 같은 "프로젝트 멤버" 목록(`/members`)만 보여줘 비멤버를 지정할 수 없었다. 이제 확인자 picker만 **provider로 식별되는 모든 IVE 사용자**(신규 `/api/projects/[id]/confirmer-candidates`, `getIveConfirmerCandidates`)를 보여준다(검증자/담당자는 그대로 멤버 제한). 비멤버 확인자도 동작하도록 확인 단계 Slack "확인 요청" DM 수신자를 **이슈 assignee가 아니라 저장된 확인자 preset 기준**으로 해석(`resolveConfirmRecipients`) — 비멤버는 git assignee로 박히지 않아 기존 assignee 기반 해석으론 알림이 새던 것을 바로잡음. 멤버 확인자는 종전처럼 assignee로도 배정되고, 비멤버는 assignee 지정만 생략(best-effort)된다. veto(수신거부)는 그대로 존중하며 이 경우 assignee로 fallback 하지 않는다.
- **확인자/담당자 알림 대상 매핑 보강 (git username)**: 단계 전이·머지완료 Slack DM 수신자(확인자/검증자/담당자)는 git 이슈의 assignee(git id/username)를 IVE 계정에 역매핑해 찾는다. 기존엔 **그 git provider로 IVE에 로그인한 경우(oauth id 일치)에만** 매핑돼, 다른 방식(GitHub·Slack 등)으로 로그인한 사람은 Slack을 연결해도 확인자 알림을 못 받았다. 이제 oauth id 매칭 실패 시 **git username 으로도 매칭**(`getUserByGitUsername`, 대소문자 무시)한다. 이를 위해 ① OAuth 로그인 시 git username 을 IVE 계정에 자동 저장(`gitlab_username`/`github_username` — 그동안 비어 있던 컬럼), ② 프로필 설정에 **"Git 사용자명"** 직접 입력 추가(다른 provider로 로그인한 사용자가 자기 GitLab/GitHub username 을 채워 매핑되게, blur 자동저장, `/api/settings/git-username`). 확인자는 IVE에서 git 멤버로 지정돼 git id/username 으로 저장된다는 점은 그대로.
- **머지·CI 완료 Slack 알림 (폰 푸시)**: MR/PR 머지 시 확인 모달에 **"머지·CI가 끝나면 Slack으로 알림 받기"** 체크박스 추가(기본 ON, Slack 연결 사용자만 노출). 켜고 머지하면 서버측 감시자(`merge-watcher.ts`)가 머지 후 파이프라인을 백그라운드로 폴링하다 **CI 완료 순간** Slack DM 발송 — 브라우저 탭을 닫거나 폰을 꺼도 동작(기존 클라이언트 toast 와 별개). ① 머지를 누른 **본인**에게 배포 성공/실패, ② **확인자**에게는 머지+CI 가 끝나 실제로 확인 가능한 시점에 *"이제 확인하세요"*(검증자 알림과 같은 취지). 확인자 알림 타이밍을 바로잡음 — 기존엔 검증자가 approve 누른 순간(=CI 완료 전)에 발송돼 머지 전에 "확인하세요"가 갔는데, 이제 머지 감시자와 조율(`isMergeWatchActive`)해 CI 완료 시점에 보내고, 외부 머지 등 감시가 없으면 approve 시 "이미 머지됨"을 확인해 발송한다. 본인=확인자면 중복 발송하지 않음. CI 없는 프로젝트는 머지 자체를 완료로 간주. (파이프라인 매칭 로직을 `merge-pipeline.ts`로 공용화.)
- **메일 임시저장 + 발송메일 복제**: 메일을 작성 후 발송하지 않고 **임시저장**(메일 발송 화면의 '임시저장' 버튼 + '임시저장함' 목록에서 불러오기·수정·삭제). 임시저장에서 불러와 발송하면 해당 draft는 자동 정리. **발송 이력**에서 이미 보낸 메일을 **복제**하면 제목·본문이 임시저장으로 복사되고 메일 발송 화면으로 전환돼 **다른 수신자**를 골라 재발송. 신규 테이블 `mail_drafts`, 엔드포인트 `/api/admin/mail/drafts*`.
- **홍보(Promotion) — SNS 글 + 통합 성과**: 관리자 "메일" 탭을 **"홍보"**로 확장. 채널은 ① 메일 발송 ② **SNS 글 등록**(신규) 2가지. SNS 글은 작성·저장 후 **채널별(X·링크드인·페북 등) 추적 링크**를 받아 수기로 게시. 공개 링크 클릭은 익명 방문자 쿠키로 기록되고, 클릭한 방문자가 이후 **가입/로그인하면 전환으로 귀속**(last-touch, register/login/OAuth 모두). 홍보 패널에 **[성과]** 탭 추가 — 메일+SNS를 한 표에서 유입(클릭)·고유·전환으로 비교. 신규 테이블 `social_posts`/`social_post_links`/`social_clicks`, 엔드포인트 `/api/social/click`(공개 리다이렉트)·`/api/admin/social*`·`/api/admin/promotion/performance`. (직접 자동 게시는 향후 확장 — 상태/채널 구조만 선반영.)
- **메일 접속 추적·통계**: 발송 메일에 추적 가능한 **IVE 접속 링크**(하단 'IVE 접속하기' 버튼 + 본문 `{{link}}` 태그) 자동 삽입. 수신자가 링크로 IVE에 접속하면 발송·사용자·시각을 기록(`mail_broadcast_clicks`). 메일 발송이력 화면에 발송별 **접속 횟수 칩** 표시 → 클릭하면 **사용자별 접속 통계**(아바타+이름(이메일), 접속 횟수, 최근 접속 시각) 모달. 발송이력 삭제 시 접속 기록도 함께 정리.
- **메일 발송 개인화·수신거부**: 관리자 일괄 메일에 `{{name}}`·`{{email}}` 개인화 태그 지원(발송 시 수신자별 치환, 수신자 값은 HTML 이스케이프). 모든 발송 메일 하단에 수신자별 서명 토큰이 담긴 수신거부 링크 자동 삽입 → 비로그인 `/unsubscribe` 페이지에서 수신거부/재구독. `users.mail_unsubscribed` 컬럼 추가, 수신거부자는 일괄 발송 대상에서 항상 제외(발송 결과에 제외 인원 표시). 수신 여부는 **사용자 본인만** 변경 — 프로필 설정(아바타 메뉴)에 수신 on/off 토글 추가, 관리자는 임의로 재개할 수 없고 사용자 카드엔 수신거부 상태 배지만 표시.
- **사용자 선택/필터 UI 통일**: 메일 발송 수신자 선택을 검색·스크롤되는 피커로 교체(사용자가 늘어도 화면이 꽉 차지 않음). 사용자를 표시하는 선택/필터 UI(메일 수신자, 활동로그 필터, 리포트 수신자, Slack 기본 담당자)를 `아바타 + 이름(이메일)` 형태로 통일(`MultiSelectPicker`/`CustomSelect` 아바타 지원, `userToOption` 헬퍼).
- **이용약관·개인정보처리방침 도입**: `/legal/terms`, `/legal/privacy` 페이지(ko/en) 추가. 외부 공개 서비스 + OAuth 가입에 대응해 개인정보처리방침을 수립·공개(개인정보보호법 제30조). 로그인 화면 OAuth 버튼 아래·하단에 동의 고지문과 약관 링크, 회원가입 화면 가입 버튼 위에 동의 고지문 노출.
- **약관 동의 시점 기록**: `users.terms_agreed_at` 컬럼 추가. 이메일/소셜 가입 시점을 동의 시각으로 저장.
- **약관 설정 관리자화**: 관리자 설정에 "약관·개인정보" 그룹 추가. 로그인 화면 표시 on/off 토글(사내 전용 설치 시 끄기) + 운영주체 정보(회사명·주소·보호책임자·이메일·서비스 URL·시행일)를 설정에서 지정. 약관 본문(조항)은 i18n 템플릿으로 두고 회사별 값만 주입(`getLegalConfig`, 공개 엔드포인트 `/api/public/legal-config`).
- **오픈소스 라이선스 고지**: 납품(배포) 시 attribution 의무 대응. 프로덕션 의존성 라이선스·저작권 전문을 수집하는 `scripts/generate-third-party-notices.mjs`(npm `licenses`/`prebuild`로 빌드 시 자동 갱신) → `public/third-party-notices.txt`(동봉용 전문) + `src/data/third-party-licenses.json`(페이지용 메타). `/legal/licenses` 페이지(ko/en, 검색·라이선스별 집계·전문 링크) 추가, 약관·로그인 푸터에 링크 연결. (GPL/AGPL 0건 — 자사 소스 공개 의무 없음.)

### Changed
- **Gemini CLI → agy(Google Antigravity CLI) 교체**: Gemini CLI 가 단종되고 agy 로 대체돼 실행 경로 전체를 옮겼다. 호출 인자를 agy 헤드리스 규격으로 재작성(`--dangerously-skip-permissions --output-format stream-json --model <slug> --conversation <id> -p`), 기본 5분인 `--print-timeout` 을 12시간으로 늘려 장시간 작업이 중간에 끊기지 않게 했다. stream-json 이벤트 스키마가 달라(`init` / `step_update{user_input|agent_response|tool|checkpoint}` / `result`) 로그 포매터·도구 활동 추적·토큰 집계를 새로 구현 — 토큰은 `result.usage`(input_tokens 는 캐시 포함 총입력, output_tokens 는 thinking 포함), 턴 수는 `result.num_turns` 를 쓴다. MCP 설정은 워크스페이스 `.agents/mcp_config.json` 으로 기록(gemini 는 `.gemini/settings.json` 이었다). 모델 목록은 `agy models` 로 **동적 조회**(gemini 는 고정 목록이었다). 인터뷰 경로, 채팅 스트리밍(`chat-agent`), stderr 배너 필터도 함께 이관. DB 는 `agents.cli_name` CHECK 제약을 재생성해 `agy` 를 추가하고(컬럼 목록 하드코딩 없이 기존 CREATE 문의 CHECK 절만 치환) 기존 gemini 에이전트를 agy 로 전환(경로가 gemini 바이너리면 `/usr/local/bin/agy` 로 교체) — **과거 실행 이력의 'gemini' 표기는 그대로 보존**해 지난 보고서 수치가 바뀌지 않는다. Docker 이미지는 `npm i -g @google/gemini-cli` 대신 공식 설치 스크립트로 agy 바이너리를 받아 `/usr/local/bin/agy` 에 둔다(빌드 root 홈에 깔리면 실행 사용자 ive 가 못 읽으므로 임시 HOME 사용). agy 는 설정·자격증명을 `~/.gemini` 아래 두므로 컨테이너 마운트는 `${AGY_CONFIG_HOST_DIR:-./agy-config}:/home/ive/.gemini` 로 바꾸고 `~/.antigravity`·`~/.cache/antigravity` 를 추가. UI·i18n·브로셔의 표기와 로고(`public/cli/agy.png`)도 교체했다.

- **제품 소개서(브로셔) 구조도 개편 — 2장 Product Overview**: 실제 운영 흐름과 어긋나던 부분을 바로잡고 단계를 ①~⑫로 다시 매겼다. ① AI 에이전트가 검증자·확인자에게 **직접** 전달하던 선을 끊고 **IVE 경유**(⑤ 결과 제출 → ⑥ 검토·확인 요청)로, ② 검증 통과 후 **⑦ MR/PR 병합 → ⑧ 자동 빌드 → 스테이징 → 확인자 승인 → 운영 반영** 배포 파이프라인을 카드로 신설(승인 게이트는 사람 색인 앰버), ③ **6.5 검증·확인 반려**(회색) 되돌림 흐름 추가, ④ Slack 연결을 점선 "다자간 대화" 하나에서 **DM 발송 / AI봇과 대화 실선 2줄기**로 분리. 명칭도 정리 — "IVE 수집 링크" → **IVE Open API**(아이콘 교체, 5장 문구 동기화), MR 단독 표기 → MR/PR. 개발자 카드에 IDE 로고(VS Code·Cursor·Antigravity), 우상단에 **업무·프로젝트 관리 연동(Linear·Jira·Asana·Notion)** 영역을 점선 연결 + "연동 예정"으로 추가(미구현 표시). 표기 오류였던 "Issue-driven aI deVelopment Engine" → "AI Development Engine", 근거 없이 붙어 있던 "2026년 3월부터 운영 중" 배지 제거. 카드 끝선·아이콘 칩 높이 정렬, 브라우저에서 볼 때 슬라이드가 좌측에 붙던 문제(가운데 정렬)도 수정. (`docs/build-brochure.js` 재생성 스크립트 기준, HTML/PDF/PNG 일괄 갱신)

### Performance
- **동시 접속 처리량 튜닝 (측정 기준 SSR 2.2배 / API 2.4배)**: 운영 서버(4코어)에서 웹 서버가 **코어 1개에 묶여** 나머지 3개가 놀고 있었고, SQLite 는 **rollback journal(`delete`) 모드**라 쓰기 1건이 DB 전체에 배타 락을 걸어 그동안 모든 읽기가 멈췄다(대시보드는 2~10초 폴링으로 읽기가 압도적인데 스캐너·통계 스냅샷이 계속 쓴다). 세 가지를 손봤다.
  - **SQLite 동시성**(`connection.ts`): `journal_mode=WAL`(읽기/쓰기 상호 비차단), `busy_timeout=5000`(기존 0 — 쓰기가 겹치는 순간 즉시 SQLITE_BUSY 였다), `synchronous=NORMAL`, 페이지 캐시 2MB→64MB, `temp_store=MEMORY`, `mmap_size=256MB`. 운영 하드웨어에서 운영 DB 복사본(88MB)으로 잰 결과 쓰기 경합 하 읽기 처리량이 **1.5~2.3배**(리더 4/16/32 기준 25,956→59,647, 32,598→64,257, 39,983→60,409 reads/s), 쓰기 처리량도 **1.3~2.1배**.
  - **웹 워커 다중화**(`server.ts`): `WEB_CONCURRENCY`(`auto`=코어 수, 미설정 시 1로 종전과 동일)로 cluster 워커를 띄운다. 백그라운드 작업(스캐너·통계 수집·리포트 스케줄러)은 **워커 0 에서만** 돈다 — 워커마다 스캐너가 돌면 같은 이슈를 중복으로 집어 에이전트를 여러 번 실행하므로(토큰 소진 사고), `IVE_BACKGROUND_JOBS=0` 으로 나머지 워커에서 차단하고 기동 로그로 1회만 뜨는 것을 확인한다.
  - **연결 수명/누수**: 터미널 WebSocket 에 ping/pong 하트비트 추가 — 브라우저가 죽어 FIN 이 오지 않으면 PTY 셸 프로세스가 영원히 살아남던 누수를 정리한다(chat WS 엔 이미 있던 장치). 터미널 동시 세션 상한(`MAX_TERMINALS` 기본 100, `MAX_TERMINALS_PER_USER` 기본 5) 추가. HTTP `keepAliveTimeout` 을 72초로(nginx `keepalive_timeout 65s` 보다 길게) — Node 기본 5초는 nginx 가 커넥션을 재사용하려는 순간 서버가 먼저 끊어 간헐적 502 를 만든다. WS 업그레이드마다 찍던 stdout 로그는 `WS_LOG=1` 일 때만.
  - 운영과 같은 하드웨어에서 현재 이미지 대비 A/B(별도 포트·DB 복사본, 라이브 무영향): SSR `/login` **78.6→170.5 req/s(2.17배)**, JSON API **880→2,141 req/s(2.43배)**, 동시성 16에서 SSR p50 지연 **212→104ms**.
- **보고서 화면 로딩 속도 개선**: 데이터가 쌓일수록 보고서가 느려지던 원인을 쿼리 레벨에서 제거. ① 대기추이(`getDailyWaitingTrend`/`...ByAgent`)가 `stat_snapshots`를 조회할 때 `DATE(timestamp,'+9 hours')`로 컬럼을 함수로 감싸 비교 → 인덱스를 못 타고 매 호출마다 전체 행(에이전트 24k+)을 풀스캔하던 것을, KST 날짜 경계를 UTC instant로 미리 변환해 `timestamp` **레인지 비교**로 바꾸고 `(entity_type, timestamp)` 복합 인덱스(`idx_stat_snapshots_type_ts`)를 추가 → 인덱스 레인지 시크(과거/이전 기간 조회 16ms→~0ms, 결과 동일성 검증). ② 유입/유출 집계(`getIssuesStartedInRange`/`getIssuesCompletedInRange`)가 `task_executions` 전체를 GROUP BY 후 HAVING으로 거르던 것에 `started_at < endISO` 상한 프루닝 추가(완료·시작 시각 ≤ started_at 관계상 결과 불변, `idx_te_started_at` 활용). ③ 1시간 주기 정리 후 WAL `TRUNCATE` 체크포인트 + free page가 전체의 25% 초과 시 `VACUUM`으로 단편화 회수(스냅샷 1분 insert/7일 delete churn으로 누적되던 빈 페이지 정리).

### Fixed
- **내 에이전트 목록에 없는 개발자가 내 이슈를 처리하던 문제 (의뢰자 판정 git username 폴백)**: 프로젝트 화면·실행 이력에 **본인 에이전트 목록에 존재하지 않는 이름**(운영에선 관리자 계정의 옛 에이전트 '똑똑이')이 작업자로 표시됐다. 원인은 의뢰자(requester) 판정이 **oauth_user_id(숫자 id) 매칭만** 하고 있던 것 — #272 이후 이슈는 "의뢰자의 에이전트 풀"로 처리되는데, GitHub·Slack·이메일 등 **다른 방식으로 IVE 에 가입한 사용자**는 GitLab 이슈에 `IVE-S` 를 붙여도 식별되지 않아 판정이 **프로젝트 오너 fallback** 으로 떨어졌다. 그러면 의뢰자 = 프로젝트 오너(운영은 `admin@ive.local`)가 되고, 그 계정의 에이전트 풀에서 작업자가 배정된다. 사용자는 **자기 목록에 없어 보이지도 관리하지도 못하는 에이전트**가 자기 이슈를 처리하는 것을 보게 된다. 알림 수신자 매핑에서는 이미 같은 문제를 git username 폴백으로 해결했는데(`getUserByGitUsername`) 의뢰자 판정만 빠져 있었다. 이제 `resolveIssueRequester`/`resolveIssueRequesterAsync` 도 **oauth id 실패 시 git username 으로 매칭**한다(대소문자 무시). 이를 위해 레이블 이벤트가 부착자의 **username 도 함께 싣도록** 확장(GitLab `user.username`, GitHub `actor.login` — 종전엔 숫자 id 만 담고 버렸다). 골든 테스트 6종 추가(`issue-requester-git-username.test.ts`).
  - **접수(작업 접수) 이슈도 의뢰자로 처리**: 접수 이슈는 IVE 의 프로젝트 토큰으로 생성돼 Git 작성자가 항상 봇이라, 종전엔 예외 없이 오너 fallback 으로 떨어졌다(운영에서 `똑똑이` 가 배정된 실제 경로가 이것이다 — Meta-Shop #1269·#1297). 접수 API 는 비로그인 외부 사용자도 쓰는 공개 창구라 인증을 요구하지 않지만, **IVE 에 로그인한 채로 접수했다면 그 사람이 곧 의뢰자**이므로 본문에 `ive-author` 마커를 남겨 판정 1단계에서 잡히게 했다. 로그인 정보가 없으면(외부 서비스 API 연동 등) 종전대로 프로젝트 오너가 의뢰자다.
  - **의뢰자가 에이전트를 0개 보유한 경우의 정지 방지**: 의뢰자 풀이 비면 이슈가 매 스캔 `[SKIP] No available agent` 로 **영원히 대기**한다(프로젝트를 공유받아 쓰지만 자기 에이전트를 만들지 않은 사용자가 의뢰·접수하면 바로 이 상황). 보유 0개일 때만 프로젝트 오너 풀로 되돌려 처리가 멈추지 않게 하고 `[POOL]` 로 남긴다. 보유하고 있는데 바쁨/휴가라 못 쓰는 경우는 종전대로 대기한다(지정 의도 존중).
- **운영에서 Claude 에이전트가 계속 실패하던 문제 (OAuth 토큰 revoke)**: 운영 컨테이너의 Claude 실행이 `401 OAuth access token has been revoked` 로 전부 실패하고 있었다(7/28부터, 같은 이슈를 OpenCode 가 대신 처리해 표면화되지 않음). 원인은 ① IVE 의 `claude-config/.credentials.json` 에 **refresh token 이 빈 문자열**로 저장돼 있어 갱신이 구조적으로 불가능했고(access token 수명 8시간이 지나면 사망), ② 같은 Claude 계정을 쓰는 `product-factory-ai` 와 **각자 사본**을 들고 있어 한쪽이 갱신하면 refresh token 이 로테이션되어 다른 쪽 grant 가 revoke 되는 구조였다. 사본을 없애고 **두 컨테이너가 같은 디렉터리(`/home/ubuntu/.claude`)를 보도록** 통합(`CLAUDE_CONFIG_HOST_DIR`) — 물리적으로 한 파일이므로 어느 쪽이 갱신해도 즉시 공유된다. 공유에 따라 상대 컨테이너의 `settings.json`(`"model": "sonnet"`)을 물려받아 IVE 가 조용히 Opus→Sonnet 으로 바뀌는 부작용이 생기므로(IVE 는 `cli.claude.model` 미설정이라 `--model` 을 넘기지 않음) `ANTHROPIC_MODEL=opus` 로 컨테이너 단위 격리.
  - 공유에 따르는 **uid 충돌**도 함께 해소: `product-factory-ai` 는 root(uid 0)로, IVE 는 uid 1001(`ive`)로 claude 를 돌린다(IVE 는 `--dangerously-skip-permissions` 를 쓰는데 Claude Code 가 root 에서 이를 거부). 토큰 갱신 시 파일이 **갱신한 쪽 uid 로 0600 재작성**되므로 root 가 갱신하면 `root:root 0600` 이 되어 uid 1001 이 읽지 못한다(반대 방향은 root 가 소유권을 무시하므로 문제없음). 배포 서버에 **소유권 정규화**를 설치했다 — `/usr/local/bin/claude-creds-normalize.sh` + systemd path 유닛 `claude-creds-normalize.path`(자격증명 파일과 그 디렉터리를 함께 감시해 제자리 수정·temp+rename 교체를 모두 포착 → `chown 1001:1001`). 컨테이너 재시작 시에는 `docker-entrypoint.sh` 의 `chown -R` 이 같은 일을 한다.
  - **그 소유권 정규화 자체가 죽어 있어 같은 장애가 재발한 것도 수정**: 위 `claude-creds-normalize.sh` 가 **무조건** `chown`/`chmod` 를 실행해 파일이 매번 "변경"됐고, 그 변경이 자신을 트리거하는 `.path` 유닛을 다시 발화시켜 **무한 루프** → systemd start-limit 에 걸려 path·service 유닛이 **2026-08-07 영구 `failed`** 로 정지했다. 이후 10일간 정규화가 없는 상태에서 8/16 root(`product-factory-ai`)가 토큰을 갱신 → `root:root 0600` → uid 1001 이 자격증명을 못 읽어 **IVE 의 모든 Claude 실행이 즉시 exit code 1**(8/17 발견). 세 가지로 고쳤다 — ① 스크립트를 **조건부**로 변경(소유권/퍼미션이 실제로 틀렸을 때만 손대 루프를 끊음), ② service 유닛에 `StartLimitIntervalSec=0` 을 두어 연속 발화로 유닛이 영구 정지하지 않게 함, ③ `.path` 가 어떤 이유로든 죽어도 자가 치유되도록 **2분 주기 backstop timer**(`claude-creds-normalize.timer`)로 이중화. 정규화 범위도 자격증명 파일 하나에서 **공유 디렉터리 전체**(`shell-snapshots`·`projects` 등 root 가 남긴 잔여물 포함)로 넓혔다 — 이들이 root 소유로 남으면 ive 가 쓰지 못해 Bash 도구 등이 조용히 망가진다.
- **메인 브랜치 머지로 닫힌 작업이 "실패"로 집계되던 문제**: 검증/확인 단계의 작업이 MR/PR 머지로 자동 닫히면(`Closes #iid` + 작업 브랜치 삭제) 이슈가 `IVE-E`(완료) 단계를 거치지 않고 스캔에서 사라진다. 스캐너의 stale(좀비) 정리가 이를 단순 좀비로 보고 잔류 execution을 `failed`로 마감해, 실제로는 머지·완료된 작업이 보고서에서 **실패**로 잡히던 문제 수정 (#467). 이제 스캔에서 사라진 이슈를 정리할 때 **메인 브랜치 머지로 닫힌 작업인지** 먼저 판정한다 — 이슈가 `closed` 상태이고 작업 브랜치(`dev-{iid}`)의 MR/PR이 `merged`이면 **완료(success)로 마감**하고, 검증이 진행 중이었으면(`verify_started_at` 존재) 머지 시각으로 `verified_at`을 기록(머지는 검증 통과를 의미)한다. 머지 흔적이 없는 경우(수동 닫기·라벨 제거)는 기존대로 실패 처리하며, 네트워크 조회 실패 시에도 보수적으로 실패 처리로 떨어져 잘못된 완료 처리를 방지(`reconcileClosedIssue`/`completeMergedIssue`).
- **보고서 '대기 건수'가 0으로 나오던 문제**: 보고서 흐름(Flow)의 '대기' 지표가 (1) 확인대기(IVE-P)를 아예 빼먹고, (2) 처리대기·검증대기를 **스캐너 캐시 컬럼**(`lastScannedIssueCount`/`lastVerifyWaitingCount`)에서 읽어 GitLab에서 수동으로 라벨/단계를 바꾼 건을 즉시 반영하지 못해, 대기 건이 있어도 0으로 표시되던 문제 수정 (#462). 1차로 확인대기를 스냅샷~대기추이 전 구간에 추가(`stat_snapshots.confirm_waiting`, `stat_daily_summaries.avg_confirm_waiting` 컬럼 신설·마이그레이션). 2차로 **통계 스냅샷 수집(`stats-collector.ts`)이 처리대기/검증대기/확인대기를 모두 권위 소스인 `issue_stages.cached_stage`에서 직접 집계**하도록 통일(프로젝트 카드 통계와 동일 기준) — 수동 단계 전환도 다음 스냅샷(최대 1분)에 반영. 이제 보고서 '현재 대기'·프로젝트별 대기·메일 보고서 대기 추이가 `처리대기 + 검증대기 + 확인대기` 합계로 정확히 집계됨.
- **메일 전체발송 안전장치**: 관리자 메일 발송에서 **수신자를 선택하지 않으면 전원 발송되던** 위험한 폴백 제거. 이제 미선택 시 발송이 차단되고, 전체 발송은 **'모두에게 발송' 체크박스**를 명시적으로 켰을 때만 가능. API도 `sendToAll=true` 없이 빈 수신자면 400 반환(구형 클라이언트 안전). 발송 버튼은 미선택+미체크 시 비활성.
- **Slack 에이전트 응답 마크다운 깨짐**: AI 에이전트가 표준 Markdown(`**굵게**`·`### 헤더`·`[t](u)`·`~~취소선~~`·표)을 그대로 보내 Slack 대화창에 태그가 문자 그대로 찍히던 문제 수정. 전송 직전 Slack `mrkdwn`으로 변환(`markdownToMrkdwn`) — 굵게 `*`, 기울임 `_`, 헤더는 굵게 줄, 링크 `<url|text>`, 불릿 `•`, 표는 Slack 에 표 문법이 없어 **열 너비를 맞춘 코드블록**으로(표시폭 한글·이모지=2칸 계산, 헤더 밑 `-+-` 구분선). 표 셀 안의 마크다운(`**`·`[]()`·백틱)은 코드블록에서 렌더 안 되므로 미리 제거. 코드펜스/인라인 코드 내부는 변형하지 않음. IVE 시스템 알림(단계 전이 DM)은 이미 mrkdwn 이라 영향 없음. (운영 봇으로 실제 채널 렌더링 검증 완료.)
- 프로젝트 카드 "완료(오늘)" 카운트가 KST 자정~오전 9시에 완료된 건을 누락해 0으로 표시되던 문제 수정 (#448). `issue_stages.updated_at`(`datetime('now')` 공백 포맷)과 오늘 시작 기준값(ISO `T`/`Z` 포맷)을 단순 문자열 비교하던 것을 `datetime()` 정규화 비교로 교체.

## [1.5.0] - 2026-06-03

Slack 통합과 비용 원가 모델을 도입한 릴리스.

### Added
- **Slack 통합**
  - 워크스페이스 봇 원클릭 설치(OAuth) + 워크스페이스 소유자 모델
  - 멘션으로 IVE 에이전트와 대화(에이전트 주도, 스레드 독립 세션)
  - 단계 전이별 작업 알림 DM (검증대기→검증자 / 확인대기→확인자 / 완료→생성자)
  - 작업완료 Slack 알림(DM + 채널 멘션), 멘션 사용자 언어(locale) 다국어 처리
  - Slack OAuth 로그인 통합 + 알림용 멤버 ID 자동 연결, 첨부 이미지 분석/업로드
- **이미지 입력 공통 지원**: 웹 채팅·Slack 멘션·이슈 본문/코멘트 첨부 이미지를 에이전트가 분석 (`-i`/`-f`/프롬프트 경로)
- **비용 원가 모델**: 작업시간을 ive-meta(`work_sec`) 기준으로 산정, 사용자별 단가 배수(`rate_multiplier`) 반영
- 사용자별 표시 통화·환율 변환, 리포트 비중 누적 분배 막대
- 에이전트 사용중지 토글(자동재개·선택 제외)

### Changed
- Claude 답변 토큰 단위 스트리밍, 페이지 이탈에도 대화 유지
- 관리자 설정 재편(OAuth/Slack/터미널 하위 이동), 확인 팝업을 클릭 지점 팝오버로 통일
- 기본 사용자(admin@ive.local)는 메일 인증 없이 비밀번호 변경 허용

## [1.0.0] - 2026-05-30

멀티 CLI 에이전트 정식 지원으로 첫 안정 버전.

### Added
- **Codex CLI** 에이전트 정식 지원 (#366)
- **Gemini CLI** 정식 지원 + CLI 브랜드 로고
- 기본 아바타로 CLI 회사 브랜드 로고 추가

## [0.10.0] - 2026-04-30

5단계 워크플로우와 외부 작업 접수 체계 확립.

### Added
- **5단계 워크플로우**(유입→처리→검증→확인→완료) + 역할 모델 정립 (#271)
- **작업 접수 페이지**(HMAC Signed Token 보안), 테마/언어 선택 UI, 이미지 붙여넣기 업로드
- 구조화된 로깅 시스템 + 관리자 로그 뷰어
- 작업 마감일·회차 정보, 프로젝트 테스트 사이트 URL 바로가기

## [0.9.0] - 2026-04-17

브랜딩 및 온보딩 개편.

### Changed
- **브랜딩 Spring IVE → Springware IVE** 전체 변경, 브랜드 색상 분리

### Added
- 인트로 슬라이드 리디자인, 가이드 투어/도움말 시스템
- PWA 설치 버튼, 아이콘/패비콘 주제색 최신화

## [0.8.0] - 2026-04-12

외부 AI 도구 작업 연동.

### Added
- 외부 AI 도구 작업의 IVE 자동 인식 + 가이드 설치(보호 브랜치 대응)
- 이슈 이미지 붙여넣기 업로드, 캐시 토큰 분리 기록
- i18n 파일 도메인별 분리

## [0.7.0] - 2026-04-11

OAuth 인증과 검증자 역할 도입.

### Added
- **GitLab/GitHub OAuth 로그인** + 검증자(verifier) 기능
- OAuth 기반 검증자-사용자 매칭, 이슈 권한 제어
- 이슈 선호 작업자(에이전트) 지정, Git 담당자 배정 (#156)
- 사람 실행·검증 비용 단가 모델, 보고서 검증시간 통계

## [0.6.0] - 2026-03-27

MR 충돌 처리 자동화.

### Added
- MR 충돌 감지를 에이전트 기반으로 구현 (#102)
- 채팅/UI 개선, MR 닫기 기능

## [0.5.0] - 2026-03-25

다국어 지원.

### Added
- **i18n**(next-intl, 한국어 + 영어), AI 프롬프트·결과 노트 locale 다국어화
- 사용자 locale DB 영속화 + 멀티 브라우저 UI 동기화

## [0.4.0] - 2026-03-21

OpenCode 작업자 및 모델 단가.

### Added
- **OpenCode** 작업자 실행 지원, MCP 서버 설정
- 실행 모델명 캡처 및 단가 계산, 사용자별 CLI 도구 사용 권한

## [0.3.0] - 2026-03-17

대규모 리팩토링과 핵심 기능 확장.

### Added
- 아바타 시스템·인터뷰, 보고서, 관리자 기능
- **GitHub provider** 지원, MR 리뷰/머지 기능
- PWA 지원(manifest/service worker/앱 아이콘), 모든 탭 pull-to-refresh

### Changed
- 역할 시스템 제거 대규모 리팩토링, 환경변수 탭 → DB 기반 시스템 설정

## [0.1.0] - 2026-03-15

초기 MVP.

### Added
- 프로젝트/슬롯 관리 시스템, 스캐너 자동화 + 에이전트 배정
- 실시간 실행 트레이싱(xterm.js), 웹 터미널(WebSocket + node-pty)
- Docker/docker-compose 컨테이너 배포, GitLab CI/CD 파이프라인
- Claude Code CLI 연동, 작업 완료 시 AI 대화 로그를 이슈 노트에 첨부

[Unreleased]: https://gitlab.com/kojoung/ive/-/compare/v1.5.0...main
[1.5.0]: https://gitlab.com/kojoung/ive/-/releases/v1.5.0
[1.0.0]: https://gitlab.com/kojoung/ive/-/releases/v1.0.0
[0.10.0]: https://gitlab.com/kojoung/ive/-/releases/v0.10.0
[0.9.0]: https://gitlab.com/kojoung/ive/-/releases/v0.9.0
[0.8.0]: https://gitlab.com/kojoung/ive/-/releases/v0.8.0
[0.7.0]: https://gitlab.com/kojoung/ive/-/releases/v0.7.0
[0.6.0]: https://gitlab.com/kojoung/ive/-/releases/v0.6.0
[0.5.0]: https://gitlab.com/kojoung/ive/-/releases/v0.5.0
[0.4.0]: https://gitlab.com/kojoung/ive/-/releases/v0.4.0
[0.3.0]: https://gitlab.com/kojoung/ive/-/releases/v0.3.0
[0.1.0]: https://gitlab.com/kojoung/ive/-/releases/v0.1.0
