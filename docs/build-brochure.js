/*
 * IVE 제품 소개서(브로셔) 빌더 — 재생성 가능한 단일 스크립트
 *
 * 출력: docs/ive-overview.html (1장 전체 구조도)
 *       docs/ive-impact.html   (2장 도입 효과 Before→After)
 *       docs/ive-brochure.html  (위 두 장을 묶은 멀티페이지)
 *
 * 로고는 public/ 및 docs/assets/ 의 실제 파일을 base64로 인라인한다.
 * PDF/PNG 렌더링은 docs/build.sh 가 headless Chrome 으로 수행한다.
 *
 * 실행:  node docs/build-brochure.js   (HTML만 생성)
 *        bash docs/build.sh            (HTML + PDF + PNG 일괄 생성)
 */
const fs = require('fs');
const path = require('path');

function dataUri(rel, mime) {
  const buf = fs.readFileSync(path.join(__dirname, rel));
  return `data:${mime};base64,` + buf.toString('base64');
}
const claude   = dataUri('../public/cli/claude.svg',     'image/svg+xml');
const codex    = dataUri('../public/cli/codex.png',      'image/png');
const gemini   = dataUri('../public/cli/gemini.png',     'image/png');
const opencode = dataUri('../public/cli/opencode.svg',   'image/svg+xml');
const slack    = dataUri('assets/slack.svg',             'image/svg+xml');
const iveLogo  = dataUri('../public/slack-icon-1024.png','image/png'); // IVE 앱 아이콘 = 중앙 허브 로고
const github   = dataUri('assets/github.svg',            'image/svg+xml');
const gitlab   = dataUri('assets/gitlab.svg',            'image/svg+xml');
const scrProjects = dataUri('assets/screens/projects.png','image/png');
const scrAgents   = dataUri('assets/screens/agents.png',  'image/png');
const scrIssues   = dataUri('assets/screens/issues.png',  'image/png');
const scrReports  = dataUri('assets/screens/reports.png', 'image/png');

// ===== brand palette =====
const BG='#0e0e11', CARD='#1c1c20', BORDER='#2a2a31',
      CYAN='#22d3ee', CYAND='#0891b2', AMBER='#f59e0b', SPRING='#22c55e', RED='#ef4444',
      TXT='#e4e4e7', MUT='#8b8b93', DIM='#5b5b63',
      BEFORE_FILL='#1a1416', AFTER_FILL='#0f1f24';
const FF=`font-family="-apple-system,'Apple SD Gothic Neo','Pretendard',system-ui,sans-serif"`;

// ===== shared helpers =====
function card(x,y,w,h,o={}){
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r||14}" fill="${o.fill||CARD}" stroke="${o.stroke||BORDER}" stroke-width="${o.sw||1.5}"/>`;
}
function text(x,y,s,o={}){
  const sz=o.size||16, fill=o.fill||TXT, w=o.weight||700, anc=o.anchor||'middle',
        ls=o.ls!=null?` letter-spacing="${o.ls}"`:'';
  return `<text x="${x}" y="${y}" font-size="${sz}" font-weight="${w}" fill="${fill}" text-anchor="${anc}"${ls} ${FF}>${s}</text>`;
}
function badge(cx,cy,num,label,w,color=CYAN){
  const h=26, x=cx-w/2;
  return `<g>
    <rect x="${x}" y="${cy-h/2}" width="${w}" height="${h}" rx="13" fill="${BG}" stroke="${color}" stroke-width="1.2"/>
    <circle cx="${x+15}" cy="${cy}" r="9" fill="${color}"/>
    <text x="${x+15}" y="${cy+4}" font-size="12" font-weight="800" fill="${BG}" text-anchor="middle" font-family="system-ui">${num}</text>
    <text x="${x+30}" y="${cy+4.5}" font-size="12.5" font-weight="700" fill="${TXT}" text-anchor="start" ${FF}>${label}</text>
  </g>`;
}
function pill(cx,cy,label,w,color,dashed){
  const h=26, x=cx-w/2, da=dashed?` stroke-dasharray="5 4"`:'';
  return `<g>
    <rect x="${x}" y="${cy-h/2}" width="${w}" height="${h}" rx="13" fill="${BG}" stroke="${color}" stroke-width="1.2"${da}/>
    <circle cx="${x+15}" cy="${cy}" r="4" fill="${color}"/>
    <text x="${x+27}" y="${cy+4.5}" font-size="12.5" font-weight="700" fill="${TXT}" text-anchor="start" ${FF}>${label}</text>
  </g>`;
}
const header = (title, sub) => `
  <text x="64" y="56" font-size="38" font-weight="800" fill="${CYAN}" text-anchor="start" letter-spacing="1" font-family="system-ui">IVE</text>
  <text x="134" y="56" font-size="38" font-weight="300" fill="${DIM}" text-anchor="start" font-family="system-ui">|</text>
  ${text(156,40,title,{anchor:'start',size:21,fill:TXT})}
  ${text(156,62,sub,{anchor:'start',size:13,fill:MUT,weight:600})}
  <text x="1216" y="42" font-size="16" font-weight="700" text-anchor="end" font-family="system-ui"><tspan fill="${SPRING}">Spring</tspan><tspan fill="${AMBER}">ware</tspan></text>
  ${text(1216,62,'Product Overview',{anchor:'end',size:12,fill:DIM,weight:600,ls:1})}
  <line x1="64" y1="80" x2="1216" y2="80" stroke="${BORDER}" stroke-width="1"/>`;

// ============================================================
// SLIDE 1 — 전체 구조도
// ============================================================
function slideOverview(){ return `
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="hub" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#0c4a55"/><stop offset="55%" stop-color="#0b3a44"/><stop offset="100%" stop-color="#0a2128"/>
    </radialGradient>
    <radialGradient id="vign" cx="50%" cy="40%" r="80%">
      <stop offset="0%" stop-color="#16161b"/><stop offset="100%" stop-color="${BG}"/>
    </radialGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <marker id="ah"  markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="${CYAN}"/></marker>
    <marker id="aha" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="${AMBER}"/></marker>
    <marker id="ahc" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto-start-reverse"><path d="M0,0 L9,4 L0,8 Z" fill="${CYAN}"/></marker>
  </defs>

  <rect width="1280" height="720" fill="url(#vign)"/>
  ${header('이슈 기반 AI 개발 자동화 플랫폼','이슈 등록·수집 → AI 처리 → MR/PR·CI/CD 반영 → 검증·확인 → Slack 협업 → 통계 리포트')}

  <!-- ===== Flow arrows ===== -->
  <!-- ① 등록 (개발자/링크) · ② 수집 (cyan) -->
  <path d="M175,192 L175,278"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>   <!-- ① dev->git -->
  <path d="M340,448 C300,430 270,410 232,384"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>   <!-- ① link->git -->
  <path d="M290,332 C400,332 480,366 557,378"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>   <!-- ② git->IVE -->
  <path d="M640,304 L640,222"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>   <!-- ③ IVE->CLI -->
  <path d="M845,160 C950,168 1012,230 1080,290" fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>   <!-- ④ CLI->verify -->
  <path d="M982,381 C890,392 800,392 726,388"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>   <!-- ⑤ verify->IVE -->
  <!-- 산출/전달 (자동 흐름 → cyan) -->
  <path d="M676,456 C720,500 745,548 758,584"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/> <!-- ⑥ IVE->report -->
  <path d="M901,637 L928,637"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/> <!-- ⑦ report->manager -->
  <!-- 코드 전달 (자동 흐름 → cyan) -->
  <path d="M470,206 C360,224 250,250 210,281"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/> <!-- A cli->git MR/PR -->
  <path d="M175,382 L175,562"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/> <!-- B git->ci/cd -->
  <!-- Slack realtime (cyan dashed, bidirectional) -->
  <path d="M468,586 C505,556 540,500 585,456"   fill="none" stroke="${CYAN}" stroke-width="2" stroke-dasharray="6 5" marker-start="url(#ahc)" marker-end="url(#ahc)"/>

  <!-- ===== Central HUB: IVE ===== -->
  <circle cx="640" cy="388" r="106" fill="${CYAN}" opacity="0.08" filter="url(#glow)"/>
  <rect x="561" y="309" width="158" height="158" rx="32" fill="#101016" stroke="${CYAN}" stroke-width="2.5"/>
  <rect x="571" y="319" width="138" height="138" rx="24" fill="none" stroke="#23232a" stroke-width="2"/>
  ${text(640,400,'IVE',{size:56,fill:CYAN,weight:800,ls:2})}
  <text x="640" y="433" font-size="20" font-weight="700" text-anchor="middle" font-family="system-ui"><tspan fill="${SPRING}">Spring</tspan><tspan fill="${AMBER}">ware</tspan></text>
  ${text(640,503,'오케스트레이터',{size:11.5,fill:MUT,weight:700})}

  <!-- ===== DEVELOPER ===== -->
  ${card(60,100,230,92,{stroke:AMBER})}
  <g transform="translate(86,126)" stroke="${AMBER}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13,2 L3,15 L13,28"/><path d="M31,2 L41,15 L31,28"/><path d="M27,0 L17,30"/>
  </g>
  ${text(148,134,'개발자',{anchor:'start',size:17,fill:TXT})}
  ${text(148,158,'IDE · 바이브 코딩 툴',{anchor:'start',size:12,fill:MUT,weight:600})}

  <!-- ===== GIT repos (with provider logos) ===== -->
  ${card(60,286,230,96)}
  <g transform="translate(86,312)">
    <circle cx="8" cy="6" r="6.5" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
    <circle cx="8" cy="34" r="6.5" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
    <circle cx="34" cy="20" r="6.5" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
    <path d="M8,12 L8,28 M8,28 C8,23 14,20 27,20 M8,12 C8,17 14,20 27,20" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
  </g>
  ${text(140,318,'Git 저장소',{anchor:'start',size:17,fill:TXT})}
  <image href="${gitlab}" x="140" y="330" width="15" height="15"/>
  ${text(159,343,'GitLab',{anchor:'start',size:12,fill:MUT,weight:700})}
  <image href="${github}" x="214" y="330" width="15" height="15"/>
  ${text(233,343,'GitHub',{anchor:'start',size:12,fill:MUT,weight:700})}
  ${text(140,366,'이슈 · MR/PR · 버전 관리',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- ===== CI/CD + 운영 반영 ===== -->
  ${card(60,565,230,120,{stroke:CYAND})}
  <g transform="translate(86,584)" stroke="${CYAN}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11,3 L11,23 M3,12 L11,3 L19,12"/><path d="M2,30 L20,30"/>
  </g>
  ${text(150,598,'CI/CD · 자동 배포',{anchor:'start',size:17,fill:TXT})}
  ${text(86,626,'MR/PR 병합 → 자동 빌드',{anchor:'start',size:12.5,fill:MUT,weight:600})}
  <rect x="86" y="640" width="172" height="26" rx="13" fill="${BG}" stroke="${CYAND}" stroke-width="1.2"/>
  ${text(99,657,'운영 시스템 자동 반영',{anchor:'start',size:12.5,fill:TXT,weight:700})}

  <!-- ===== IVE 수집 링크 (확인자·고객·운영시스템 → Git 이슈 등록) ===== -->
  ${card(300,448,230,96,{stroke:AMBER})}
  <g transform="translate(316,464)" stroke="${AMBER}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11,1 L11,15 M5,9 L11,15 L17,9"/><path d="M2,19 L2,23 L22,23 L22,19"/>
  </g>
  ${text(352,470,'IVE 수집 링크',{anchor:'start',size:16,fill:TXT})}
  ${text(316,498,'확인자 · 고객 · 운영 시스템',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(316,518,'요청 수집 → Git 이슈 등록',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- ===== CLI agents ===== -->
  ${card(435,92,410,126,{stroke:CYAND})}
  ${text(640,118,'AI CLI 에이전트',{size:18,fill:TXT})}
  ${text(640,137,'IVE가 이슈 배정 → 코드 작성·수정 → MR/PR 생성',{size:11.5,fill:MUT,weight:600})}
  ${[['Claude',claude],['Codex',codex],['Gemini',gemini],['OpenCode',opencode]].map((a,i)=>{
     const x=470+i*90; return `
     <rect x="${x}" y="150" width="68" height="50" rx="12" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
     <image href="${a[1]}" x="${x+19}" y="153" width="30" height="30"/>
     ${text(x+34,194,a[0],{size:11,fill:TXT,weight:700})}`;
   }).join('')}

  <!-- ===== VERIFY / CONFIRM ===== -->
  ${card(982,296,234,170,{stroke:AMBER})}
  ${text(1099,324,'검증 · 확인',{size:18,fill:TXT})}
  <g transform="translate(1004,342)">
    <circle cx="11" cy="11" r="11" fill="none" stroke="${AMBER}" stroke-width="2.2"/>
    <path d="M6,11 L10,15 L17,7" fill="none" stroke="${AMBER}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${text(1036,357,'검증자 — 코드 리뷰',{anchor:'start',size:13.5,fill:TXT})}
  <g transform="translate(1004,384)">
    <circle cx="9" cy="9" r="8" fill="none" stroke="${AMBER}" stroke-width="2.2"/>
    <path d="M15,15 L21,21" stroke="${AMBER}" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  ${text(1036,399,'확인자 — 결과물 검증',{anchor:'start',size:13.5,fill:TXT})}
  <line x1="1006" y1="416" x2="1192" y2="416" stroke="${BORDER}" stroke-width="1"/>
  ${text(1099,442,'통과 → MR 병합 · 이슈 종료',{size:12,fill:MUT,weight:600})}

  <!-- ===== SLACK ===== -->
  ${card(300,588,286,98,{stroke:CYAND})}
  <rect x="318" y="606" width="58" height="58" rx="14" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
  <image href="${slack}" x="327" y="615" width="40" height="40"/>
  ${text(390,620,'Slack 연동',{anchor:'start',size:16,fill:TXT})}
  ${text(390,642,'코드베이스를 아는 에이전트와',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(390,661,'다자간 대화로 실시간 업무 수행',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- ===== REPORT / MAIL ===== -->
  ${card(615,588,286,98,{stroke:CYAND})}
  <g transform="translate(637,614)">
    <rect x="0" y="20" width="8" height="18" fill="${CYAN}"/><rect x="13" y="10" width="8" height="28" fill="${CYAN}"/><rect x="26" y="0" width="8" height="38" fill="${CYAN}"/>
  </g>
  ${text(689,620,'보고서 · 통계',{anchor:'start',size:16,fill:TXT})}
  ${text(689,642,'처리량·토큰·비용·가동률 집계',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(689,661,'정기 메일 자동 발송',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- ===== MANAGER / C-Level ===== -->
  ${card(930,588,286,98,{stroke:AMBER})}
  <g transform="translate(952,608)" stroke="${AMBER}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="13" cy="9" r="8"/><path d="M0,34 C0,21 26,21 26,34"/>
  </g>
  ${text(994,620,'관리자 · C-Level',{anchor:'start',size:16,fill:TXT})}
  ${text(994,642,'정기 보고서 자동 수신',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(994,661,'경영 의사결정',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- ===== Badges & pills ===== -->
  ${badge(175,235,'1','작업 → 이슈 등록',150)}
  ${badge(300,430,'1','링크로 등록',116)}
  ${badge(408,330,'2','이슈 수집',104)}
  ${badge(640,260,'3','작업 배정·실행',132)}
  ${badge(1018,232,'4','결과 제출',104)}
  ${badge(858,378,'5','검증·확인 통과',136)}
  ${badge(742,524,'6','이력·통계',102)}
  ${badge(916,560,'7','리포트 전달',120)}
  ${pill(345,210,'MR/PR 자동 생성',156,CYAN)}
  ${pill(175,470,'병합·배포',104,CYAN)}
  ${pill(495,562,'다자간 대화',118,CYAN,true)}

  ${text(640,710,'IVE — Issue-driven aI deVelopment Engine · 한 장으로 보는 전체 운영 구조',{size:11.5,fill:DIM,weight:600})}
</svg>`; }

// ============================================================
// SLIDE 2 — 도입 효과 (Before → After)
// ============================================================
function bullet(x,y,s,color,tcolor){
  return `<circle cx="${x+4}" cy="${y-4}" r="3.4" fill="${color}"/>${text(x+18,y,s,{size:13,fill:tcolor,weight:700,anchor:'start'})}`;
}
function roleIcon(type){
  if(type==='dev') return `<path d="M12,5 L4,15 L12,25" /><path d="M28,5 L36,15 L28,25"/><path d="M24,3 L16,27"/>`;
  if(type==='qa')  return `<circle cx="15" cy="15" r="12"/><path d="M9,15 L13,19 L22,9" stroke-linecap="round" stroke-linejoin="round"/>`;
  if(type==='mgr') return `<circle cx="20" cy="11" r="8"/><path d="M6,30 C6,18 34,18 34,30"/>`;
  return '';
}
const COLS = [
  { name:'검증자 · 개발자', role:'코드 리뷰 · 핵심 설계', icon:'dev',
    before:['단순·반복 이슈까지 직접 코딩','코드 리뷰는 늘 뒷순위','잦은 컨텍스트 스위칭으로 소모'],
    after:['반복 작업은 AI 에이전트가 수행','코드 리뷰·핵심 설계에 집중','리뷰 게이트로 품질을 책임'] },
  { name:'확인자 · QA', role:'결과물 검수 · 최종 승인', icon:'qa',
    before:['완성될 때까지 마냥 대기','진행 상황 수동 추적·재촉','산출물 품질이 들쭉날쭉'],
    after:['Slack에서 진행 상황 실시간 확인','완성된 결과물만 검수·승인','필요한 작업은 IVE 수집 링크로 요청'] },
  { name:'관리자 · C-Level', role:'보고서 수신 · 의사결정', icon:'mgr',
    before:['생산성·비용 파악이 어려움','수기 취합 보고, 늘 지연','감(感)에 의존한 의사결정'],
    after:['처리량·토큰·비용 자동 집계','정기 리포트·메일 자동 수신','데이터 기반 의사결정'] },
];
const COLW=372, COLX=[64,454,844];
function column(x0,col){
  const cx=x0+COLW/2;
  return `
  ${card(x0,92,COLW,408)}
  <circle cx="${x0+40}" cy="132" r="23" fill="${BG}" stroke="${CYAN}" stroke-width="1.6"/>
  <g transform="translate(${x0+25},117)" stroke="${CYAN}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">${roleIcon(col.icon)}</g>
  ${text(x0+74,126,col.name,{size:18,fill:TXT,anchor:'start'})}
  ${text(x0+74,148,col.role,{size:12,fill:MUT,weight:600,anchor:'start'})}
  <line x1="${x0+18}" y1="166" x2="${x0+COLW-18}" y2="166" stroke="${BORDER}" stroke-width="1"/>

  ${card(x0+16,180,COLW-32,140,{fill:BEFORE_FILL,stroke:RED+'55',r:12})}
  ${text(x0+34,206,'도입 전',{size:12.5,fill:RED,weight:700,anchor:'start'})}
  ${col.before.map((b,i)=>bullet(x0+34,238+i*28,b,RED,MUT)).join('')}

  <g transform="translate(${cx},330)" stroke="${CYAN}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0,-6 L0,10"/><path d="M-7,3 L0,10 L7,3"/>
  </g>

  ${card(x0+16,352,COLW-32,138,{fill:AFTER_FILL,stroke:CYAN,r:12})}
  ${text(x0+34,378,'IVE 도입 후',{size:12.5,fill:CYAN,weight:700,anchor:'start'})}
  ${col.after.map((b,i)=>bullet(x0+34,408+i*28,b,CYAN,TXT)).join('')}
  `;
}
function impactIcon(type){
  if(type==='loop')  return `<path d="M4,14 A11,11 0 1 1 7,22"/><path d="M2,8 L4,14 L10,12"/>`;
  if(type==='eye')   return `<path d="M2,14 C8,5 20,5 26,14 C20,23 8,23 2,14 Z"/><circle cx="14" cy="14" r="4"/>`;
  if(type==='check') return `<path d="M3,14 L8,19 L17,8"/><path d="M13,18 L18,23 L27,10"/>`;
  if(type==='chart') return `<path d="M3,25 L25,25"/><rect x="5" y="16" width="5" height="9"/><rect x="13" y="10" width="5" height="15"/><rect x="21" y="4" width="5" height="21"/>`;
  return '';
}
const IMPACTS=[
  {icon:'loop', t1:'반복 업무 자동화', t2:'사람은 핵심 업무에 집중'},
  {icon:'eye',  t1:'전 과정 이력·비용', t2:'100% 가시화'},
  {icon:'check',t1:'검증·확인 2단계', t2:'품질을 보장'},
  {icon:'chart',t1:'AI 개발 생산성', t2:'정량 측정·관리'},
];
const IMPW=262, IMPX=[88,368,648,928];
function slideImpact(){ return `
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="vign2" cx="50%" cy="38%" r="85%">
      <stop offset="0%" stop-color="#16161b"/><stop offset="100%" stop-color="${BG}"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#vign2)"/>
  ${header('IVE 도입, 이렇게 달라집니다','역할별 Before → After, 그리고 조직의 변화')}

  ${COLS.map((c,i)=>column(COLX[i],c)).join('')}

  ${card(64,516,1152,172,{stroke:CYAND})}
  ${text(88,548,'IVE 도입으로 조직이 이렇게 바뀝니다',{size:17,fill:TXT,anchor:'start'})}
  ${text(640,548,'반복은 기계에게, 사람은 판단과 창의에',{size:12.5,fill:CYAN,weight:700})}
  ${IMPACTS.map((m,i)=>{const x=IMPX[i]; return `
    ${card(x,566,IMPW,104,{fill:BG,stroke:BORDER,r:12})}
    <circle cx="${x+44}" cy="618" r="24" fill="${CARD}" stroke="${CYAN}" stroke-width="1.4"/>
    <g transform="translate(${x+30},604)" stroke="${CYAN}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">${impactIcon(m.icon)}</g>
    ${text(x+84,612,m.t1,{size:15,fill:TXT,anchor:'start'})}
    ${text(x+84,634,m.t2,{size:13,fill:MUT,weight:600,anchor:'start'})}
  `;}).join('')}

  ${text(640,710,'Springware IVE — 사람의 시간을 핵심 가치로 되돌리는 AI 개발 자동화',{size:11.5,fill:DIM,weight:600})}
</svg>`; }

// ============================================================
// SLIDE 3 — 실제 운영 화면 (증거: 폰 목업)
// ============================================================
const RATIO = 2300/960; // 캡처 portrait 비율
function phone(x,y,W,img,clipId){
  const pad=8, iw=W-2*pad, ih=Math.round(iw*RATIO), H=ih+2*pad;
  return `
  <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="22" fill="#050507" stroke="${BORDER}" stroke-width="1.5"/>
  <clipPath id="${clipId}"><rect x="${x+pad}" y="${y+pad}" width="${iw}" height="${ih}" rx="13"/></clipPath>
  <image href="${img}" x="${x+pad}" y="${y+pad}" width="${iw}" height="${ih}" clip-path="url(#${clipId})"/>`;
}
const SCREENS=[
  {img:scrProjects,t:'프로젝트 현황',s:'스캐너 · 단계별 처리'},
  {img:scrAgents,  t:'에이전트 · 검증자',s:'CLI 4종 + 검토 인력'},
  {img:scrIssues,  t:'이슈 처리 이력',s:'실제 처리 369건'},
  {img:scrReports, t:'주간 리포트',s:'처리량 · 비용 · 가동률'},
];
function slideScreens(){
  const W=210, pad=8, iw=W-2*pad, ih=Math.round(iw*RATIO), H=ih+2*pad;
  const gap=(1152-4*W)/3, y=124;
  return `
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="vign3" cx="50%" cy="40%" r="85%"><stop offset="0%" stop-color="#16161b"/><stop offset="100%" stop-color="${BG}"/></radialGradient></defs>
  <rect width="1280" height="720" fill="url(#vign3)"/>
  ${header('실제 운영 화면','운영계(ive.dazzleat.link) 실측 캡처 — 도식이 아닌, 지금 동작 중인 제품')}
  ${SCREENS.map((sc,i)=>{const x=64+i*(W+gap);return `
    ${phone(x,y,W,sc.img,'ph'+i)}
    ${text(x+W/2,y+H+26,sc.t,{size:15,fill:TXT})}
    ${text(x+W/2,y+H+46,sc.s,{size:12,fill:MUT,weight:600})}
  `;}).join('')}
  ${text(640,712,'실제 운영 데이터 캡처 — 가공·연출 없음',{size:11.5,fill:DIM,weight:600})}
</svg>`;
}

// ============================================================
// SLIDE 0 — 표지 (Cover · 한 줄 결과 약속)
// ============================================================
function slideCover(){
  const ECO=[['Claude',claude],['Codex',codex],['Gemini',gemini],['OpenCode',opencode],['GitLab',gitlab],['GitHub',github],['Slack',slack]];
  const tw=44,tg=14,n=ECO.length,totalW=n*tw+(n-1)*tg,sx=640-totalW/2,ly=556;
  const CH=[['기존 스택 그대로',176,447],['사람이 최종 검토',176,640],['비용·성과 자동 측정',188,833]];
  return `
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="cv" cx="50%" cy="32%" r="82%"><stop offset="0%" stop-color="#12202a"/><stop offset="58%" stop-color="#0e1419"/><stop offset="100%" stop-color="${BG}"/></radialGradient>
    <filter id="cglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1280" height="720" fill="url(#cv)"/>
  <text x="1216" y="50" font-size="17" font-weight="700" text-anchor="end" font-family="system-ui"><tspan fill="${SPRING}">Spring</tspan><tspan fill="${AMBER}">ware</tspan></text>
  ${text(1216,70,'PRODUCT BRIEF · 2026',{anchor:'end',size:11,fill:DIM,weight:700,ls:1.5})}

  <circle cx="640" cy="196" r="118" fill="${CYAN}" opacity="0.08" filter="url(#cglow)"/>
  <rect x="556" y="116" width="168" height="168" rx="34" fill="#101016" stroke="${CYAN}" stroke-width="2.5"/>
  <rect x="567" y="127" width="146" height="146" rx="26" fill="none" stroke="#23232a" stroke-width="2"/>
  ${text(640,210,'IVE',{size:62,fill:CYAN,weight:800,ls:2})}
  <text x="640" y="248" font-size="22" font-weight="700" text-anchor="middle" font-family="system-ui"><tspan fill="${SPRING}">Spring</tspan><tspan fill="${AMBER}">ware</tspan></text>

  ${text(640,358,'이슈만 올리면, AI가 개발한다',{size:46,fill:TXT,weight:800})}
  ${text(640,396,'AI CLI 에이전트가 Git 이슈를 자동 처리하고, 사람은 검토·결정만 — 처리량·비용은 자동 측정.',{size:16,fill:'#b4b4bc',weight:600})}

  ${CH.map(([l,w,cx])=>`<rect x="${cx-w/2}" y="440" width="${w}" height="32" rx="16" fill="${BG}" stroke="${CYAN}" stroke-width="1.3"/>${text(cx,461,l,{size:13.5,fill:TXT,weight:700})}`).join('')}

  ${text(640,532,'함께 동작',{size:12,fill:DIM,weight:700,ls:2})}
  ${ECO.map((e,i)=>{const x=sx+i*(tw+tg);return `<rect x="${x}" y="${ly}" width="${tw}" height="${tw}" rx="11" fill="${BG}" stroke="${BORDER}" stroke-width="1"/><image href="${e[1]}" x="${x+9}" y="${ly+9}" width="26" height="26"/>`;}).join('')}

  ${text(640,650,'Issue-driven aI deVelopment Engine',{size:13,fill:MUT,weight:700,ls:1})}
  ${text(640,690,'GitLab · GitHub   |   Claude · Codex · Gemini · OpenCode   |   Slack   |   Docker · 온프레미스',{size:11.5,fill:DIM,weight:600})}
</svg>`;
}

// ============================================================
// SLIDE 4 — POC 제안 (CTA)
// ============================================================
function slidePOC(){
  const COLS=[
    {t:'스코프 — 작게 시작',ic:'scope',b:['저장소 1개 · 2주','이슈에 라벨만 부착','온프레미스 · Docker','기존 AI 구독 그대로']},
    {t:'성공 기준 — 사전 합의',ic:'chart',b:['이슈 자동 처리율','리드타임 단축 %','검토 통과율','주간 집계 리포트 산출']},
    {t:'리스크 제거 — 안전',ic:'shield',b:['사람의 최종 검토 게이트','데이터 온프레미스 보관','벤더 락인 없음','즉시 롤백 가능']},
  ];
  const X=[64,454,844],W=372;
  const icon=t=> t==='scope'?`<circle cx="14" cy="14" r="12"/><circle cx="14" cy="14" r="4.5"/>`
    : t==='chart'?`<path d="M3,25 L25,25"/><rect x="5" y="15" width="5" height="10"/><rect x="13" y="9" width="5" height="16"/><rect x="21" y="4" width="5" height="21"/>`
    : `<path d="M14,2 L25,7 V15 C25,22 20,26 14,28 C8,26 3,22 3,15 V7 Z"/><path d="M9,15 l4,4 l7,-8"/>`;
  return `
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="pv" cx="50%" cy="38%" r="85%"><stop offset="0%" stop-color="#16161b"/><stop offset="100%" stop-color="${BG}"/></radialGradient>
    <marker id="pah" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${CYAN}"/></marker>
  </defs>
  <rect width="1280" height="720" fill="url(#pv)"/>
  ${header('지금 시작하기 — 바로 체험, 필요하면 POC',"운영 서비스로 즉시 테스트 → 조직 도입은 2주 POC로 확장")}

  ${badge(360,120,'1','가입·Git 연동',162)}
  ${badge(640,120,'2','저장소·이슈 연결',176)}
  ${badge(920,120,'3','자동 처리·리포트',176)}
  <path d="M448,120 L544,120" stroke="${CYAN}" stroke-width="2" marker-end="url(#pah)"/>
  <path d="M736,120 L826,120" stroke="${CYAN}" stroke-width="2" marker-end="url(#pah)"/>

  ${COLS.map((c,i)=>{const x=X[i];return `
    ${card(x,170,W,330)}
    <circle cx="${x+42}" cy="210" r="22" fill="${BG}" stroke="${CYAN}" stroke-width="1.5"/>
    <g transform="translate(${x+28},196)" stroke="${CYAN}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">${icon(c.ic)}</g>
    ${text(x+78,206,c.t,{size:16,fill:TXT,anchor:'start'})}
    <line x1="${x+24}" y1="238" x2="${x+W-24}" y2="238" stroke="${BORDER}" stroke-width="1"/>
    ${c.b.map((b,j)=>bullet(x+30,280+j*42,b,CYAN,TXT)).join('')}
  `;}).join('')}

  ${card(64,524,1152,150,{stroke:CYAN,fill:'#0f1f24'})}
  ${text(640,566,'회원가입 또는 GitHub·GitLab 계정 연동으로 지금 바로 테스트하세요.',{size:22,fill:TXT,weight:800})}
  ${text(640,596,'운영 중인 서비스에서 즉시 체험 → 필요하면 2주 POC로 확장합니다.',{size:13.5,fill:'#b4b4bc',weight:600})}
  <rect x="297" y="620" width="330" height="38" rx="19" fill="${CYAN}"/>
  ${text(462,644,'지금 가입·연동하고 체험   ive.dazzleat.link',{size:13,fill:'#06262e',weight:800})}
  <rect x="643" y="620" width="340" height="38" rx="19" fill="${BG}" stroke="${CYAN}" stroke-width="1.4"/>
  ${text(813,644,'POC·도입 문의   springware.koj@gmail.com',{size:13,fill:TXT,weight:700})}
</svg>`;
}

// ============================================================
// HTML wrappers
// ============================================================
const PAGE_CSS = `
 @page { size: 13.333in 7.5in; margin: 0; }
 * { margin:0; padding:0; box-sizing:border-box; }
 html,body { background:${BG}; }
 .page { width:1280px; height:720px; background:${BG}; overflow:hidden; page-break-after: always; }
 .page:last-child { page-break-after: auto; }
 svg { display:block; width:1280px; height:720px; }`;

const single = (svg) => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${PAGE_CSS}
 html,body{width:1280px;height:720px;overflow:hidden;}</style></head><body><div class="page">${svg}</div></body></html>`;
const multi = (svgs) => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body>${svgs.map(s=>`<div class="page">${s}</div>`).join('')}</body></html>`;

const cover = slideCover(), ov = slideOverview(), scr = slideScreens(), im = slideImpact(), poc = slidePOC();
fs.writeFileSync(path.join(__dirname,'ive-cover.html'),    single(cover));
fs.writeFileSync(path.join(__dirname,'ive-overview.html'), single(ov));
fs.writeFileSync(path.join(__dirname,'ive-screens.html'),  single(scr));
fs.writeFileSync(path.join(__dirname,'ive-impact.html'),   single(im));
fs.writeFileSync(path.join(__dirname,'ive-poc.html'),      single(poc));
fs.writeFileSync(path.join(__dirname,'ive-brochure.html'), multi([cover, ov, scr, im, poc]));
console.log('built: cover, overview, screens, impact, poc, brochure(5p)');
