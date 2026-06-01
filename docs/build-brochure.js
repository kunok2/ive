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
  ${card(60,100,230,92)}
  <g transform="translate(86,126)" stroke="${SPRING}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
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
  ${card(300,448,230,96,{stroke:CYAND})}
  <g transform="translate(316,464)" stroke="${CYAN}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
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
  <rect x="${x0+16}" y="180" width="4" height="140" rx="2" fill="${RED}"/>
  ${text(x0+34,206,'● 도입 전',{size:12.5,fill:RED,weight:700,anchor:'start'})}
  ${col.before.map((b,i)=>bullet(x0+34,238+i*28,b,RED,MUT)).join('')}

  <g transform="translate(${cx},330)" stroke="${CYAN}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0,-6 L0,10"/><path d="M-7,3 L0,10 L7,3"/>
  </g>

  ${card(x0+16,352,COLW-32,138,{fill:AFTER_FILL,stroke:CYAN,r:12})}
  <rect x="${x0+16}" y="352" width="4" height="138" rx="2" fill="${CYAN}"/>
  ${text(x0+34,378,'★ IVE 도입 후',{size:12.5,fill:CYAN,weight:700,anchor:'start'})}
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

const ov = slideOverview(), im = slideImpact();
fs.writeFileSync(path.join(__dirname,'ive-overview.html'), single(ov));
fs.writeFileSync(path.join(__dirname,'ive-impact.html'),   single(im));
fs.writeFileSync(path.join(__dirname,'ive-brochure.html'), multi([ov, im]));
console.log('built: ive-overview.html, ive-impact.html, ive-brochure.html');
