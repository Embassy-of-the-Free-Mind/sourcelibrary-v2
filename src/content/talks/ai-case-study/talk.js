/* Source Library talk deck v3. No dependencies. */
(function(){
const D=window.SL,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const fmt=n=>n.toLocaleString('en-US'),esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const tip=$('#tip');
function hover(el,text){el.addEventListener('mousemove',e=>{tip.innerHTML=text;tip.style.opacity=1;tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px'});el.addEventListener('mouseleave',()=>tip.style.opacity=0)}
const strip=s=>s.replace(/<(language|page-type|page-num|scan-quality|script|lang)>[\s\S]*?<\/\1>/g,'').replace(/<vocab>[\s\S]*?<\/vocab>/g,'').replace(/<detected-images>[\s\S]*?<\/detected-images>/g,'').replace(/<meta>[\s\S]*?<\/meta>/g,'').replace(/<insert>|<\/insert>/g,'').replace(/<gloss>(.*?)<\/gloss>/g,'').replace(/<note>(.*?)<\/note>/g,'').replace(/<[^>]+>/g,'').replace(/^#+ /gm,'').replace(/\*\*|\*   /g,'').replace(/-> (.*?) <-/g,'$1').trim();

/* theme */
const themeBtn=$('#theme');function setTheme(t){document.documentElement.dataset.theme=t;themeBtn.textContent=t==='dark'?'Light':'Dark';try{localStorage.setItem('sl-talk-theme',t)}catch(e){}}
setTheme(document.documentElement.dataset.theme||'light');themeBtn.addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));

/* big numbers */
function bignums(sel,items){if(!$(sel))return;$(sel).innerHTML=items.map(t=>`<div class="b ${t.c||''}"><div class="v" ${t.count!=null?`data-count="${t.count}" data-dec="${t.dec||0}" data-pre="${t.pre||''}" data-suf="${t.suf||''}"`:''}>${t.count!=null?(t.pre||'')+'0'+(t.suf||''):t.v}${t.u?`<span class="u">${t.u}</span>`:''}</div><div class="l">${t.l}</div></div>`).join('')}
function countUp(root){root.querySelectorAll('[data-count]').forEach(n=>{if(n._done)return;n._done=true;const to=+n.dataset.count,dec=+n.dataset.dec,pre=n.dataset.pre||'',suf=n.dataset.suf||'';const t0=performance.now(),dur=RM?0:1500;
  (function f(now){const p=Math.min(1,(now-t0)/dur||1),e=1-Math.pow(1-p,3);const v=to*e;n.firstChild.textContent=pre+(dec?v.toFixed(dec):fmt(Math.round(v)))+suf;if(p<1)requestAnimationFrame(f)})(t0)})}

if($('#hero-pills'))$('#hero-pills').innerHTML=[`<b>${fmt(D.scale.books)}</b> books`,`<b>${(D.scale.pages/1e6).toFixed(1)} million</b> pages`,`<b>${(D.scale.translated/1e6).toFixed(1)} million</b> translated`,`<b>${(D.storage.r2_bytes/1e12).toFixed(0)} TB</b> of scans`,`<b>~2,000</b> visitors a day`].map(p=>`<span class="pill">${p}</span>`).join('');
bignums('#scale-nums',[{count:D.scale.books,l:'books open to read'},{count:+(D.scale.pages/1e6).toFixed(1),dec:1,u:'M',l:'pages scanned'},{count:+(D.scale.translated/1e6).toFixed(1),dec:1,u:'M',l:'pages translated into English'},{count:D.scale.fully,l:'books translated cover to cover'}]);
if($('#cost-nums'))$('#cost-nums').innerHTML=`<div class="stat"><div class="v">$0.58</div><div class="l">median cost to read and translate one book</div></div><div class="stat"><div class="v">$${fmt(D.costTotal)}</div><div class="l">model spend, January to September, about 113,000 books</div></div><div class="stat"><div class="v">$28.94</div><div class="l">one 1,200-page folio</div></div>`;
if($('#collapse-nums'))$('#collapse-nums').innerHTML=`<div class="stat"><div class="v">4.25<small>M</small></div><div class="l">translated pages checked with one cheap signal</div></div><div class="stat"><div class="v">0.59<small>%</small></div><div class="l">collapsed, after correcting our own measurement twice</div></div><div class="stat"><div class="v">556</div><div class="l">pages repaired in published books, prior versions kept</div></div>`;
bignums('#who-nums',[{v:'77.9',u:'%',l:'of books have an author a reader can reach'},{v:'−7',c:'red',l:'net tier change after 133 hand checks: 35 up, 42 down'}]);
bignums('#feed-nums',[{count:4.9,dec:1,u:'M',l:'pages of pre-1900 thought, transcribed, translated, provenance-stamped, public domain'},{count:6155,l:'tool calls from AI agents in the last 30 days'},{count:53,l:'active dataset keys; 675 pulls returned 6.2 million records'},{count:28673,l:'hits from Anthropic’s crawler in 30 days; OpenAI 3,138; unidentified bots 586,000'}]);

/* chart kit */
function hbars(sel,rows,o={}){const el=$(sel);if(!el)return;const W=Math.max(420,el.clientWidth||o.w||560),rh=40,bh=22,lw=o.lw||150,vw=o.vw||110,max=o.max||Math.max(...rows.map(r=>r[1]));const H=rows.length*rh;
  let s=`<div class="ttl">${o.title||''}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMinYMin meet" role="img">`;
  rows.forEach((r,i)=>{const y=i*rh,bw=Math.max(2,(W-lw-vw)*(r[1]/max)),ex=r[2]||{};s+=`<g class="row" data-i="${i}"><text class="lab" x="${lw-14}" y="${y+rh/2+5}" text-anchor="end">${esc(r[0])}</text><rect class="bar ${ex.cls||''}" x="${lw}" y="${y+(rh-bh)/2}" width="${bw}" height="${bh}" style="transition-delay:${i*60}ms"/><text class="val" x="${lw+bw+10}" y="${y+rh/2+5}" style="transition-delay:${i*60+500}ms">${ex.label||(o.fmt?o.fmt(r[1]):fmt(r[1]))}</text></g>`});
  s+='</svg>'+(o.legend?`<div class="legend">${o.legend}</div>`:'');el.innerHTML=s;el.querySelectorAll('g.row').forEach(g=>{const r=rows[+g.dataset.i];hover(g,(r[2]&&r[2].tip)||`<b>${esc(r[0])}</b><br>${o.fmt?o.fmt(r[1]):fmt(r[1])}`)})}
function niceTicks(max,n){const raw=max/n,p=Math.pow(10,Math.floor(Math.log10(raw))),m=raw/p,step=(m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p;const t=[];for(let v=0;v<=max+step*.999;v+=step)t.push(+v.toFixed(6));return t}
function columns(sel,rows,o={}){const el=$(sel);if(!el)return;const W=Math.max(480,el.clientWidth||o.w||640),H=o.h||300,pad={l:52,r:6,t:16,b:30};const max=Math.max(...rows.map(r=>r[1]));const iw=W-pad.l-pad.r,ih=H-pad.t-pad.b,n=rows.length,slot=iw/n,bw=Math.min(36,slot*.5);const ticks=niceTicks(max,3);
  let s=`<div class="ttl">${o.title||''}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMinYMin meet" role="img">`;
  ticks.forEach(t=>{const y=pad.t+ih-(t/ticks.at(-1))*ih;s+=`<line class="grid" x1="${pad.l}" x2="${W-pad.r}" y1="${y}" y2="${y}"/><text class="mut" x="${pad.l-8}" y="${y+4}" text-anchor="end" font-size="12">${o.fmt?o.fmt(t):fmt(t)}</text>`});
  rows.forEach((r,i)=>{const h=(r[1]/ticks.at(-1))*ih,x=pad.l+i*slot+(slot-bw)/2,y=pad.t+ih-h;s+=`<g class="col" data-i="${i}"><rect x="${pad.l+i*slot}" y="${pad.t}" width="${slot}" height="${ih}" fill="transparent"/><rect class="bar ${r[2]||''}" x="${x}" y="${y}" width="${bw}" height="${h}" style="transition-delay:${i*60}ms"/><text class="mut" x="${x+bw/2}" y="${H-10}" text-anchor="middle" font-size="12">${esc(o.lab?o.lab(r[0]):r[0])}</text></g>`});
  if(o.marks)o.marks.forEach(m=>{const x=pad.l+m.i*slot+slot/2;s+=`<line x1="${x}" x2="${x}" y1="${pad.t}" y2="${pad.t+ih}" stroke="var(--ink)" stroke-dasharray="2 4" opacity=".6"/><text x="${x+6}" y="${pad.t+12}" font-size="12" fill="var(--ink2)" font-weight="600">${esc(m.t)}</text>`});
  s+='</svg>'+(o.legend?`<div class="legend">${o.legend}</div>`:'');el.innerHTML=s;el.querySelectorAll('g.col').forEach(g=>{const r=rows[+g.dataset.i];hover(g,`<b>${esc(r[0])}</b><br>${o.fmt?o.fmt(r[1]):fmt(r[1])}`)})}

const NONLATIN=new Set(['Chinese','Tibetan','Greek','Sanskrit','Russian','Persian','Hebrew','Arabic','Korean','Syriac','Armenian','Sumerian','Parthian','Japanese']);
hbars('#ch-langs',D.langs.filter(l=>!['Visual','Unknown'].includes(l[0])).slice(0,10).map(l=>[l[0],l[1],{cls:'blue',tip:`<b>${l[0]}</b><br>${fmt(l[1])} books · ${fmt(l[2])} pages`}]),{title:'Books by language of the source',lw:100,rh:36});
columns('#ch-cost-month',D.costMonthly.map(m=>[m[0],m[1],m[0]>='2026-07'?'ctx':'yellow']),{title:'Spend by month, US dollars',lab:s=>({'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep'})[s.slice(5)],fmt:v=>'$'+fmt(v),marks:[{i:5,t:'paused'},{i:7,t:'budget dial'}],legend:'<span><i class="yellow"></i>pipeline running</span><span><i class="yellow-tint"></i>paused or budget-capped</span>'});
hbars('#ch-ocr-lang',[['English',2.3],['German',4.4],['French',8.0],['Latin',15.5],['Italian',22.8],['Greek',23.3],['Arabic',59.7,{cls:'red'}],['Persian',70.1,{cls:'red'}]].map(r=>[r[0],r[1],Object.assign({cls:'blue',tip:`<b>${r[0]}</b><br>${r[1]}% of double-read pages disagree`},r[2]||{})]),{title:'Pages where two reads of the same leaf disagree',lw:110,fmt:v=>v+'%',legend:'<span><i class="blue"></i>Latin and Greek scripts</span><span><i class="red"></i>right-to-left scripts</span>'});
hbars('#ch-mcp',[['Claude clients',1919+613,{cls:'green',tip:'<b>Claude clients</b><br>Claude-User 1,919 · claude-code 613'}],['Python scripts',1782+198+94,{cls:'green'}],['curl',805,{cls:'green'}],['browsers',508,{cls:'green'}],['node',130,{cls:'green'}]],{title:'Who called the library’s tools through MCP, last 30 days',lw:120,rh:38,legend:'<span>6,155 calls · top tools: search by concept, search within a book, search translations, get a quote</span>'});

/* film */
const ocr=D.fluddPage5.ocr,tr=D.fluddPage5.translation;
const boxes=(()=>{try{const m=ocr.match(/<detected-images>([\s\S]*?)<\/detected-images>/);return m?JSON.parse(m[1]).map(x=>x.bbox):[]}catch(e){return[]}})();
const ocrLines=strip(ocr).split('\n').filter(l=>l.trim()).slice(0,14),trLines=strip(tr).split('\n').filter(l=>l.trim()).slice(0,14);
const lines=arr=>arr.map((l,i)=>`<span class="l a a-fade" style="--d:${.25+i*.22}s;--t:.4s">${esc(l)}</span>`).join('');
const lnBoxes=[[6,.7],[10,.5],[13.5,.75],[16.5,.6],[19,.7],[22,.55],[26.5,.4],[29,.55],[31.5,.6],[34,.5]];
const pageHTML=(extra='')=>`<div class="page"><img src="/talks/ai-case-study/assets/pages/fludd-05.jpg" alt="">${extra}</div>`;
const thumbs=[1,2,3,4,6,7,8,9,10,11,12,13,14,15,16,2,3,4,6,7,8,9,10,11];
const scenes=[
 {name:'Scan',cap:'A copy we keep ourselves. 1,036 leaves, Getty Research Institute via Internet Archive.',dur:6500,html:pageHTML()+`<div class="tiles">${thumbs.map((n,i)=>`<i class="a a-pop" style="--img:url(/talks/ai-case-study/assets/pages/fludd-${String(n).padStart(2,'0')}.jpg);--d:${.3+i*.09}s;--t:.5s"></i>`).join('')}</div><div class="kv a a-rise" style="--d:2.8s"><span><b>1,036</b> scans</span><span><b>23 TB</b> archived across the library</span></div>`},
 {name:'Read',cap:'A vision model transcribes the page in its own layout and tags what it saw.',dur:8000,html:pageHTML(`<div class="sweep"></div>${boxes.map(b=>`<div class="bx a a-draw" style="left:${b.x*100}%;top:${b.y*100}%;width:${b.width*100}%;height:${(b.height||0)*100}%;--d:2.2s;--t:.8s"></div>`).join('')}${lnBoxes.map((b,i)=>`<div class="ln a a-grow" style="top:${b[0]}%;width:${b[1]*100}%;--d:${.4+i*.28}s;--t:.35s"></div>`).join('')}`)+`<div class="pane" style="left:46%;right:34px"><div class="ph"><span>Latin · OCR</span><span class="tab blue">${D.fluddPage5.ocr_model}</span></div><div class="pb">${lines(ocrLines)}</div></div><div class="kv a a-rise" style="--d:5s"><span>prompt <b>${D.fluddPage5.ocr_prompt}</b></span><span><b>$3.21</b> per 1,000 pages</span></div>`},
 {name:'Translate',cap:'Into English, page by page. Each finished page feeds the next prompt.',dur:8000,html:pageHTML()+`<div class="pane" style="left:38%;right:calc(31% + 34px)"><div class="ph"><span>Latin · OCR</span></div><div class="pb" style="font-size:13.5px;color:var(--muted)">${ocrLines.map(l=>`<span class="l">${esc(l)}</span>`).join('')}</div></div><div class="pane a a-rise" style="left:calc(69% + 6px);right:34px;--d:.3s"><div class="ph"><span>Translation · English</span><span class="tab green">${D.fluddPage5.tr_model}</span></div><div class="pb">${lines(trLines)}</div></div><div class="kv a a-rise" style="--d:5s"><span><b>$2.88</b> per 1,000 pages</span><span>context: <b>previous page</b></span></div>`},
 {name:'Enrich',cap:'Index, summary, chapters. And every illustration found and catalogued.',dur:7500,html:pageHTML()+`<div class="idx"><div class="box a a-rise"><div class="t">Index · recurring terms</div>${D.fludd.vocab.slice(0,11).map((v,i)=>`<div class="row a a-fade" style="--d:${.4+i*.18}s"><span class="book">${esc(v[0])}</span><span>${v[1]} pages</span></div>`).join('')}</div><div class="box a a-rise" style="--d:.3s"><div class="t">Illustrations · <b data-count="${D.fludd.detected_images}">0</b> regions in this book</div><div class="crops">${[['05','48% 62%','260%'],['13','50% 50%','120%'],['07','50% 40%','180%'],['09','50% 30%','300%'],['15','50% 50%','200%'],['06','50% 50%','220%'],['10','40% 60%','280%'],['14','50% 50%','180%'],['11','60% 40%','260%']].map((c,i)=>`<i class="a a-pop" style="--img:url(/talks/ai-case-study/assets/pages/fludd-${c[0]}.jpg);--pos:${c[1]};--sz:${c[2]};--d:${1.2+i*.16}s;--t:.5s"></i>`).join('')}</div></div></div>`},
 {name:'Find',cap:'Every page becomes a point in a space where an English question finds a Latin answer.',dur:7500,html:pageHTML()+`<canvas class="field"></canvas><div class="kv a a-rise" style="--d:4.5s"><span><b>gemini-embedding-2</b></span><span><b>5</b> vector stores</span><span>collections · authors · works</span></div>`},
 {name:'Publish',cap:'Scan, transcription and translation, open to anyone. And three badges.',dur:8000,html:`<div class="bookpage"><img class="cov a a-rise" src="/talks/ai-case-study/assets/pages/fludd-05.jpg" alt=""><div class="meta"><div class="au a a-fade" style="--d:.3s">Robert Fludd</div><h3 class="a a-rise" style="--d:.45s">The History of the Two Worlds</h3><div class="it a a-fade" style="--d:.7s">Utriusque Cosmi Historia Vol. 1 · Oppenheim: Johann Theodor de Bry</div><div class="facts a a-fade" style="--d:.9s"><span>Published 1617</span><span>Latin</span><span>1036 scans</span><span>397 images</span></div><div class="badges"><span class="badge ocr a a-pop" style="--d:1.6s">✓ OCR</span><span class="badge tr a a-pop" style="--d:2.4s">✓ Translated</span><span class="badge mute a a-pop" style="--d:3.4s;--t:.9s">No prior translation found</span></div><span class="btn a a-fade" style="--d:1.2s">Read this book</span></div></div>`}
];
(function film(){const host=$('#film-stage');if(!host){window.filmNext=()=>0;window.filmAtEnd=()=>true;return}scenes.splice(3,2);scenes.forEach(s=>s.dur=Math.min(s.dur,6500));host.innerHTML=`<div class="film"><div class="film-screen"><div class="film-top"><span class="dots"><i></i><i></i><i></i></span><span class="ttl"></span><span class="run">Running</span></div><div class="film-stage">${scenes.map(s=>`<div class="sc">${s.html}</div>`).join('')}</div></div><div class="film-cap"><span class="n"></span><span class="t"></span></div><div class="film-ctrl"><button class="fbtn play" aria-label="Pause"></button><div class="film-track">${scenes.map(s=>`<button class="seg"><i></i>${s.name}</button>`).join('')}</div><button class="fbtn rst" aria-label="Restart">↻</button></div></div>`;
 const root=host.firstElementChild,scs=$$('#film-stage .sc'),segs=$$('#film-stage .seg'),ttl=root.querySelector('.ttl'),capn=root.querySelector('.film-cap .n'),capt=root.querySelector('.film-cap .t');
 let cur=-1,t=0,last=performance.now(),playing=false,userPaused=RM;
 function counters(i){scs[i].querySelectorAll('[data-count]').forEach(n=>{n._c={to:+n.dataset.count};n.textContent='0'})}
 function go(i){if(i===cur){restart();return}cur=i;t=0;scs.forEach((s,k)=>{s.classList.toggle('on',k===i);s.classList.remove('run')});void scs[i].offsetWidth;scs[i].classList.add('run');ttl.textContent=`Step ${i+1} of ${scenes.length} · ${scenes[i].name}`;capn.textContent=String(i+1).padStart(2,'0');capt.textContent=scenes[i].cap;segs.forEach((s,k)=>{s.classList.toggle('is',k===i);s.firstElementChild.style.setProperty('--w',k<i?'100%':'0%')});counters(i);if(scenes[i].name==='Find')field(scs[i].querySelector('canvas'))}
 function restart(){t=0;const w=scs[cur];w.classList.remove('run');void w.offsetWidth;w.classList.add('run');counters(cur);if(scenes[cur].name==='Find')field(w.querySelector('canvas'))}
 function setPlaying(on){userPaused=!on;playing=on;root.classList.toggle('paused',!on);if(on)last=performance.now()}
 root.querySelector('.play').addEventListener('click',()=>setPlaying(!playing));root.querySelector('.rst').addEventListener('click',restart);
 segs.forEach((s,i)=>s.addEventListener('click',()=>{go(i);if(!playing)setPlaying(true)}));
 new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting&&!userPaused&&!playing){playing=true;last=performance.now();root.classList.remove('paused')}else if(!e.isIntersecting&&playing){playing=false;root.classList.add('paused')}}},{threshold:.3}).observe(root);
 (function frame(now){requestAnimationFrame(frame);const dt=Math.min(120,now-last);last=now;if(!playing||cur<0)return;t+=dt;const dur=scenes[cur].dur;scs[cur].querySelectorAll('[data-count]').forEach(n=>{const p=Math.max(0,Math.min(1,(t-800)/1600)),e=1-Math.pow(1-p,3);n.textContent=fmt(Math.round(n._c.to*e))});segs[cur].firstElementChild.style.setProperty('--w',Math.min(100,t/dur*100)+'%');if(t>=dur)go((cur+1)%scenes.length)})(last);
 go(0);if(RM){root.classList.add('paused');scs[0].classList.add('still')}
 window.filmNext=()=>{go((cur+1)%scenes.length);if(!playing)setPlaying(true);return cur};window.filmAtEnd=()=>cur===scenes.length-1;
 let fieldRaf=0;function field(c){cancelAnimationFrame(fieldRaf);const ctx=c.getContext('2d');const W=c.clientWidth,H=c.clientHeight,dpr=Math.min(2,devicePixelRatio||1);c.width=W*dpr;c.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
   const cs=getComputedStyle(document.documentElement),blue=cs.getPropertyValue('--blue').trim(),mut=cs.getPropertyValue('--neutral').trim(),ink=cs.getPropertyValue('--ink').trim(),mt=cs.getPropertyValue('--muted').trim();
   const cl=[[.25,.3],[.7,.25],[.5,.65],[.2,.75],[.8,.7]],pts=[];for(let i=0;i<260;i++){const k=i%5,a=Math.random()*6.28,r=Math.pow(Math.random(),.6)*.13;pts.push({x:Math.random(),y:Math.random(),tx:cl[k][0]+Math.cos(a)*r*1.4,ty:cl[k][1]+Math.sin(a)*r,k})}
   const t0=performance.now();(function f(now){const p=Math.min(1,(now-t0)/3200),e=1-Math.pow(1-p,3);ctx.clearRect(0,0,W,H);
     pts.forEach(q=>{const x=(q.x+(q.tx-q.x)*e)*W,y=(q.y+(q.ty-q.y)*e)*H;ctx.fillStyle=q.k===2?blue:mut;ctx.globalAlpha=q.k===2?.9:.55;ctx.beginPath();ctx.arc(x,y,q.k===2?2.6:2,0,6.28);ctx.fill()});ctx.globalAlpha=1;
     const fp=Math.max(0,Math.min(1,(now-t0-2600)/1400)),fe=1-Math.pow(1-fp,3);if(fp>0){const x=(-.6+(cl[2][0]+.6)*fe)*W,y=(.35+(cl[2][1]-.35)*fe)*H;ctx.fillStyle=ink;ctx.beginPath();ctx.arc(x,y,5,0,6.28);ctx.fill();ctx.strokeStyle=blue;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,9+fe*4,0,6.28);ctx.stroke();if(fp>=1){ctx.font='600 12px Inter,sans-serif';ctx.fillStyle=ink;ctx.fillText('this page',x+16,y+4);ctx.font='12px Inter,sans-serif';ctx.fillStyle=mt;ctx.fillText('near: macrocosm · microcosm · anima mundi',x+16,y+20)}}
     if(p<1||fp<1)fieldRaf=requestAnimationFrame(f)})(t0)}
})();

/* reader mock (collapse) */
function readerHTML(o){return `<div class="reader"><div class="bar"><span>‹</span><span class="title">${o.title}<small>${o.sub}</small></span><span class="segs"><span>Scan</span><span>OCR</span><span>Roman</span><span class="is">English</span></span><span class="pg">p. ${o.page} / ${o.pages}</span><span>☰</span></div>
 <div class="panes"><div class="tools">${['Save','Share','Cite','Download','Info','Contents','Guide','Search','Librarian','Settings'].map(t=>`<div><i></i>${t}</div>`).join('')}</div>
 <div class="pane scan"><div class="ph"><span>Original scan</span><span>100%</span></div><div class="body"><img src="${o.img}" alt=""></div></div>
 <div class="pane"><div class="ph"><span>${o.lang} · OCR</span><span class="chip">Notes</span></div><div class="body">${o.ocr}</div></div>
 <div class="pane"><div class="ph"><span>Translation · English</span><span class="chip">Notes</span></div><div class="body ${o.trCls||''}">${o.tr}</div></div></div><div class="strip"></div></div>`}
const para=(s,n)=>strip(s).split(/\n\n+/).filter(x=>x.trim()).slice(0,n).map(p=>`<p>${esc(p.replace(/\n/g,' '))}</p>`).join('');
const before=`<span class="stamp bad">flash-lite · 15 Jun 2026</span><p>…continued from previous page: "…of the building."</p><p>…structure <span class="g">δομῆς</span>.</p><p style="margin-top:26px;font-family:Inter,sans-serif;font-size:12px;color:var(--muted)">That was the whole translation. 471 characters. Twenty lines of Latin and Greek not translated.</p>`;
const after=`<div class="repair"><span class="stamp good">repaired · same day · gemini-3-flash</span>${para(D.dicPage34.after,4)}</div>`;
$('#collapse-reader').innerHTML=readerHTML({title:'The Extant Fragments of Dicaearchus',sub:'ed. Henri II Estienne · 1589',page:34,pages:292,img:'/talks/ai-case-study/assets/pages/dic-34.jpg',lang:'Greek',ocr:para(D.dicPage34.ocr,3),tr:before+after,trCls:'collapsed'});
$('#collapse-reader').style.height='100%';

/* diff */
(function(){const a=strip(D.dicPage20.ocr).replace(/-\n/g,'').replace(/\n/g,' '),b=strip(D.dicPage34.ocr).replace(/\n/g,' ');const A=a.split(/\s+/).slice(0,150),B=b.split(/\s+/).slice(0,150);
 const n=A.length,m=B.length,L=Array.from({length:n+1},()=>new Uint16Array(m+1));for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
 let i=0,j=0,oa='',ob='';while(i<n&&j<m){if(A[i]===B[j]){oa+=A[i]+' ';ob+=B[j]+' ';i++;j++}else if(L[i+1][j]>=L[i][j+1]){oa+=`<span class="del">${esc(A[i])}</span> `;i++}else{ob+=`<span class="ins">${esc(B[j])}</span> `;j++}}
 $('#diff-stage').innerHTML=`<div class="reader diff" style="grid-template-rows:46px 1fr"><div class="bar"><span class="title">Dicaearchus, page 4<small>two scans of the same leaf · two independent reads</small></span><span class="segs"><span class="is">OCR</span><span class="is">OCR</span></span></div><div class="panes" style="grid-template-columns:1fr 1fr"><div class="pane"><div class="ph"><span>Scan 20 · 12 March</span><span class="chip" style="color:var(--blue);border-color:var(--blue)">gemini-3-flash</span></div><div class="body" style="font-size:15px">${oa}</div></div><div class="pane"><div class="ph"><span>Scan 34 · 23 March</span><span class="chip" style="color:var(--blue);border-color:var(--blue)">gemini-3-flash</span></div><div class="body" style="font-size:15px">${ob}</div></div></div></div>`;
 $('#diff-stage').style.height='100%'})();

/* first translations: 100 real badged covers at true proportion, judged in place (two skins) */
(function(){const grids=[$('#ftgrid'),$('#ftgrid2')].filter(Boolean);if(!grids.length)return;
 fetch('/talks/ai-case-study/assets/ft-true.json').then(r=>r.json()).then(m=>{const items=m.items.slice(0,100);const cls=[...Array(46).fill('ok'),...Array(18).fill('prior'),...Array(30).fill('messy'),...Array(6).fill('unres')];
  let seed=7;const order=[...Array(100).keys()];for(let i=order.length-1;i>0;i--){seed=(seed*9301+49297)%233280;const j=Math.floor(seed/233280*(i+1));[order[i],order[j]]=[order[j],order[i]]}
  const label={ok:'First Translation',prior:'Translated before',messy:'Several works',unres:'Unresolved'};
  function layout(w){const ref=grids.find(g=>g.clientWidth)||w;const W=ref.clientWidth,H=ref.clientHeight,gap=8;if(!W||!H)return;
   const pack=th=>{const rows=[];let row=[],rw=0;for(const it of items){const iw=it.w*th/it.h;if(row.length&&rw+gap+iw>W){rows.push(row);row=[];rw=0}row.push({it,iw});rw+=(row.length>1?gap:0)+iw}if(row.length)rows.push(row);
    let total=0;const out=rows.map((r,i)=>{const sumW=r.reduce((a,q)=>a+q.iw,0),avail=W-gap*(r.length-1);const last=i===rows.length-1;const scale=last?Math.min(1,avail/sumW):avail/sumW;const h=th*scale;total+=h+(i?gap:0);return {r,scale,h}});return {out,total}};
   let th=Math.floor(H/5),res;for(;th>24;th-=3){res=pack(th);if(res.total<=H)break}
   let y=0,idx=0,html='';for(const {r,scale,h} of res.out){let x=0;for(const q of r){const wpx=q.iw*scale;const it=q.it;const k=cls[order[idx]];const bs=`${m.w*h/it.h}px ${m.h*h/it.h}px`,bp=`${-it.x*h/it.h}px ${-it.y*h/it.h}px`;html+=`<div class="c ${k}" data-k="${k}" data-i="${idx}" style="left:${x}px;top:${y}px;width:${wpx}px;height:${h}px;background-image:url(/talks/ai-case-study/assets/ft-true.jpg);background-size:${bs};background-position:${bp};transition-delay:${idx*18}ms"><i title="First Translation"></i></div>`;x+=wpx+gap;idx++}y+=h+gap}
   w.innerHTML=html;w.querySelectorAll('.c').forEach(c=>{const it=items[+c.dataset.i]||{};hover(c,`<b>${esc(it.t||'')}</b><br>${esc(it.a||'')} · ${it.yr||''} · ${it.l||''}`)})}
  const all=()=>grids.forEach(layout);all();addEventListener('resize',all);
  if($('#ftkey'))$('#ftkey').innerHTML=`<span><i class="mk ok"></i><b>46</b> genuine first translations</span><span><i class="mk prior"></i><b>18</b> translated before</span><span><i class="mk messy"></i><b>30</b> several works in one binding</span><span><i class="mk unres"></i><b>6</b> unresolved</span>`;
  if($('#ftkey2'))$('#ftkey2').innerHTML=`<span><i class="mk ok folium"></i><b>46</b> genuine first translations</span><span><i class="mk prior"></i><b>18</b> translated before</span><span><i class="mk messy"></i><b>30</b> several works in one binding</span><span><i class="mk unres"></i><b>6</b> unresolved</span>`;
  window.judgeWaffle=()=>setTimeout(()=>{grids.forEach(w=>{w.classList.add('judged');w.parentElement.classList.add('judged');w.querySelectorAll('.c').forEach(c=>{c.querySelector('i').title=label[c.dataset.k]})})},2200)});
 if(!window.judgeWaffle)window.judgeWaffle=()=>{}})();
(function(){const host=$('#trail');if(!host)return;
 const T=[['28 May','Cheap verifier','first','No English of this Latin in three catalogues.'],['28 May','Cheap verifier, no search','prior','Names Hicks 1925 from memory. Not a sighting.'],['30 Jun','Model with web search','prior','Yonge 1853 and Hicks 1925: complete English editions.'],['2 Jul','Agent with catalogue access','prior','Those translate the Greek. Nothing translates Traversari’s Latin.'],['3 Jul','Cheap verifier','prior','"Multiple complete translations exist."'],['13 Jul','Reasoning only, no search','prior','"English since 1688."'],['7 Aug','Agent with catalogue access','first','All three priors are from the Greek, not this text.'],['8 Aug','Agent with catalogue access','open','Four English versions exist, all from the Greek. A policy call, not a fact.']];
 const lab={first:'first',prior:'prior exists',open:'undecided'};
 host.innerHTML=`<div class="tr-head"><img src="/talks/ai-case-study/assets/diogenes.jpg" alt=""><div><div class="k">One book, eight verdicts</div><b>Diogenes Laertius, Lives of the Philosophers</b><span>Latin translation by Ambrogio Traversari, Venice 1472. Badge: <i class="sitebadge">First Translation</i></span></div></div>
 <ol class="tr-list">${T.map((r,i)=>`<li style="--i:${i}"><span class="d">${r[0]}</span><span class="m">${r[1]}</span><span class="v ${r[2]}">${lab[r[2]]}</span><span class="n">${r[3]}</span></li>`).join('')}</ol>
 <div class="tr-q">Is a Latin version of a Greek book a first translation when the Greek has been in English since 1688? Three months, eight passes, and the badge still stands.</div>
 <div class="tr-stats"><span><b>75,927</b> verification attempts</span><span><b>811</b> by a person</span><span><b>63%</b> of the cheap verifier’s "prior exists" answers were invented</span><span><b>5,800 → ≈5,000</b> what we say now</span></div>`})();

/* tiers */
if($('#tiers'))$('#tiers').innerHTML=`<div class="chart"><div class="ttl">Author tiers, 12 August 2026 · 21,974 text books</div></div><div class="band"><div class="t0" style="--f:1688"></div><div class="t1" style="--f:68"></div><div class="t2" style="--f:3106"></div><div class="t3" style="--f:3048"></div><div class="t4" style="--f:14064"></div></div><div class="band-lab"><span>No author · 1,688</span><span>Bare string · 3,106</span><span>Linked · 3,048</span><span>Anchored in VIAF / Wikidata · 14,064</span></div><div class="legend" style="margin-top:22px"><span><i class="red"></i>no author, or an unusable string (68)</span><span><i class="yellow"></i>a bare string, nobody linked</span><span><i class="green"></i>linked to an author record</span><span><i class="blue"></i>anchored to VIAF or Wikidata</span></div><div class="legend"><span>Reachable by a reader (linked + anchored): 77.87% at baseline, 77.95% two days later · 246 of 4,313 catalogue cross-checks contradict the byline</span></div>`;

/* six questions as six figures */
if($('#eth'))$('#eth').innerHTML=[
 ['Transparency','3','stamps on every field: model, prompt, date','blue'],
 ['Authenticity','0','scans ever altered; every rewrite kept','green'],
 ['Oversight','5 <small>vs 438,329</small>','editor corrections against machine revisions','yellow'],
 ['Equity','2% <small>vs 70%</small>','pages the machine misreads: English against Persian','red'],
 ['Dependence','1','vendor. Models deprecate; we keep the raw scans','yellow'],
 ['Rights and reach','586K','unidentified bot hits last month took it anyway','red'],
].map(q=>`<div class="q"><h3>${q[0]}</h3><div class="fig ${q[3]}">${q[1]}</div><p>${q[2]}</p></div>`).join('');

/* the gap: two versions (bars / circles), stepped */
(function(){
 const host=$('#bubbles');if(!host)return;
 // Counted works. EU: USTC distinct works printed before 1700 (site translation-gap study, May 2026); tr = with a known English translation; scan = share of editions with a scan we could find (coverage snapshot).
 const EU=[['Latin',444120,8644,.379],['German',295566,419,.202],['French',194874,1615,.150],['English',149462,553,.310],['Italian',101335,576,.080],['Dutch',82651,462,.012],['Spanish',76472,340,.026],['Greek',8509,132,.362],['Czech',5645,45,null],['Polish',4002,35,null]];
 // Beyond Europe: the catalogues our censuses could measure (works), plus the estimated extent of the tradition in OTHER units.
 const WORLD=[
  ['Tibetan',30437,822,'BDRC catalogue, 2.7% translated',{n:30e6,unit:'pages',label:'BDRC: 30 million pages scanned; works beyond its catalogue uncounted'}],
  ['Chinese',3461,69,'Siku Quanshu canon, 1 to 3% translated',{n:200000,unit:'titles',label:'≈200,000 titles, >500,000 editions to 1912 (Zhongguo guji zongmu)'}],
  ['Arabic script',6531,346,'OpenITI corpus, pre-1900, 5.3% translated',{n:3500000,unit:'manuscripts',label:'≈3 to 4 million surviving manuscripts (Roper, Déroche); distinct works uncounted'}],
  ['Indic',null,null,'no census we could run',{n:10000000,unit:'manuscripts',label:'≈10 million manuscripts (National Mission for Manuscripts, India); 5.2 million documented'}]];
 const K=0.115;const R=n=>Math.sqrt(n)*K;
 const all=[...EU.map(d=>({name:d[0],works:d[1],tr:d[2],scan:d[3],group:'eu'})),...WORLD.map(d=>({name:d[0],works:d[1],tr:d[2],scan:null,group:'world',note:d[3],est:d[4]}))];
 all.forEach(d=>{d.r=d.works?R(d.works):3;d.hr=d.est?(d.est.unit==='pages'?d.r*2.2:R(d.est.n)):0});
 // pack Europe
 const placed=[];function fits(x,y,r){return placed.every(p=>Math.hypot(p.x-x,p.y-y)>=p.r+r+6)}
 const eu=all.filter(d=>d.group==='eu').sort((a,b)=>b.r-a.r);
 eu.forEach((d,i)=>{if(i===0){d.x=0;d.y=0;placed.push(d);return}let best=null;for(let Rr=d.r+10;Rr<4000&&!best;Rr+=6){for(let a=0;a<360;a+=5){const t=a*Math.PI/180+i;const x=Math.cos(t)*Rr,y=Math.sin(t)*Rr*.72;if(fits(x,y,d.r)){best=[x,y];break}}}d.x=best[0];d.y=best[1];placed.push(d)});
 const euR=Math.max(...eu.map(d=>Math.hypot(d.x,d.y)+d.r));
 // world nodes: a column to the right, spaced by their estimated extent
 const world=all.filter(d=>d.group==='world');let cy=-euR*.6;const wx=euR+40;
 world.forEach((d,i)=>{const half=Math.max(d.hr,d.r)+10;cy+=half;d.x=wx+half;d.y=cy;cy+=half+60});
 // centre on Dutch
 const nl=all.find(d=>d.name==='Dutch');const ox=nl.x,oy=nl.y;all.forEach(d=>{d.x-=ox;d.y-=oy});
 const circle=d=>{const rt=d.works?Math.sqrt(d.tr/d.works)*d.r:0,rs=d.scan!=null?Math.sqrt(d.scan)*d.r:0;
  return `<g class="g" data-name="${d.name}" data-group="${d.group}" transform="translate(${d.x.toFixed(1)},${d.y.toFixed(1)})">${d.est?`<g class="halo"><circle class="c-halo" vector-effect="non-scaling-stroke" r="${d.hr.toFixed(1)}"/><text class="hl" text-anchor="middle"></text></g>`:''}${d.works?`<circle class="c-all" vector-effect="non-scaling-stroke" r="${d.r.toFixed(1)}"/>${rs?`<circle class="c-scan" r="${rs.toFixed(1)}"/>`:''}<circle class="c-tr" r="${Math.max(rt,1.2).toFixed(1)}"/>`:''}<text class="lbl" text-anchor="middle">${d.name}</text><text class="subl" text-anchor="middle">${d.works?`${fmt(d.works)} works · ${(d.tr/d.works*100).toFixed(2)}% translated${d.scan!=null?` · ${(d.scan*100).toFixed(1)}% scanned`:''}`:''}</text></g>`};
 const bbox=(list,halos)=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;list.forEach(d=>{const Rr=halos&&d.est?d.hr:d.r;x0=Math.min(x0,d.x-Rr);y0=Math.min(y0,d.y-Math.max(Rr,d.r*1.9));x1=Math.max(x1,d.x+Rr);y1=Math.max(y1,d.y+Rr)});const w=x1-x0,h=y1-y0,pad=.1;return [x0-w*pad,y0-h*pad,w*(1+2*pad),h*(1+2*pad)]};
 const steps=[
  {name:'Dutch',show:d=>d.name==='Dutch',cap:`<b>82,651</b> works printed in Dutch before 1700. <b>1.2%</b> have a scan we could find. <b>0.56%</b> have an English translation.`},
  {name:'Europe',show:d=>d.group==='eu',cap:`<b>1.39 million</b> works printed in Europe before 1700. About <b>0.9%</b> can be read in English; Latin, the largest, at <b>1.95%</b>.`},
  {name:'Beyond Europe',show:d=>d.group==='eu'||(d.group==='world'&&d.works),cap:`The catalogues our censuses could run: Tibetan <b>2.7%</b>, Arabic script <b>5.3%</b>, the Chinese canon <b>1 to 3%</b>. Small circles, because these are catalogues, not traditions.`},
  {name:'Never counted',show:d=>true,halos:true,cap:`What survives, in other units. Chinese: <b>≈200,000 titles</b>. Arabic script: <b>3 to 4 million manuscripts</b>. India: <b>≈10 million manuscripts</b>. Nobody has counted the works, let alone translated them.`}];
 // ---- bars version: share readable in English, per body of works ----
 // ---- bars version: the scale keeps growing. Rows accumulate; every earlier bar shrinks as the axis stretches.
 const SCALE_ROWS=[
  {k:'nl',name:'Dutch',n:82651,tr:462,unit:'works printed before 1700',step:0,hi:true},
  ...EU.filter(d=>d[0]!=='Dutch').map(d=>({k:d[0],name:d[0],n:d[1],tr:d[2],unit:'works printed before 1700',step:1})),
  {k:'tib',name:'Tibetan',n:30437,tr:822,unit:'works in the BDRC catalogue',step:2},
  {k:'chi',name:'Chinese',n:500000,tr:null,unit:'editions in the union catalogue; translations uncounted',step:2,est:true},
  {k:'ara',name:'Arabic script',n:3500000,tr:null,unit:'surviving manuscripts, estimate; works uncounted',step:3,est:true},
  {k:'ind',name:'India',n:10000000,tr:null,unit:'manuscripts, national estimate',step:4,est:true}];
 const barSteps=[
  {name:'Dutch',cap:`<b>82,651</b> works printed in Dutch before 1700. <b>0.56%</b> have an English translation.`},
  {name:'Europe',cap:`Latin alone is <b>444,120</b> works. Europe before 1700: <b>1.39 million</b>, about <b>0.9%</b> readable in English.`},
  {name:'China',cap:`China's union catalogue lists <b>500,000</b> editions to 1912. Nobody has counted how many exist in English.`},
  {name:'Arabic',cap:`<b>3 to 4 million</b> Arabic-script manuscripts survive, counted in copies, not works. Europe's print is already a strip.`},
  {name:'India',cap:`India estimates <b>10 million</b> manuscripts. The Dutch bar we started with is now a hairline.`}];
 const scaleHTML=()=>`<div class="scale"><div class="axis"><span class="a0">0</span><span class="amax"></span></div>${SCALE_ROWS.map(r=>`<div class="srow ${r.hi?'hi':''} ${r.est?'est':''}" data-k="${r.k}" data-step="${r.step}"><span class="lab">${r.name}</span><span class="bar"><i class="all"></i>${r.tr!=null?'<i class="tr"></i>':''}<span class="val"><b>${fmt(r.n)}</b> ${r.unit}${r.tr!=null?` · <b>${(r.tr/r.n*100).toFixed(2)}%</b> translated`:''}</span></span></div>`).join('')}</div>`;
 function renderScale(i){let el=barsEl.querySelector('.scale');if(!el){barsEl.innerHTML=scaleHTML();el=barsEl.querySelector('.scale');void el.offsetWidth}
  const shown=SCALE_ROWS.filter(r=>r.step<=i);const max=Math.max(...shown.map(r=>r.n));const unit=i>=4?'manuscripts':i>=3?'manuscripts':i>=2?'editions':'works';
  el.querySelector('.amax').textContent=fmt(max)+' '+unit;
  el.querySelectorAll('.srow').forEach(row=>{const r=SCALE_ROWS.find(x=>x.k===row.dataset.k);const on=r.step<=i;row.classList.toggle('on',on);row.style.setProperty('--w',on?(r.n/max*100).toFixed(3)+'%':'0%');row.style.setProperty('--t',on&&r.tr!=null?Math.max(0.15,r.tr/max*100).toFixed(3)+'%':'0%')});
  cap.innerHTML=barSteps[i].cap}
 host.innerHTML=`<div class="bubbles"><div class="gap-top"><div class="bub-legend circles-only"><span><i style="background:var(--red)"></i>no English translation</span><span><i style="background:var(--yellow)"></i>a scan exists</span><span><i style="background:var(--green)"></i>translated</span><span><i class="dash"></i>estimated extent, other units</span></div><div class="bub-legend bars-only"><span><i class="lg-tr"></i>translated into English</span><span><i class="lg-no"></i>no English translation</span><span><i class="lg-est"></i>estimate, counted in other units</span></div><div class="ver"><button data-v="bars">Bars</button><button data-v="circles">Circles</button></div></div><div class="wrap"><div class="barsv"></div><svg class="circ" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">${all.map(circle).join('')}</svg></div><div><div class="bub-steps"></div><div class="bub-cap"></div></div></div>`;
 const svg=host.querySelector('svg.circ'),barsEl=host.querySelector('.barsv'),stepsEl=host.querySelector('.bub-steps'),cap=host.querySelector('.bub-cap'),gs=[...svg.querySelectorAll('g.g')],verBtns=[...host.querySelectorAll('.ver button')];
 let version='bars',cur=-1,vb=null,raf=0;
 function relabel(tb,halos){const Rc=svg.getBoundingClientRect();const sc=Math.min(Rc.width/tb[2],Rc.height/tb[3])||1;const fs=15/sc,fs2=12/sc;gs.forEach(g=>{const d=all.find(x=>x.name===g.dataset.name);const l=g.querySelector('.lbl'),su=g.querySelector('.subl'),hl=g.querySelector('.hl');const px=d.r*sc;l.setAttribute('font-size',fs.toFixed(3));su.setAttribute('font-size',fs2.toFixed(3));const top=halos&&d.est?d.hr:d.r;l.setAttribute('y',(-top-fs*.6).toFixed(2));su.setAttribute('y',(d.r+fs2*1.2).toFixed(2));su.style.display=(cur===0||px>120)&&d.works?'':'none';l.style.display=((halos?px>22:px>9)||(halos&&d.est))?'':'none';if(hl){hl.setAttribute('font-size',fs2.toFixed(3));const small=d.hr*sc<90;hl.setAttribute('text-anchor',small?'start':'middle');hl.setAttribute('x',small?(d.hr+fs2*.6).toFixed(2):'0');hl.setAttribute('y',small?(fs2*.35).toFixed(2):(d.hr+fs2*1.3).toFixed(2));hl.textContent=d.est.label;hl.style.display=halos?'':'none';if(small){l.setAttribute('text-anchor','start');l.setAttribute('x',(d.hr+fs2*.6).toFixed(2));l.setAttribute('y',(-fs2*.5).toFixed(2))}else{l.setAttribute('text-anchor','middle');l.setAttribute('x','0')}}else{l.setAttribute('text-anchor','middle');l.setAttribute('x','0')}g.querySelector('.halo')?.classList.toggle('on',!!halos)})}
 function setVB(target,ms){cancelAnimationFrame(raf);const from=vb||target;const t0=performance.now();(function f(now){const p=ms<=0?1:Math.min(1,(now-t0)/ms),e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;vb=from.map((v,i)=>v+(target[i]-v)*e);svg.setAttribute('viewBox',vb.map(v=>v.toFixed(2)).join(' '));if(p<1)raf=requestAnimationFrame(f)})(t0)}
 function renderSteps(list){stepsEl.innerHTML=list.map(s=>`<button class="seg"><i></i>${s.name}</button>`).join('');[...stepsEl.children].forEach((b,i)=>b.addEventListener('click',()=>go(i)))}
 function go(i){cur=i;if(version==='circles'){const st=steps[i];gs.forEach(g=>{const d=all.find(x=>x.name===g.dataset.name);g.classList.toggle('on',st.show(d))});cap.innerHTML=st.cap;const tb=bbox(all.filter(st.show),st.halos);relabel(tb,st.halos);setVB(tb,vb?1800:0)}
  else{renderScale(i)}
  [...stepsEl.children].forEach((s,k)=>{s.classList.toggle('is',k===i);s.firstElementChild.style.setProperty('--w',k<=i?'100%':'0%')})}
 function setVersion(v){version=v;vb=null;barsEl.innerHTML='';host.querySelector('.bubbles').dataset.v=v;verBtns.forEach(b=>b.classList.toggle('is',b.dataset.v===v));const sl=host.closest('.slide');if(sl){sl.dataset.v=v;window.syncTabs&&window.syncTabs()}renderSteps(v==='circles'?steps:barSteps);go(0)}
 verBtns.forEach(b=>b.addEventListener('click',()=>setVersion(b.dataset.v)));
 gs.forEach(g=>{const d=all.find(x=>x.name===g.dataset.name);hover(g,`<b>${d.name}</b>${d.works?`<br>${fmt(d.works)} works${d.note?' · '+d.note:''}<br>${fmt(d.tr)} with an English translation (${(d.tr/d.works*100).toFixed(2)}%)`:''}${d.scan!=null?`<br>${(d.scan*100).toFixed(1)}% with a scan we could find`:''}${d.est?`<br>${d.est.label}`:''}`)});
 window.gapNext=()=>{const list=version==='circles'?steps:barSteps;if(cur<list.length-1)go(cur+1);else if(version==='bars')setVersion('circles')};window.gapSetVersion=setVersion;
 window.gapAtEnd=()=>version==='circles'&&cur>=steps.length-1;
 setVersion(host.closest('.slide').dataset.v||'bars');
 new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){setVersion(host.closest('.slide').dataset.v||'bars')}})},{threshold:.6}).observe(host);
})();


/* everything we use AI for: clustered network from the usage log */
(function(){const host=$('#aimap-stage');if(!host)return;
 const css=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
 let seed=11;const rnd=()=>{seed=(seed*9301+49297)%233280;return seed/233280};
 const HUBS=[['read','Reading','--blue'],['translate','Translating','--green'],['describe','Describing','--yellow'],['check','Checking','--red'],['serve','Serving','--ink']];
 const T=[['read','Transcribe pages',2613834],['read','Find illustrations',3335590],['read','Transliterate',229447],['read','Re-read to check agreement',163495],['read','Read the layout',90000],
  ['translate','Translate pages',1637205],['translate','Translate single pages',249691],['translate','Check for collapse',4250000],['translate','Repair collapsed pages',556],['translate','Align words',16000],
  ['describe','Index terms',344256],['describe','Chapters',17103],['describe','Summaries',16951],['describe','Describe illustrations',101967],['describe','Choose a cover',59702],['describe','Score scan quality',12260],['describe','Enrich metadata',5370],
  ['check','Verify first-translation claims',75927],['check','Link authors to Wikidata',21974],['check','Assign collections',9908],['check','Match entities',102910],['check','Audit attribution',133],
  ['serve','Embed pages for search',488881],['serve','Answer readers (Librarian)',12000],['serve','Tool calls from AI agents',27600],['serve','Dataset API',675]];
 const c=document.createElement('canvas');host.appendChild(c);const lg=document.createElement('div');lg.className='aimap-legend';lg.innerHTML=HUBS.map(h=>`<span><i style="background:var(${h[2]})"></i>${h[1]}</span>`).join('')+`<span>· one small dot = 25,000 model calls</span>`;host.appendChild(lg);
 const ctx=c.getContext('2d');let W=0,H=0,nodes=[],dots=[],hubs=[],raf=0,t0=0,hot=null;
 function build(){seed=11;W=host.clientWidth;H=host.clientHeight;const dpr=Math.min(2,devicePixelRatio||1);c.width=W*dpr;c.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  const cx=W*.5,cy=H*.47,RX=W*.36,RY=H*.30;
  hubs=HUBS.map((h,i)=>{const a=-Math.PI/2+i*(2*Math.PI/HUBS.length);return {id:h[0],name:h[1],col:css(h[2]),x:cx+Math.cos(a)*RX,y:cy+Math.sin(a)*RY,r:15,a}});
  const maxC=Math.max(...T.map(t=>t[2]));nodes=T.map(t=>{const h=hubs.find(x=>x.id===t[0]);const r=5+Math.sqrt(t[2]/maxC)*40;const a=rnd()*6.283,d=70+rnd()*90;return {hub:h,label:t[1],n:t[2],r,x:h.x+Math.cos(a)*d,y:h.y+Math.sin(a)*d*.8,vx:0,vy:0}});
  for(let it=0;it<320;it++){for(const n of nodes){n.vx+=(n.hub.x-n.x)*0.010;n.vy+=(n.hub.y-n.y)*0.010;
    // push away from the stage centre so clusters spread outward
    const ddx=n.x-cx,ddy=n.y-cy,dd=Math.hypot(ddx,ddy)||1;n.vx+=ddx/dd*0.35;n.vy+=ddy/dd*0.35;
    for(const m of nodes){if(m===n)continue;const dx=n.x-m.x,dy=n.y-m.y,d=Math.hypot(dx,dy)||1,min=n.r+m.r+34;if(d<min){const f=(min-d)/d*0.16;n.vx+=dx*f;n.vy+=dy*f}}
    for(const hb of hubs){const dx=n.x-hb.x,dy=n.y-hb.y,d=Math.hypot(dx,dy)||1,min=n.r+(hb===n.hub?46:90);if(d<min){const f=(min-d)/d*0.2;n.vx+=dx*f;n.vy+=dy*f}}
    n.vx*=.78;n.vy*=.78;n.x=Math.max(n.r+70,Math.min(W-n.r-170,n.x+n.vx));n.y=Math.max(n.r+24,Math.min(H-n.r-50,n.y+n.vy))}}
  dots=[];for(const n of nodes){const k=Math.min(90,Math.max(2,Math.round(n.n/25000)));for(let i=0;i<k;i++){const a=rnd()*6.283,rr=n.r+6+Math.pow(rnd(),.7)*(24+k*.4);dots.push({x:n.x+Math.cos(a)*rr,y:n.y+Math.sin(a)*rr*.85,col:n.hub.col,s:1.3+rnd()*1.4,ph:rnd()*6.283})}}
  t0=performance.now()}
 function draw(now){raf=requestAnimationFrame(draw);const t=(now-t0)/1000,p=Math.min(1,t/1.6),e=1-Math.pow(1-p,3);ctx.clearRect(0,0,W,H);
  ctx.strokeStyle=css('--line2');ctx.lineWidth=1.2;ctx.setLineDash([3,5]);ctx.beginPath();hubs.forEach((h,i)=>{i?ctx.lineTo(h.x,h.y):ctx.moveTo(h.x,h.y)});ctx.closePath();ctx.stroke();ctx.setLineDash([]);
  ctx.lineWidth=1;for(const n of nodes){ctx.strokeStyle=n.hub.col;ctx.globalAlpha=.3*e;ctx.beginPath();ctx.moveTo(n.hub.x,n.hub.y);const mx=(n.hub.x+n.x)/2,my=(n.hub.y+n.y)/2-14;ctx.quadraticCurveTo(mx,my,n.x,n.y);ctx.stroke()}
  ctx.globalAlpha=1;for(const d of dots){const tw=.7+.3*Math.sin(t*1.2+d.ph);ctx.fillStyle=d.col;ctx.globalAlpha=.5*e*tw;ctx.beginPath();ctx.arc(d.x,d.y,d.s,0,6.283);ctx.fill()}
  ctx.globalAlpha=1;for(const n of nodes){ctx.fillStyle=n.hub.col;ctx.globalAlpha=n===hot?1:.88;ctx.beginPath();ctx.arc(n.x,n.y,n.r*e,0,6.283);ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=css('--bg');ctx.lineWidth=2;ctx.stroke()}
  for(const h of hubs){ctx.fillStyle=h.col;ctx.beginPath();ctx.arc(h.x,h.y,h.r*e,0,6.283);ctx.fill();ctx.strokeStyle=css('--bg');ctx.lineWidth=3;ctx.stroke();ctx.fillStyle=css('--ink');ctx.font='700 15px Inter,sans-serif';ctx.textAlign='center';ctx.fillText(h.name.toUpperCase(),h.x,h.y+(Math.sin(h.a)<0?-h.r-10:h.r+22))}
  ctx.font='500 12px Inter,sans-serif';const placed=[];for(const n of [...nodes].sort((a,b)=>b.r-a.r)){if(n.r<8)continue;const dx=n.x-n.hub.x,dy=n.y-n.hub.y,d=Math.hypot(dx,dy)||1;const left=dx<0;ctx.textAlign=left?'right':'left';const tw=ctx.measureText(n.label).width;let x=n.x+(left?-1:1)*(n.r+7),y=n.y+4;const box={x:left?x-tw:x,y:y-11,w:tw,h:15};if(placed.some(b=>!(box.x>b.x+b.w+4||box.x+box.w+4<b.x||box.y>b.y+b.h+2||box.y+box.h+2<b.y)))continue;placed.push(box);ctx.fillStyle=css('--bg');ctx.globalAlpha=.85;ctx.fillRect(box.x-3,box.y,box.w+6,box.h);ctx.globalAlpha=1;ctx.fillStyle=css('--ink2');ctx.fillText(n.label,x,y)}
  if(p>=1&&t>40)cancelAnimationFrame(raf)}
 c.addEventListener('mousemove',ev=>{const r=c.getBoundingClientRect();const x=ev.clientX-r.left,y=ev.clientY-r.top;hot=nodes.find(n=>Math.hypot(n.x-x,n.y-y)<=n.r+3)||null;if(hot){tip.innerHTML=`<b>${esc(hot.label)}</b><br>${fmt(hot.n)} ${hot.hub.id==='check'&&hot.label.startsWith('Verify')?'attempts':'calls or items'}`;tip.style.opacity=1;tip.style.left=(ev.clientX+14)+'px';tip.style.top=(ev.clientY+14)+'px'}else tip.style.opacity=0});
 new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){build();cancelAnimationFrame(raf);raf=requestAnimationFrame(draw)}else cancelAnimationFrame(raf)})},{threshold:.5}).observe(host);
 addEventListener('resize',()=>{if(host.closest('.slide').classList.contains('on-screen'))build()});
})();

/* pipeline version of the AI map (architecture-diagram style) */
(function(){const host=$('#pipe-stage');if(!host)return;
 const I={page:'<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',eye:'<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',img:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/></svg>',tr:'<svg viewBox="0 0 24 24"><path d="M4 6h9M8 6c0 5-2 8-5 10M6 9c1 3 3 5 6 7M13 20l4-9 4 9M14.5 17h5"/></svg>',tag:'<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',list:'<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></svg>',link:'<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',db:'<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',globe:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',chart:'<svg viewBox="0 0 24 24"><path d="M4 20h16M7 16V9M12 16V5M17 16v-6"/></svg>',user:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',repeat:'<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M18 3v4h-4M6 21v-4h4"/></svg>',fix:'<svg viewBox="0 0 24 24"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/></svg>',search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',split:'<svg viewBox="0 0 24 24"><path d="M12 3v7M12 10l-6 6M12 10l6 6M4 20h4M16 20h4"/></svg>',coin:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v12M9 9.5c0-1 1.3-1.5 3-1.5s3 .6 3 1.7c0 2.6-6 1.4-6 4.1 0 1.2 1.3 1.7 3 1.7s3-.5 3-1.5"/></svg>',book:'<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>'};
 const card=(ic,b,sp)=>`<div class="card">${I[ic]}<div><b>${b}</b>${sp?`<span>${sp}</span>`:''}</div></div>`;
 host.innerHTML=`<div class="pipeD"><div class="cols">
  <div class="src"><b style="position:absolute;top:-9px;left:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700;background:var(--bg);padding:0 6px 0 0">Sources</b>${card('db','Internet Archive','')}${card('db','Gallica · MDZ · e-rara','')}${card('db','Partner libraries','Embassy of the Free Mind, BPH')}${card('db','Open text corpora','Kanripo, OpenITI, BDRC')}</div>
  <div class="grp" style="--gc:var(--ink2)"><b>Acquire</b>${card('split','Import and split volumes','78 campaigns, chosen by people')}${card('db','Archive every scan','59,112,774 files, 23 TB')}${card('page','Preview 25 pages','metadata before full read')}</div>
  <div class="grp" style="--gc:var(--blue)"><b>Read</b>${card('eye','Transcribe pages','2,613,834 calls')}${card('img','Find illustrations','3,335,590 calls')}${card('list','Read the layout','headings, catchwords, page numbers')}${card('tr','Transliterate','229,447 calls')}${card('repeat','Re-read to check agreement','163,495 pages')}</div>
  <div class="grp" style="--gc:var(--green)"><b>Translate</b>${card('tr','Translate page by page','1,637,205 calls, previous page as context')}${card('search','Check for collapse','4,250,000 pages, one cheap signal')}${card('fix','Repair, keep the old version','556 pages')}${card('link','Align words to the original','notes and glosses')}</div>
  <div class="grp" style="--gc:var(--yellow)"><b>Describe and check</b>${card('list','Index, summaries, chapters','344,256 · 16,951 · 17,103')}${card('img','Describe illustrations','101,967 images')}${card('tag','Verify first-translation claims','75,927 attempts, 811 human')}${card('user','Link authors to Wikidata','21,974 graded')}${card('tag','Assign collections','9,908')}</div>
  <div class="grp" style="--gc:var(--ink)"><b>Publish and serve</b>${card('book','Book page and reader','59,702 books')}${card('search','Embeddings and search','5 vector stores')}${card('globe','Ask the Librarian','')}${card('globe','Tools for AI agents','27,600 calls')}${card('db','Dataset API','53 keys, 6.2M records')}</div>
 </div>
 <div class="bottom"><b>Measurement and oversight</b>${card('coin','Cost log and budget dial','$24,297 logged, paused 8 June')}${card('chart','Stability audit','disagreement by script')}${card('chart','Collapse census','0.59%, corrected twice')}${card('chart','Attribution ledger','77.87% → 77.95%')}${card('user','Human verdicts','811 on first translations')}${card('user','Editor corrections','5 logged')}</div></div>`;
  [...host.querySelectorAll('.cols > *')].forEach((g,i)=>{g.style.setProperty('--g',i);[...g.querySelectorAll('.card')].forEach((c,k)=>c.style.setProperty('--k',k))});[...host.querySelectorAll('.bottom .card')].forEach((c,k)=>c.style.setProperty('--k',k));
})();

/* where the humans are: one band per stage, blue machine, yellow person */
(function(){const host=$('#bands');if(!host)return;const H=D.humans,hum=D.ftMethods.find(m=>m[0]==='human')[1],allv=D.ftMethods.reduce((s,m)=>s+m[1],0);
 const rows=[['Choose what to digitise','78 acquisition campaigns',0,78],['Archive the scans','files copied',D.storage.r2_objects,0],['Read the pages','machine revisions vs human reference pages',H.page_revisions,32],['Translate','pages vs editor corrections',D.scale.translated,H.corrections],['Verify first-translation claims','attempts vs human verdicts',allv-hum,hum],['Name the author','books graded vs hand checks',21974,133],['Publish and curate','books vs curator sessions and volunteers',D.scale.books,H.curator_sessions+H.volunteers]];
 host.innerHTML=`<div class="bands">${rows.map((r,ri)=>{const [n,sub,m,h]=r;const tot=m+h;const hw=tot?h/tot*100:0;const cls=m===0?'human':'';const ratio=m===0?'all by people':h===0?'nobody':`1 : ${fmt(Math.round(m/h))}`;const rs=m===0?'no machine step':h===0?'no human step':'person to machine';return `<div class="row" style="--i:${ri}"><div class="n">${n}<small>${sub}</small></div><div class="bar ${cls}">${(m&&h)?`<i style="--w:${hw.toFixed(4)}%;--min:${h<1000?'3px':'6px'}"></i>`:''}</div><div class="r"><b>${ratio}</b>${rs} · ${fmt(m)} · ${fmt(h)}</div></div>`}).join('')}<div class="legend"><span><i class="blue"></i>by the machine</span><span><i class="yellow"></i>by a person</span></div></div>`;
 host.querySelectorAll('.row').forEach((el,i)=>{const r=rows[i];hover(el,`<b>${r[0]}</b><br>machine ${fmt(r[2])}<br>people ${fmt(r[3])}`)})})();

/* header version tabs */
(function(){const bar=$('#vtabs');if(!bar)return;
 window.syncTabs=()=>{const sl=document.querySelector('.slide.on-screen[data-versions]');if(!sl){bar.innerHTML='';return}
  const vs=sl.dataset.versions.split(',').map(x=>x.split(':'));bar.innerHTML=vs.map(([k,l])=>`<button data-v="${k}" class="${sl.dataset.v===k?'is':''}">${l}</button>`).join('');
  bar.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{sl.dataset.v=b.dataset.v;if(sl.id==='gap'&&window.gapSetVersion)window.gapSetVersion(b.dataset.v);dispatchEvent(new Event('resize'));window.syncTabs()}))};
 new MutationObserver(()=>window.syncTabs()).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});
})();

/* covers wall: true proportions, a strip of ground between */
(function(){const c=$('#wall');if(!c)return;const ctx=c.getContext('2d');const img=new Image();img.src='/talks/ai-case-study/assets/covers-true.jpg';let meta=null;fetch('/talks/ai-case-study/assets/covers-true.json').then(r=>r.json()).then(m=>meta=m);const t0=performance.now();
 let rows=null;function layout(W,H){const gap=10,top=56+gap,rowsFit=Math.max(3,Math.floor((H-top)/(150+gap))),rowH=Math.floor((H-top-gap*(rowsFit-1))/rowsFit);rows=[];let i=0,y=top;while(y+rowH<=H+1){const row={y,h:rowH,items:[],w:0};let x=0;while(x<W*2){const it=meta.items[i%meta.n];i++;const w=it.w*rowH/it.h;row.items.push({it,x,w});x+=w+gap}row.w=x;rows.push(row);y+=rowH+gap}}
 function draw(now){if(!meta||!img.complete){requestAnimationFrame(draw);return}const dpr=Math.min(2,devicePixelRatio||1);const W=c.clientWidth,H=c.clientHeight;if(c.width!==W*dpr){c.width=W*dpr;c.height=H*dpr;rows=null}ctx.setTransform(dpr,0,0,dpr,0,0);if(!rows)layout(W,H);ctx.clearRect(0,0,W,H);
  const t=RM?0:(now-t0)/1000;rows.forEach((row,ri)=>{const off=((t*(ri%2?6:9))%row.w);for(const q of row.items){let x=q.x-off;if(x+q.w<0)x+=row.w;if(x>W)continue;ctx.drawImage(img,q.it.x,q.it.y,q.it.w,q.it.h,x,row.y,q.w,row.h)}});
  requestAnimationFrame(draw)}requestAnimationFrame(draw)})();

/* slides */
const slides=$$('.slide'),rail=$('#rail');rail.innerHTML=slides.map(s=>`<a href="#${s.id}" data-part="${s.dataset.part||''}" title="${esc(s.dataset.title||s.id)}"></a>`).join('');const dots=$$('#rail a');let active=0;
const io=new IntersectionObserver(es=>{es.forEach(e=>{e.target.classList.toggle('on-screen',e.isIntersecting);if(e.isIntersecting){active=slides.indexOf(e.target);dots.forEach((d,i)=>d.classList.toggle('on',i===active));countUp(e.target);if(e.target.id==='first')judgeWaffle();if(e.target.id==='collapse')setTimeout(()=>e.target.querySelector('.repair').classList.add('go'),3200)}})},{threshold:.55});
slides.forEach(s=>io.observe(s));
function go(i){i=Math.max(0,Math.min(slides.length-1,i));slides[i].scrollIntoView({behavior:'smooth'})}
addEventListener('keydown',e=>{if(e.target.matches('input,textarea,button'))return;const k=e.key;
  if(k==='ArrowRight'||k==='PageDown'||k===' '){e.preventDefault();if(false){}else if(slides[active].id==='gap'&&window.gapNext&&!window.gapAtEnd())window.gapNext();else go(active+1)}
  else if(k==='ArrowLeft'||k==='PageUp'){e.preventDefault();go(active-1)}
  else if(k.toLowerCase()==='n'){document.body.classList.toggle('show-notes')}
  else if(k.toLowerCase()==='d'){setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark')}
  else if(k==='Home'){go(0)}});
})();
