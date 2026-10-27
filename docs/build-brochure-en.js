/*
 * IVE Product Brochure (English Version) Builder
 * Output: docs/ive-overview-en.html, docs/ive-screens-en.html
 */
const fs = require('fs');
const path = require('path');

function dataUri(rel, mime) {
  const buf = fs.readFileSync(path.join(__dirname, rel));
  return `data:${mime};base64,` + buf.toString('base64');
}
function iconPath(rel){
  const svg = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  return svg.match(/ d="([^"]+)"/)[1];
}
const vscodeP = iconPath('assets/ide/vscode.svg');
const antigravity = dataUri('assets/ide/antigravity.png','image/png');
const PM = [
  ['Linear', iconPath('assets/pm/linear.svg'), '#5E6AD2'],
  ['Jira',   iconPath('assets/pm/jira.svg'),   '#2684FF'],
  ['Asana',  iconPath('assets/pm/asana.svg'),  '#F06A6A'],
  ['Notion', iconPath('assets/pm/notion.svg'), '#e4e4e7'],
];
const cursorP = iconPath('assets/ide/cursor.svg');
const claude   = dataUri('../public/cli/claude.svg',     'image/svg+xml');
const codex    = dataUri('../public/cli/codex.png',      'image/png');
const agy      = dataUri('../public/cli/agy.png',        'image/png');
const opencode = dataUri('../public/cli/opencode.svg',   'image/svg+xml');
const slack    = dataUri('assets/slack.svg',             'image/svg+xml');
const iveLogo  = dataUri('../public/slack-icon-1024.png','image/png');
const github   = dataUri('assets/github.svg',            'image/svg+xml');
const gitlab   = dataUri('assets/gitlab.svg',            'image/svg+xml');
const scrProjects = dataUri('assets/screens/projects.png','image/png');
const scrAgents   = dataUri('assets/screens/agents.png',  'image/png');
const scrIssues   = dataUri('assets/screens/issues.png',  'image/png');
const scrReports  = dataUri('assets/screens/reports.png', 'image/png');

const BG='#0e0e11', CARD='#1c1c20', BORDER='#2a2a31',
      CYAN='#22d3ee', CYAND='#0891b2', AMBER='#f59e0b', SPRING='#22c55e', RED='#ef4444',
      TXT='#e4e4e7', MUT='#8b8b93', DIM='#5b5b63';
const FF=`font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"`;

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
    <text x="${x+15}" y="${cy+4}" font-size="${String(num).length>2?8.5:String(num).length>1?10:12}" font-weight="800" fill="${BG}" text-anchor="middle" font-family="system-ui">${num}</text>
    <text x="${x+30}" y="${cy+4.5}" font-size="11.5" font-weight="700" fill="${TXT}" text-anchor="start" ${FF}>${label}</text>
  </g>`;
}
function badge2(cx,cy,num,l1,l2,w,color=CYAN){
  const h=44, x=cx-w/2;
  return `<g>
    <rect x="${x}" y="${cy-h/2}" width="${w}" height="${h}" rx="16" fill="${BG}" stroke="${color}" stroke-width="1.2"/>
    <circle cx="${x+15}" cy="${cy}" r="9" fill="${color}"/>
    <text x="${x+15}" y="${cy+4}" font-size="12" font-weight="800" fill="${BG}" text-anchor="middle" font-family="system-ui">${num}</text>
    <text x="${x+30}" y="${cy-3}" font-size="11.5" font-weight="700" fill="${TXT}" text-anchor="start" ${FF}>${l1}</text>
    <text x="${x+30}" y="${cy+15}" font-size="11.5" font-weight="700" fill="${TXT}" text-anchor="start" ${FF}>${l2}</text>
  </g>`;
}
function pill(cx,cy,label,w,color,dashed){
  const h=26, x=cx-w/2, da=dashed?` stroke-dasharray="5 4"`:'';
  return `<g>
    <rect x="${x}" y="${cy-h/2}" width="${w}" height="${h}" rx="13" fill="${BG}" stroke="${color}" stroke-width="1.2"${da}/>
    <circle cx="${x+15}" cy="${cy}" r="4" fill="${color}"/>
    <text x="${x+27}" y="${cy+4.5}" font-size="11.5" font-weight="700" fill="${TXT}" text-anchor="start" ${FF}>${label}</text>
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
// SLIDE 1 — Architecture Overview
// ============================================================
function slideOverviewEN(){ return `
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
    <marker id="ahc" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto-start-reverse"><path d="M0,0 L9,4 L0,8 Z" fill="${CYAN}"/></marker>
    <marker id="ahm" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="${MUT}"/></marker>
  </defs>

  <rect width="1280" height="720" fill="url(#vign)"/>
  ${header('Issue-Driven Autonomous AI Development Platform','Issue Intake → AI Agent Execution → Review & Merge → Staging Validation → Production Release → Analytics')}

  <!-- Flow arrows -->
  <path d="M177,222 L177,278"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M340,440 C302,426 270,408 232,384"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M290,332 C400,332 480,366 557,378"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M640,304 L640,226"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M756,222 C752,254 716,274 682,302"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M721,348 C800,334 900,328 978,324"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M982,372 C900,382 800,382 726,376"   fill="none" stroke="${MUT}" stroke-width="2" marker-end="url(#ahm)"/>
  <path d="M982,410 C900,418 800,418 726,412"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M982,448 C900,454 800,454 726,450"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M676,456 C720,500 745,548 758,584"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M901,637 L928,637"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M470,206 C360,224 250,250 210,281"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M556,432 C470,428 380,404 298,378"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M177,382 L177,434"                   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>
  <path d="M600,470 C580,510 552,552 528,584"   fill="none" stroke="${CYAN}" stroke-width="2" marker-end="url(#ah)"/>

  <!-- Central HUB: IVE -->
  <circle cx="640" cy="388" r="106" fill="${CYAN}" opacity="0.08" filter="url(#glow)"/>
  <rect x="561" y="309" width="158" height="158" rx="32" fill="#101016" stroke="${CYAN}" stroke-width="2.5"/>
  <rect x="571" y="319" width="138" height="138" rx="24" fill="none" stroke="#23232a" stroke-width="2"/>
  ${text(640,400,'IVE',{size:56,fill:CYAN,weight:800,ls:2})}
  <text x="640" y="433" font-size="20" font-weight="700" text-anchor="middle" font-family="system-ui"><tspan fill="${SPRING}">Spring</tspan><tspan fill="${AMBER}">ware</tspan></text>
  ${text(640,485,'Orchestrator Core',{size:11.5,fill:MUT,weight:700})}

  <!-- DEVELOPER -->
  ${card(64,96,226,126,{stroke:AMBER})}
  <g transform="translate(90,112)" stroke="${AMBER}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13,2 L3,15 L13,28"/><path d="M31,2 L41,15 L31,28"/><path d="M27,0 L17,30"/>
  </g>
  ${text(152,122,'Engineers',{anchor:'start',size:17,fill:TXT})}
  ${text(152,144,'IDE & Vibe Coding Tools',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${[0,1,2].map(i=>{
     const x=76+i*70, y=156;
     const inner = i===0
       ? `<path transform="translate(${x+20},${y+6}) scale(0.917)" d="${vscodeP}" fill="#0098FF"/>`
       : i===1
       ? `<path transform="translate(${x+20},${y+6}) scale(0.917)" d="${cursorP}" fill="${TXT}"/>`
       : `<image href="${antigravity}" x="${x+20}" y="${y+7}" width="24" height="22"/>`;
     const name = ['VS Code','Cursor','Antigravity'][i];
     return `
     <rect x="${x}" y="${y}" width="64" height="48" rx="12" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
     ${inner}
     ${text(x+32,y+40,name,{size:9.5,fill:MUT,weight:700})}`;
   }).join('')}

  <!-- GIT repos -->
  ${card(64,286,226,96)}
  <g transform="translate(90,312)">
    <circle cx="8" cy="6" r="6.5" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
    <circle cx="8" cy="34" r="6.5" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
    <circle cx="34" cy="20" r="6.5" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
    <path d="M8,12 L8,28 M8,28 C8,23 14,20 27,20 M8,12 C8,17 14,20 27,20" fill="none" stroke="${CYAN}" stroke-width="2.2"/>
  </g>
  ${text(144,318,'Git Repositories',{anchor:'start',size:17,fill:TXT})}
  <image href="${gitlab}" x="144" y="330" width="15" height="15"/>
  ${text(163,343,'GitLab',{anchor:'start',size:12,fill:MUT,weight:700})}
  <image href="${github}" x="218" y="330" width="15" height="15"/>
  ${text(237,343,'GitHub',{anchor:'start',size:12,fill:MUT,weight:700})}
  ${text(144,366,'Issues · MR/PR · Git Ops',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- CI/CD Pipeline -->
  ${card(64,440,226,246,{stroke:CYAND})}
  <g transform="translate(88,462)" stroke="${CYAN}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11,3 L11,23 M3,12 L11,3 L19,12"/><path d="M2,30 L20,30"/>
  </g>
  ${text(152,478,'CI/CD & Deploy',{anchor:'start',size:16,fill:TXT})}
  ${text(90,508,'Merged MR/PR → Auto Build',{anchor:'start',size:12,fill:MUT,weight:600})}

  <rect x="92" y="516" width="170" height="32" rx="12" fill="${BG}" stroke="${CYAND}" stroke-width="1.4"/>
  ${text(177,537,'Deploy to Staging',{size:13,fill:TXT,weight:700})}
  <path d="M171,552 L183,552 L177,561 Z" fill="${CYAN}"/>

  <rect x="92" y="566" width="170" height="32" rx="12" fill="${BG}" stroke="${AMBER}" stroke-width="1.4"/>
  <g transform="translate(104,574)">
    <circle cx="7" cy="7" r="6.4" fill="none" stroke="${AMBER}" stroke-width="1.8"/>
    <path d="M4,7 L6.2,9.2 L10.2,4.8" fill="none" stroke="${AMBER}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${text(125,586,'QA Sign-off & Audit',{anchor:'start',size:12,fill:AMBER,weight:700})}
  <path d="M171,602 L183,602 L177,611 Z" fill="${AMBER}"/>

  <rect x="92" y="616" width="170" height="32" rx="12" fill="${BG}" stroke="${CYAN}" stroke-width="1.6"/>
  ${text(177,637,'Production Release',{size:13,fill:TXT,weight:700})}
  ${text(177,670,'Only verified code deployed',{size:11.5,fill:DIM,weight:600})}

  <!-- IVE Open API -->
  ${card(300,440,230,96,{stroke:AMBER})}
  <g transform="translate(314,453)" stroke="${AMBER}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9,1 C4,1 6,10 1,12 C6,14 4,23 9,23"/>
    <path d="M21,1 C26,1 24,10 29,12 C24,14 26,23 21,23"/>
    <path d="M11,12 L18,12 M15.5,9 L18.5,12 L15.5,15"/>
  </g>
  ${text(352,462,'IVE Open API',{anchor:'start',size:16,fill:TXT})}
  ${text(316,490,'QA · Stakeholders · Services',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(316,510,'API Request → Git Issue Created',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- CLI agents -->
  ${card(435,96,410,126,{stroke:CYAND})}
  ${text(640,122,'Autonomous AI Agents',{size:18,fill:TXT})}
  ${text(640,141,'IVE Assigns Task → Writes Code → Tests → Opens MR/PR',{size:11.5,fill:MUT,weight:600})}
  ${[['Claude',claude],['Codex',codex],['agy',agy],['OpenCode',opencode]].map((a,i)=>{
     const x=470+i*90; return `
     <rect x="${x}" y="156" width="68" height="48" rx="12" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
     <image href="${a[1]}" x="${x+19}" y="161" width="30" height="30"/>
     ${text(x+34,199,a[0],{size:11,fill:TXT,weight:700})}`;
   }).join('')}

  <!-- VERIFY / CONFIRM -->
  ${card(982,296,234,170,{stroke:AMBER})}
  ${text(1099,324,'Review & Verification',{size:18,fill:TXT})}
  <g transform="translate(1004,342)">
    <circle cx="11" cy="11" r="11" fill="none" stroke="${AMBER}" stroke-width="2.2"/>
    <path d="M6,11 L10,15 L17,7" fill="none" stroke="${AMBER}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${text(1036,357,'Reviewer — Code Review',{anchor:'start',size:13.5,fill:TXT})}
  <g transform="translate(1004,384)">
    <circle cx="9" cy="9" r="8" fill="none" stroke="${AMBER}" stroke-width="2.2"/>
    <path d="M15,15 L21,21" stroke="${AMBER}" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  ${text(1036,399,'Sign-off — Staging Proof',{anchor:'start',size:13.5,fill:TXT})}
  <line x1="1006" y1="416" x2="1192" y2="416" stroke="${BORDER}" stroke-width="1"/>
  ${text(1099,442,'Pass → Auto-merge & Close Issue',{size:12,fill:MUT,weight:600})}

  <!-- SLACK -->
  ${card(300,588,286,98,{stroke:CYAND})}
  <rect x="318" y="606" width="58" height="58" rx="14" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
  <image href="${slack}" x="327" y="615" width="40" height="40"/>
  ${text(390,620,'Slack Integration',{anchor:'start',size:16,fill:TXT})}
  ${text(390,642,'Interactive AI bot with repo context',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(390,661,'Real-time alerts & thread dispatch',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- REPORT / MAIL -->
  ${card(615,588,286,98,{stroke:CYAND})}
  <g transform="translate(637,614)">
    <rect x="0" y="20" width="8" height="18" fill="${CYAN}"/><rect x="13" y="10" width="8" height="28" fill="${CYAN}"/><rect x="26" y="0" width="8" height="38" fill="${CYAN}"/>
  </g>
  ${text(689,620,'Analytics & Reports',{anchor:'start',size:16,fill:TXT})}
  ${text(689,642,'Lead times, tokens, costs & ROI',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(689,661,'Scheduled automated report emails',{anchor:'start',size:12,fill:TXT,weight:700})}

  <!-- MANAGER / C-Level -->
  ${card(930,588,286,98,{stroke:AMBER})}
  <g transform="translate(952,608)" stroke="${AMBER}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="13" cy="9" r="8"/><path d="M0,34 C0,21 26,21 26,34"/>
  </g>
  ${text(994,620,'Engineering Leads & Execs',{anchor:'start',size:16,fill:TXT})}
  ${text(994,642,'Periodic executive summaries',{anchor:'start',size:12,fill:MUT,weight:600})}
  ${text(994,661,'Data-driven decision making',{anchor:'start',size:12,fill:TXT,weight:700})}

  <path d="M446,584 C480,545 520,505 566,470"   fill="none" stroke="${CYAN}" stroke-width="2" marker-start="url(#ahc)" marker-end="url(#ahc)"/>

  <!-- PLANNED -->
  <path d="M1010,224 C960,254 850,290 716,318" fill="none" stroke="${MUT}" stroke-width="1.8" stroke-dasharray="7 5" marker-end="url(#ahm)"/>
  ${card(930,96,286,126,{stroke:CYAND})}
  ${text(1073,122,'External PM Integration',{size:16,fill:TXT})}
  ${text(1073,144,'Sync issues, stage status & workflows',{size:11.5,fill:MUT,weight:600})}
  ${PM.map((m,i)=>{ const x=946+i*66, y=156; return `
     <rect x="${x}" y="${y}" width="60" height="48" rx="12" fill="${BG}" stroke="${BORDER}" stroke-width="1"/>
     <path transform="translate(${x+20},${y+9}) scale(0.833)" d="${m[1]}" fill="${m[2]}"/>
     ${text(x+30,y+40,m[0],{size:9,fill:MUT,weight:700})}`; }).join('')}
  ${pill(890,280,'Planned',96,MUT,true)}

  <!-- Badges & pills -->
  ${badge(177,242,'1','Register Issue',130)}
  ${badge(306,424,'1','API Intake',110)}
  ${badge(408,330,'2','Issue Intake',118)}
  ${badge(640,260,'3','Dispatch Agent',142)}
  ${badge2(360,214,'4','Git Branch','Open MR/PR',136)}
  ${badge(770,262,'5','Execution Done',140)}
  ${badge(437,411,'8','MR/PR Merged',134)}
  ${badge(177,399,'9','Auto Build',112)}
  ${badge(851,335,'6','Request Review',140)}
  ${badge(851,380,'6.5','Reject & Rework',146,MUT)}
  ${badge(851,416,'7','Approve Merge',136)}
  ${badge(851,453,'10','Production Pass',140)}
  ${badge(742,524,'11','Aggregate Logs',136)}
  ${badge(916,568,'12','Executive Report',148)}
  ${pill(582,512,'Send Alerts',104,CYAN)}
  ${pill(458,550,'Interactive Bot',122,CYAN)}

  ${text(640,710,'IVE — Issue-driven AI Development Engine · Complete Operational Architecture',{size:11.5,fill:DIM,weight:600})}
</svg>`; }

// ============================================================
// SLIDE 2 — Real Screen Previews
// ============================================================
const RATIO = 2300/960;
function phone(x,y,W,img,clipId){
  const pad=8, iw=W-2*pad, ih=Math.round(iw*RATIO), H=ih+2*pad;
  return `
  <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="22" fill="#050507" stroke="${BORDER}" stroke-width="1.5"/>
  <clipPath id="${clipId}"><rect x="${x+pad}" y="${y+pad}" width="${iw}" height="${ih}" rx="13"/></clipPath>
  <image href="${img}" x="${x+pad}" y="${y+pad}" width="${iw}" height="${ih}" clip-path="url(#${clipId})"/>`;
}
const SCREENS=[
  {img:scrProjects,t:'Project Management',s:'Multi-Repo Scanners & Branches'},
  {img:scrAgents,  t:'Agent Fleet & PTY',s:'CLI Agent Pools & Concurrency'},
  {img:scrIssues,  t:'Issue Kanban & Stages',s:'Live Terminal & Stage Progression'},
  {img:scrReports, t:'Productivity & ROI',s:'Lead-time, Tokens & Cost Analysis'},
];
function slideScreensEN(){
  const W=210, pad=8, iw=W-2*pad, ih=Math.round(iw*RATIO), H=ih+2*pad;
  const gap=(1152-4*W)/3, y=124;
  return `
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="vign3" cx="50%" cy="40%" r="85%"><stop offset="0%" stop-color="#16161b"/><stop offset="100%" stop-color="${BG}"/></radialGradient></defs>
  <rect width="1280" height="720" fill="url(#vign3)"/>
  ${header('Application Dashboard & Screens','Interactive Web Interface for Project Configuration, Agent Control, Kanban Tracking & Executive Reports')}
  ${SCREENS.map((sc,i)=>{const x=64+i*(W+gap);return `
    ${phone(x,y,W,sc.img,'ph'+i)}
    ${text(x+W/2,y+H+26,sc.t,{size:15,fill:TXT})}
    ${text(x+W/2,y+H+46,sc.s,{size:12,fill:MUT,weight:600})}
  `;}).join('')}
  ${text(640,712,'Springware IVE — Built with Next.js 16, React 19, Tailwind CSS 4 & xterm.js',{size:11.5,fill:DIM,weight:600})}
</svg>`;
}

const PAGE_CSS = `
 @page { size: 13.333in 7.5in; margin: 0; }
 * { margin:0; padding:0; box-sizing:border-box; }
 html,body { background:${BG}; width:1280px; height:720px; overflow:hidden; }
 .page { width:1280px; height:720px; background:${BG}; overflow:hidden; margin:0 auto; }
 svg { display:block; width:1280px; height:720px; }`;

const single = (svg) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body><div class="page">${svg}</div></body></html>`;

fs.writeFileSync(path.join(__dirname,'ive-overview-en.html'), single(slideOverviewEN()));
fs.writeFileSync(path.join(__dirname,'ive-screens-en.html'),  single(slideScreensEN()));
console.log('built English slides: ive-overview-en.html, ive-screens-en.html');
