#!/usr/bin/env node
/**
 * build-review-annotator.mjs — REVIEW/AUDIT-mode annotator for the first-translation
 * gold standard.
 *
 * Unlike the blind anti-anchoring annotator (build-gold-annotator.mjs), this presents
 * the AI's adjudication — verdict, the prior it surfaced, sources checked, rationale —
 * and asks a human to AUDIT it: agree / override / can't-tell. The human reviews the
 * MATCH the AI found rather than re-searching from scratch (the realistic, systematic-
 * review "second reviewer checks the search" model). The human MUST click through to
 * the cited record before agreeing — the AI's prose describing a prior is not the prior
 * (cf. the misquote hazard).
 *
 * A random BLIND-CALIBRATION subset hides the AI until the human commits an independent
 * verdict, then reveals it — so we can measure how much *seeing* the AI's answer inflates
 * agreement (the anchoring tax) and keep the de-circularisation claim honest.
 *
 * INPUT: the AI adjudication raw files (verdict + prior + sources + notes) + book metadata.
 * OUTPUT: scripts/output/ft-review-annotator.html (self-contained; export feeds
 *         score-review-standard.mjs).
 *
 * USAGE: node scripts/eval/build-review-annotator.mjs [--blind N]
 */
import fs from 'fs';

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
const BLIND_N = parseInt(getArg('--blind', '7'), 10);
const fromEnum = getArg('--from-enum', null);   // a ft-gemini-adjudicate JSONL to review
const SAMPLE = parseInt(getArg('--sample', '0'), 10);

const load = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };
function fam(l) { l = l || '';
  if (['Latin','Greek','Ancient Greek','German','French','Italian','Spanish','Dutch','English','Portuguese','Latin-German'].includes(l)) return 'Western';
  if (['Chinese','Japanese','Korean'].includes(l)) return 'CJK';
  if (l === 'Tibetan') return 'Tibetan';
  if (['Sanskrit','Tamil','Pali'].includes(l)) return 'Indic';
  if (/Hebrew|Arabic|Syriac|Aramaic|Judeo|Ge.?ez|Armenian|Sumerian|Akkadian/.test(l)) return 'Semitic/NearEast';
  return 'Other'; }

let records;
if (fromEnum) {
  // REVIEW the real enumeration output: a JSONL from ft-gemini-adjudicate.mjs (#2564 three-sink).
  const rows = fs.readFileSync(fromEnum, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const { MongoClient, ObjectId } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const docs = await c.db('bookstore').collection('books').find(
    { _id: { $in: rows.map(r => { try { return new ObjectId(r.book_id); } catch { return r.book_id; } }) } },
    { projection: { title: 1, author: 1, original_language: 1, language: 1, year: 1, published: 1, slug: 1 } }).toArray();
  await c.close();
  const M = {}; for (const d of docs) M[String(d._id)] = { t: d.title || '', a: d.author || '', l: d.original_language || d.language || '?', y: d.year || d.published || '', slug: d.slug || String(d._id) };
  records = rows.map(r => {
    const m = M[r.book_id] || {};
    const priors = r.prior_translations_found || [];
    return {
      i: r.book_id, t: m.t || '', a: m.a || '', l: m.l || '?', y: m.y || '', slug: m.slug || r.book_id,
      pool: 'enum', stratum: fam(m.l),
      ai: {
        verdict: r.verdict, conf: r.confidence || '', evidence: r.evidence_strength || '',
        prior: priors.map(p => [p.translator, p.pub_year, p.english_title].filter(Boolean).join(', ')).join('  |  '),
        sources: r.sources_checked || [], queries: r.queries || [],
        notes: (r.work_identified ? `[${r.work_identified}] ` : '') + (r.reasoning || ''),
      },
    };
  });
  if (SAMPLE && records.length > SAMPLE) {   // stratified-by-family spread to SAMPLE
    records.sort((a, b) => hash(a.i) - hash(b.i));
    const byF = {}; for (const r of records) (byF[r.stratum] = byF[r.stratum] || []).push(r);
    const fams = Object.keys(byF), out = []; let i = 0;
    while (out.length < SAMPLE && fams.some(f => byF[f].length)) { const f = fams[i++ % fams.length]; if (byF[f].length) out.push(byF[f].shift()); }
    records = out;
  }
} else {
  const prec = load('scripts/output/ft-claude-verdicts-raw.json') || [];
  const rec = load('scripts/output/ft-recall-verdicts-raw.json') || [];
  const meta = load('scripts/output/ft-review-meta.json') || {};
  const cands = (load('scripts/output/ft-gold-candidates.json') || {}).candidates || [];
  const stratumOf = Object.fromEntries(cands.map(c => [c.i, c.stratum]));
  const rowToRec = (r, pool) => {
    const m = meta[r.i] || {};
    return {
      i: r.i, t: m.t || r.t || '', a: m.a || '', l: m.l || '?', y: m.y || '', slug: m.slug || r.i,
      pool, stratum: pool === 'badged' ? (stratumOf[r.i] || 'NA') : 'recall-323',
      ai: { verdict: r.verdict, prior: r.prior || '', conf: r.conf || '',
        evidence: r.evidence_strength || r.evidence || '', sources: r.sources_checked || [], queries: [], notes: r.notes || '' },
    };
  };
  records = [...prec.map(r => rowToRec(r, 'badged')), ...rec.map(r => rowToRec(r, 'recall-323'))];
}

records.sort((a, b) => hash(a.i) - hash(b.i));

// mark every k-th as blind-calibration, spread across the set
const k = Math.max(1, Math.floor(records.length / BLIND_N));
records.forEach((r, idx) => { r.blind = (idx % k === 0) && records.filter(x => x.blind).length < BLIND_N ? true : false; });
// (re-mark cleanly)
let blindCount = 0;
records.forEach((r, idx) => { r.blind = (idx % k === 0 && blindCount < BLIND_N) ? (blindCount++, true) : false; });

fs.writeFileSync('scripts/output/ft-review-candidates.json', JSON.stringify({ n: records.length, blind: blindCount, records }, null, 2));
fs.writeFileSync('scripts/output/ft-review-annotator.html', HTML(records));
console.error(`Wrote ft-review-annotator.html — ${records.length} adjudications to review (${blindCount} blind-calibration).`);
console.error(`  pools: badged=${records.filter(r => r.pool === 'badged').length}  recall-323=${records.filter(r => r.pool === 'recall-323').length}`);

function HTML(recs) {
  const DATA = JSON.stringify(recs);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>First-Translation — Review/Audit Annotator</title><style>
:root{--ink:#2b2317;--muted:#6b6150;--line:#e4dccb;--paper:#f7f2e7;--card:#fffdf8;--accent:#7a5a2e;--gold:#b5893f;--green:#5d7a4e;--red:#a8492a;--blue:#41607a;--aibg:#eef3f6}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Iowan Old Style",Palatino,Georgia,serif;line-height:1.45}
.wrap{max-width:880px;margin:0 auto;padding:20px 18px 140px}
header{position:sticky;top:0;background:var(--paper);padding:12px 0;border-bottom:2px solid var(--line);z-index:10}
h1{font-size:1.25rem;margin:0 0 4px}.bar{height:8px;background:var(--line);border-radius:6px;overflow:hidden;margin-top:6px}.bar>div{height:100%;background:var(--green);width:0}
.meta{color:var(--muted);font-size:.82rem;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.meta input{padding:4px 8px;border:1px solid var(--line);border-radius:6px;font-family:inherit}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-top:16px}
.idx{color:var(--muted);font-size:.8rem}
h2{font-size:1.15rem;margin:2px 0;line-height:1.25}.sub{color:var(--muted);font-size:.9rem;margin-bottom:10px}
.tag{display:inline-block;font-size:.7rem;padding:1px 7px;border-radius:10px;border:1px solid var(--line);color:var(--muted);margin-left:6px}
.tag.blind{background:#f3e6e6;color:var(--red);border-color:var(--red)}
.aibox{background:var(--aibg);border:1px solid #cdd9e0;border-radius:9px;padding:12px 14px;margin:12px 0}
.aibox h3{margin:0 0 6px;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--blue)}
.vd{font-weight:700;font-size:1.05rem}.vd.first{color:var(--green)}.vd.neg{color:var(--red)}.vd.na{color:var(--muted)}
.kv{font-size:.88rem;margin:4px 0}.kv b{color:var(--ink)}
.src{font-size:.8rem;color:var(--muted);word-break:break-word}
.links{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.links a{font-size:.8rem;padding:4px 10px;border:1px solid var(--line);border-radius:16px;background:#fff;text-decoration:none;color:var(--blue)}
.links a:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
.links a.verify{border-color:var(--gold);color:var(--gold);font-weight:700}
fieldset{border:1px solid var(--line);border-radius:8px;margin:10px 0;padding:10px 14px}legend{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.rev label{display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:.95rem;cursor:pointer}
.chk{font-size:.9rem;display:flex;align-items:center;gap:8px;margin:8px 0;color:var(--accent)}
select,textarea,.pin{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:.9rem}
select.inline{width:auto;display:inline-block}
.nav{display:flex;justify-content:space-between;margin-top:16px;gap:10px}
button{font-family:inherit;padding:8px 18px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:.95rem}
button.sec{background:#fff;color:var(--accent)}
.done{color:var(--green);font-weight:700}.toolbar{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
.note{background:#fbf6ea;border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:.84rem;color:var(--muted);margin-top:14px}
.hidden{display:none}
</style></head><body><div class="wrap">
<header>
  <h1>First-Translation — Review / Audit</h1>
  <div class="meta">
    <span>Reviewer: <input id="annot" placeholder="your name" oninput="save()"></span>
    <span id="count">0 / ${recs.length}</span>
    <button class="sec" onclick="exportJSON()" style="padding:4px 12px;font-size:.82rem">Export reviews</button>
  </div>
  <div class="bar"><div id="prog"></div></div>
</header>
<div id="root"></div>
<div class="toolbar">
  <button class="sec" onclick="go(-1)">◀ Prev</button>
  <button class="sec" onclick="go(1)">Next ▶</button>
  <button class="sec" onclick="jumpUnreviewed()">Next unreviewed</button>
</div>
<div class="note"><b>Your job is to audit the AI's match, not re-search from scratch.</b> For each book the AI gives a verdict, the prior translation it found (if any), the sources it checked, and its reasoning. <b>Before you Agree, open the cited record</b> (the "verify" link) and confirm the prior is real and is actually <i>this</i> work — the AI's sentence describing a prior is not proof of one. Then: <b>Agree</b> if the evidence holds · <b>Override</b> (pick the correct verdict) if it's wrong · <b>Can't tell</b> if the evidence is too thin. A few books are <b>blind-calibration</b> (red tag): there the AI is hidden until you commit your own verdict — judge from the search links, then it reveals for comparison. Saves in this browser; Export when done.</div>
<script>
const DATA = ${DATA};
const VERDICTS = [
 ['first_no_prior','No prior English translation — genuine first'],
 ['first_from_source','English exists but from a DIFFERENT source language; not this text'],
 ['first_complete','Only partial/excerpt English exists → first COMPLETE'],
 ['first_modern','Only pre-1900 English exists → first MODERN'],
 ['not_first','A complete modern English translation already exists'],
 ['not_applicable','Not a translatable single work (art/map, catalogue/index, English-original, container)'],
 ['unverifiable','Cannot determine from competent sources'],
];
const FIRST=new Set(['first_no_prior','first_from_source','first_complete','first_modern']);
const KEY='ftreview_'+DATA.length;
let R = JSON.parse(localStorage.getItem(KEY)||'{}');
let cur = parseInt(localStorage.getItem(KEY+'_cur')||'0');
const annotEl=()=>document.getElementById('annot');
function save(){ localStorage.setItem(KEY,JSON.stringify(R)); localStorage.setItem(KEY+'_cur',cur); if(annotEl())localStorage.setItem(KEY+'_annot',annotEl().value); render(); }
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function vclass(v){return FIRST.has(v)?'first':(v==='not_first'?'neg':(v==='not_applicable'||v==='unverifiable'?'na':''));}
function searchLinks(b,priorText){
  const q=encodeURIComponent((b.t+' '+(b.a||'')).slice(0,120));
  const L=[];
  if(priorText && priorText.length>4 && !/^none/i.test(priorText)) L.push(['↳ verify the cited prior','https://www.google.com/search?tbm=bks&q='+encodeURIComponent(priorText.slice(0,140)),'verify']);
  L.push(['WorldCat','https://search.worldcat.org/search?q='+q,'']);
  L.push(['Google Books','https://www.google.com/search?tbm=bks&q='+q,'']);
  L.push(['Internet Archive','https://archive.org/search?query='+q,'']);
  L.push(['Scholar','https://scholar.google.com/scholar?q='+q,'']);
  const l=b.l||'';
  if(l==='Tibetan'){L.push(['84000','https://read.84000.co/search.html?q='+encodeURIComponent(b.t),'']);L.push(['BDRC','https://library.bdrc.io/search?q='+encodeURIComponent(b.t),'']);}
  if(['Chinese','Japanese','Korean'].includes(l)){L.push(['CTEXT','https://ctext.org/searchbooks.pl?if=en&searchu='+encodeURIComponent(b.t),'']);L.push(['CBETA','https://cbetaonline.dila.edu.tw/en/search?q='+encodeURIComponent(b.t),'']);}
  if(['Sanskrit','Tamil','Pali'].includes(l))L.push(['GRETIL','http://gretil.sub.uni-goettingen.de/gretil.html','']);
  if(/Hebrew|Aramaic/.test(l))L.push(['Sefaria','https://www.sefaria.org/search?q='+encodeURIComponent(b.t),'']);
  if(/Sumerian|Akkadian/.test(l))L.push(['ETCSL','https://etcsl.orinst.ox.ac.uk/','']);
  if(['Latin','Greek','Ancient Greek'].includes(l))L.push(['Perseus','https://www.perseus.tufts.edu/hopper/searchresults?q='+q,'']);
  return L;
}
function render(){
  if(annotEl()) annotEl().value = localStorage.getItem(KEY+'_annot')||'';
  const done=Object.values(R).filter(x=>x&&(x.review||x.blind_verdict)).length;
  document.getElementById('count').textContent=done+' / '+DATA.length;
  document.getElementById('prog').style.width=(100*done/DATA.length)+'%';
  const b=DATA[cur]; const st=R[b.i]||{};
  const committed = b.blind ? !!st.blind_verdict : !!st.review;
  const showAI = !b.blind || committed;
  const links=searchLinks(b, b.ai.prior || b.ai.notes).map(([n,u,c])=>'<a class="'+c+'" href="'+u+'" target="_blank" rel="noopener">'+n+'</a>').join('');
  let aiHtml='';
  if(showAI){
    const v=b.ai.verdict;
    aiHtml='<div class="aibox"><h3>AI adjudication'+(b.blind?' (revealed — you already judged)':'')+'</h3>'+
      '<div class="vd '+vclass(v)+'">'+esc(v)+'</div>'+
      (b.ai.prior?'<div class="kv"><b>Prior found:</b> '+esc(b.ai.prior)+'</div>':'')+
      '<div class="kv"><b>Confidence:</b> '+esc(b.ai.conf||'?')+' · <b>Evidence:</b> '+esc(b.ai.evidence||'?')+'</div>'+
      '<div class="kv"><b>Reasoning:</b> '+esc(b.ai.notes)+'</div>'+
      (b.ai.queries&&b.ai.queries.length?'<div class="kv"><b>Searched ('+b.ai.queries.length+'):</b> <span class="src">'+b.ai.queries.slice(0,10).map(esc).join(' · ')+'</span></div>':'')+
      (b.ai.sources&&b.ai.sources.length?'<div class="kv"><b>Sources cited:</b> <span class="src">'+b.ai.sources.map(esc).join(' · ')+'</span></div>':'')+
      '</div>';
  } else {
    aiHtml='<div class="aibox" style="text-align:center;color:var(--muted)"><h3>Blind-calibration</h3>AI verdict hidden — judge independently from the search links, then it reveals.</div>';
  }
  let controls='';
  if(b.blind && !committed){
    controls='<fieldset class="rev"><legend>Your independent verdict (blind)</legend>'+
      '<select class="inline" id="bv" onchange="setBlind(this.value)"><option value="">— pick —</option>'+
      VERDICTS.map(([k,d])=>'<option value="'+k+'"'+(st.blind_verdict===k?' selected':'')+'>'+k+' — '+d+'</option>').join('')+'</select></fieldset>';
  } else {
    const rv=st.review||'';
    controls='<fieldset class="rev"><legend>Your audit of the AI verdict</legend>'+
      '<label><input type="radio" name="rev" '+(rv==='agree'?'checked':'')+' onchange="setRev(\\'agree\\')"> ✓ Agree — evidence checks out</label>'+
      '<label><input type="radio" name="rev" '+(rv==='override'?'checked':'')+' onchange="setRev(\\'override\\')"> ✗ Override</label>'+
      '<label><input type="radio" name="rev" '+(rv==='uncertain'?'checked':'')+' onchange="setRev(\\'uncertain\\')"> ? Can\\'t tell</label>'+
      (rv==='override'?'<div style="margin-top:8px"><select class="inline" onchange="setF(\\'human_verdict\\',this.value)"><option value="">— correct verdict —</option>'+VERDICTS.map(([k,d])=>'<option value="'+k+'"'+(st.human_verdict===k?' selected':'')+'>'+k+'</option>').join('')+'</select></div>':'')+
      '<div class="chk"><label><input type="checkbox" '+(st.checked_record?'checked':'')+' onchange="setF(\\'checked_record\\',this.checked)"> I opened the cited record / search and confirmed</label></div>'+
      '</fieldset>';
  }
  document.getElementById('root').innerHTML=
    '<div class="card"><div class="idx">#'+(cur+1)+' of '+DATA.length+' · '+b.pool+' · '+b.stratum+
      (b.blind?'<span class="tag blind">blind-calibration</span>':'')+
      (committed||st.review?' · <span class="done">reviewed ✓</span>':'')+'</div>'+
    '<h2><a href="https://sourcelibrary.org/book/'+esc(b.slug)+'" target="_blank" rel="noopener" style="color:inherit">'+esc(b.t)+'</a></h2>'+
    '<div class="sub">'+esc(b.a)+' · '+esc(b.l)+' · '+esc(String(b.y))+'</div>'+
    '<div class="links">'+links+'</div>'+
    aiHtml+
    controls+
    '<fieldset><legend>Notes (optional — esp. if overriding)</legend><textarea rows="2" oninput="setF(\\'notes\\',this.value)" placeholder="what you found at the cited record; why you overrode">'+esc(st.notes||'')+'</textarea></fieldset>'+
    '<div class="nav"><button class="sec" onclick="go(-1)">◀ Prev</button><button onclick="go(1)">Save &amp; Next ▶</button></div></div>';
}
function setRev(v){R[DATA[cur].i]=Object.assign({},R[DATA[cur].i],{review:v});save();}
function setBlind(v){R[DATA[cur].i]=Object.assign({},R[DATA[cur].i],{blind_verdict:v});save();}
function setF(f,v){R[DATA[cur].i]=Object.assign({},R[DATA[cur].i],{[f]:v});save();}
function go(d){cur=Math.max(0,Math.min(DATA.length-1,cur+d));save();window.scrollTo(0,0);}
function jumpUnreviewed(){const i=DATA.findIndex(b=>{const s=R[b.i]||{};return b.blind?!s.blind_verdict:!s.review;});if(i>=0){cur=i;save();window.scrollTo(0,0);}else alert('All reviewed — Export!');}
function exportJSON(){
  const out={reviewer:annotEl().value,mode:'review+blind',exported_at:new Date().toISOString(),n:DATA.length,
    reviews:DATA.map(b=>{const s=R[b.i]||{};
      const human = b.blind ? (s.blind_verdict||null) : (s.review==='agree'?b.ai.verdict:(s.review==='override'?(s.human_verdict||null):null));
      return {i:b.i,t:b.t,l:b.l,pool:b.pool,stratum:b.stratum,blind:!!b.blind,
        ai_verdict:b.ai.verdict,ai_prior:b.ai.prior,
        review:s.review||null,blind_verdict:s.blind_verdict||null,human_verdict:human,
        checked_record:!!s.checked_record,notes:s.notes||''};})};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ft-review-'+(annotEl().value||'anon').replace(/\\s+/g,'_')+'.json';a.click();
}
render();
</script></div></body></html>`;
}
