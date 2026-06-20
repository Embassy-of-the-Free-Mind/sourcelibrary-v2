#!/usr/bin/env node
/**
 * build-gold-annotator.mjs — first-translation HUMAN gold-standard system (sampler + annotator).
 *
 * Draws a STRATIFIED random sample of flagged-first books and generates a
 * self-contained HTML annotation tool a librarian/scholar uses to assign the
 * ground-truth verdict for each. Output is the gold-standard label set that
 * (a) anchors the paper and (b) calibrates the LLM adjudicators (sens/spec).
 *
 * Methodology choices:
 *  - Strata = language-family × catalogue-density (author present in our
 *    translation_catalogs). Each stratum records its POPULATION size so labels
 *    can be re-weighted to a corpus estimate.
 *  - Allocation = proportional with a floor (small traditions stay represented).
 *  - NO anchoring: the AI suggestion is HIDDEN until the annotator commits a
 *    verdict (then revealable), so human labels stay independent — and we can
 *    measure human↔model agreement honestly.
 *  - Per-book SMART SEARCH LINKS (WorldCat/Google Books/IA + tradition catalogues
 *    84000/CTEXT/CBETA/GRETIL/ETCSL/Perseus) so the human can verify fast.
 *  - Persists to localStorage; exports a JSON label file for score-gold-standard.mjs.
 *
 * USAGE:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/build-gold-annotator.mjs            # default N=150
 *   node scripts/eval/build-gold-annotator.mjs --n 300    # tighter CI
 * Output: scripts/output/ft-gold-annotator.html  (open in a browser, share with annotator)
 *         scripts/output/ft-gold-candidates.json (the drawn sample + strata weights)
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const N = (() => { const i = process.argv.indexOf('--n'); return i > -1 ? parseInt(process.argv[i + 1], 10) : 150; })();
const FLOOR = 12; // minimum per non-empty stratum

const uri = process.env.MONGODB_URI || process.env.DATABASE_URL || process.env.MONGO_URI;
const c = new MongoClient(uri);
await c.connect();
const db = c.db('bookstore');
const B = db.collection('books');
const TC = db.collection('translation_catalogs');

const lat = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastnames = a => (a || '').split(/[|;]/).map(p => { const t = lat(p); const parts = t.split(' '); return p.includes(',') ? parts[0] : parts[parts.length - 1]; }).filter(x => x && x.length > 3);
function fam(l) {
  l = l || '';
  if (['Latin', 'Greek', 'Ancient Greek', 'German', 'French', 'Italian', 'Spanish', 'Dutch', 'English', 'Portuguese', 'Latin-German'].includes(l)) return 'Western';
  if (['Chinese', 'Japanese', 'Korean'].includes(l)) return 'CJK';
  if (l === 'Tibetan') return 'Tibetan';
  if (['Sanskrit', 'Tamil', 'Pali'].includes(l)) return 'Indic';
  if (/Hebrew|Arabic|Syriac|Aramaic|Judeo|Ge'ez|Ge’ez|Armenian|Sumerian|Akkadian/.test(l)) return 'Semitic/NearEast';
  return 'Other';
}

// catalogue keys for density proxy
const catKeys = new Set();
for await (const r of TC.find({}, { projection: { author: 1, author_normalized: 1 } })) {
  for (const k of lastnames(r.author)) catKeys.add(k);
  for (const k of lastnames(r.author_normalized)) catKeys.add(k);
}
const inCat = b => lastnames(b.author).some(k => catKeys.has(k));

const base = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } };
const all = await B.find(base, { projection: { title: 1, author: 1, original_language: 1, language: 1, year: 1, published: 1, slug: 1 } }).toArray();

// build strata
const strata = {};
for (const b of all) {
  const f = fam(b.original_language || b.language);
  const dens = (f === 'Western') ? (inCat(b) ? 'dense' : 'sparse') : 'na';
  const key = `${f}|${dens}`;
  (strata[key] = strata[key] || []).push(b);
}
// allocate n per stratum (proportional + floor), capped at stratum size
const total = all.length;
const alloc = {};
let allocated = 0;
for (const [k, arr] of Object.entries(strata)) {
  let n = Math.max(FLOOR, Math.round(N * arr.length / total));
  n = Math.min(n, arr.length);
  alloc[k] = n; allocated += n;
}
// trim/expand to ~N from the largest strata
const keysBySize = Object.keys(strata).sort((a, b) => strata[b].length - strata[a].length);
while (allocated > N) { for (const k of keysBySize) { if (allocated <= N) break; if (alloc[k] > FLOOR) { alloc[k]--; allocated--; } } }

const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// optional AI hints (revealed only after human commits) from prior runs
const hint = {};
for (const f of ['ft-random80-sonnet', 'ft-random80-lite', 'ft-sonnet-verdicts', 'ft-lite-gt-results', 'ft-3way-merged']) {
  try {
    const rows = JSON.parse(fs.readFileSync(`scripts/output/${f}.json`, 'utf8'));
    for (const r of rows) { const id = r.i; if (!id) continue; hint[id] = hint[id] || {}; if (r.sonnet) hint[id].sonnet = r.sonnet; if (r.lite) hint[id].lite = r.lite; }
  } catch {}
}

const candidates = [];
for (const [k, arr] of Object.entries(strata)) {
  const n = alloc[k] || 0;
  for (const b of shuf([...arr]).slice(0, n)) {
    candidates.push({
      i: String(b._id), t: b.title || '', a: b.author || '', l: b.original_language || b.language || '?',
      y: b.year || b.published || '', slug: b.slug || String(b._id), stratum: k,
      stratum_pop: arr.length, ai: hint[String(b._id)] || null,
    });
  }
}
shuf(candidates);

const meta = { drawn: candidates.length, population: total, strata: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, { pop: v.length, sampled: alloc[k] || 0 }])) };
fs.writeFileSync('scripts/output/ft-gold-candidates.json', JSON.stringify({ meta, candidates }, null, 2));
await c.close();

const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = ANNOTATOR_HTML(candidates, meta);
fs.writeFileSync('scripts/output/ft-gold-annotator.html', html);
console.log(`Drew ${candidates.length} of ${total} flagged-first (target ${N}).`);
console.log('Strata:', JSON.stringify(meta.strata));
console.log('Wrote scripts/output/ft-gold-annotator.html  and  ft-gold-candidates.json');

function ANNOTATOR_HTML(cands, meta) {
  const DATA = JSON.stringify(cands);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>First-Translation Gold Standard — Annotator</title><style>
:root{--ink:#2b2317;--muted:#6b6150;--line:#e4dccb;--paper:#f7f2e7;--card:#fffdf8;--accent:#7a5a2e;--gold:#b5893f;--green:#5d7a4e;--red:#a8492a;--blue:#41607a}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Iowan Old Style",Palatino,Georgia,serif;line-height:1.45}
.wrap{max-width:880px;margin:0 auto;padding:20px 18px 120px}
header{position:sticky;top:0;background:var(--paper);padding:12px 0;border-bottom:2px solid var(--line);z-index:10}
h1{font-size:1.3rem;margin:0 0 4px}.bar{height:8px;background:var(--line);border-radius:6px;overflow:hidden;margin-top:6px}.bar>div{height:100%;background:var(--green);width:0}
.meta{color:var(--muted);font-size:.82rem;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.meta input{padding:4px 8px;border:1px solid var(--line);border-radius:6px;font-family:inherit}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-top:16px}
.idx{color:var(--muted);font-size:.8rem}
h2{font-size:1.18rem;margin:2px 0 2px;line-height:1.25}.sub{color:var(--muted);font-size:.9rem;margin-bottom:10px}
.links{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}
.links a{font-size:.8rem;padding:4px 10px;border:1px solid var(--line);border-radius:16px;background:#fff;text-decoration:none;color:var(--blue)}
.links a:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
fieldset{border:1px solid var(--line);border-radius:8px;margin:10px 0;padding:10px 14px}legend{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.verdicts label{display:block;padding:4px 0;font-size:.95rem;cursor:pointer}.verdicts input{margin-right:8px}
.vk{font-weight:700}.vd{color:var(--muted);font-size:.82rem}
textarea,.pin{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font-family:inherit;font-size:.9rem}
.conf{display:flex;gap:14px;margin-top:6px}.conf label{font-size:.9rem}
.nav{display:flex;justify-content:space-between;margin-top:16px;gap:10px}
button{font-family:inherit;padding:8px 18px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:.95rem}
button.sec{background:#fff;color:var(--accent)}
.ai{margin-top:10px;font-size:.85rem;color:var(--muted)}.ai button{padding:3px 10px;font-size:.78rem}
.reveal{background:#f3eede;border:1px dashed var(--gold);border-radius:6px;padding:8px 10px;margin-top:6px;color:var(--ink)}
.done{color:var(--green);font-weight:700}.toolbar{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
.note{background:#fbf6ea;border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:.84rem;color:var(--muted);margin-top:14px}
</style></head><body><div class="wrap">
<header>
  <h1>First-Translation Gold Standard — Annotator</h1>
  <div class="meta">
    <span>Annotator: <input id="annot" placeholder="your name" oninput="save()"></span>
    <span id="count">0 / ${cands.length}</span>
    <button class="sec" onclick="exportJSON()" style="padding:4px 12px;font-size:.82rem">Export labels</button>
  </div>
  <div class="bar"><div id="prog"></div></div>
</header>
<div id="root"></div>
<div class="toolbar">
  <button class="sec" onclick="go(-1)">◀ Prev</button>
  <button class="sec" onclick="go(1)">Next ▶</button>
  <button class="sec" onclick="jumpUnlabeled()">Next unlabeled</button>
</div>
<div class="note"><b>Rubric.</b> Answer: <b>does a prior ENGLISH translation of THIS work already exist?</b> The held book may itself be the original-language text (a Latin/Greek/etc. facsimile) — that is still a valid translation candidate; if a prior English translation of the work exists, choose <i>not_first</i>. Use <i>not_applicable</i> only for non-textual works (art/plates/maps), pure reference lists (sales catalogues/library indexes), works already written in English, or multi-work container anthologies. A translation of the work from a <i>different</i> source language does not count (source-language rule). Partial/excerpt prior → <i>first_complete</i>; only pre-1900 prior → <i>first_modern</i>. If you cannot determine it from competent sources → <i>unverifiable</i>. Your verdicts save in this browser; Export when done (and email the file).</div>
<script>
const DATA = ${DATA};
const VERDICTS = [
 ['first_no_prior','No prior English translation found — genuine first'],
 ['first_from_source','English exists of the work, but from a DIFFERENT source language; not this text'],
 ['first_complete','Only partial/excerpt English exists → this is the first COMPLETE'],
 ['first_modern','Only an antiquated (pre-1900) English exists → first MODERN'],
 ['not_first','A complete modern English translation of this text already exists'],
 ['not_applicable','Not a translatable work (art/plates/map, catalogue/index, English-original, container)'],
 ['unverifiable','Cannot determine from competent sources (e.g. catalogue-blind tradition)'],
];
const KEY='ftgold_'+DATA.length;
let labels = JSON.parse(localStorage.getItem(KEY)||'{}');
let cur = parseInt(localStorage.getItem(KEY+'_cur')||'0');
const annotEl=()=>document.getElementById('annot');
function save(){ localStorage.setItem(KEY,JSON.stringify(labels)); localStorage.setItem(KEY+'_cur',cur); localStorage.setItem(KEY+'_annot',annotEl().value); render(); }
function tradLinks(b){
  const q=encodeURIComponent((b.t+' '+b.a).slice(0,120));
  const L=[['WorldCat','https://search.worldcat.org/search?q='+q],['Google Books','https://www.google.com/search?tbm=bks&q='+q],['Internet Archive','https://archive.org/search?query='+q],['Scholar','https://scholar.google.com/scholar?q='+q]];
  const l=b.l||'';
  if(l==='Tibetan'){L.push(['84000','https://read.84000.co/search.html?q='+encodeURIComponent(b.t)]);L.push(['BDRC','https://library.bdrc.io/search?q='+encodeURIComponent(b.t)]);L.push(['Lotsawa House','https://www.lotsawahouse.org/search?q='+encodeURIComponent(b.t)]);}
  if(['Chinese','Japanese','Korean'].includes(l)){L.push(['CTEXT','https://ctext.org/searchbooks.pl?if=en&searchu='+encodeURIComponent(b.t)]);L.push(['CBETA','https://cbetaonline.dila.edu.tw/en/search?q='+encodeURIComponent(b.t)]);}
  if(['Sanskrit','Tamil','Pali'].includes(l)){L.push(['GRETIL','http://gretil.sub.uni-goettingen.de/gretil.html']);}
  if(/Sumerian|Akkadian/.test(l)){L.push(['ETCSL','https://etcsl.orinst.ox.ac.uk/']);}
  if(['Latin','Greek','Ancient Greek'].includes(l)){L.push(['Perseus','https://www.perseus.tufts.edu/hopper/searchresults?q='+q]);}
  return L;
}
function render(){
  if(annotEl()) annotEl().value = localStorage.getItem(KEY+'_annot')||'';
  const done=Object.values(labels).filter(x=>x&&x.verdict).length;
  document.getElementById('count').textContent=done+' / '+DATA.length;
  document.getElementById('prog').style.width=(100*done/DATA.length)+'%';
  const b=DATA[cur]; const lab=labels[b.i]||{};
  const links=tradLinks(b).map(([n,u])=>'<a href="'+u+'" target="_blank" rel="noopener">'+n+'</a>').join('');
  const verds=VERDICTS.map(([k,d])=>'<label><input type="radio" name="v" value="'+k+'" '+(lab.verdict===k?'checked':'')+' onchange="setV(\\''+k+'\\')"><span class="vk">'+k+'</span> — <span class="vd">'+d+'</span></label>').join('');
  let aiHtml='';
  if(b.ai){ const revealed=lab.aiRevealed;
    aiHtml='<div class="ai">'+(revealed? '<div class="reveal">AI suggestions — Sonnet: <b>'+(b.ai.sonnet||'-')+'</b> · flash-lite: <b>'+(b.ai.lite||'-')+'</b> (for reference only)</div>' : (lab.verdict? '<button onclick="reveal()">Reveal AI suggestion (after deciding)</button>' : '<i>AI suggestion hidden until you pick a verdict (avoids anchoring).</i>'))+'</div>'; }
  document.getElementById('root').innerHTML=
    '<div class="card"><div class="idx">#'+(cur+1)+' of '+DATA.length+' · stratum '+b.stratum+(lab.verdict?' · <span class="done">labeled ✓</span>':'')+'</div>'+
    '<h2><a href="https://sourcelibrary.org/book/'+b.slug+'" target="_blank" rel="noopener" style="color:inherit">'+escapeHtml(b.t)+'</a></h2>'+
    '<div class="sub">'+escapeHtml(b.a)+' · '+escapeHtml(b.l)+' · '+escapeHtml(String(b.y))+'</div>'+
    '<div class="links">'+links+'</div>'+
    '<fieldset class="verdicts"><legend>Verdict — does a prior English translation of THIS work exist?</legend>'+verds+'</fieldset>'+
    '<fieldset><legend>Prior translation (if any) — translator, year, title</legend><input class="pin" value="'+escapeHtml(lab.prior||'')+'" oninput="setF(\\'prior\\',this.value)" placeholder="e.g. Shelton, 1612 — or: none found"></fieldset>'+
    '<fieldset><legend>Confidence</legend><div class="conf">'+['low','medium','high'].map(c=>'<label><input type="radio" name="conf" '+(lab.conf===c?'checked':'')+' onchange="setF(\\'conf\\',\\''+c+'\\')"> '+c+'</label>').join('')+'</div></fieldset>'+
    '<fieldset><legend>Notes / sources checked</legend><textarea rows="2" oninput="setF(\\'notes\\',this.value)" placeholder="catalogues searched, reasoning, edge cases">'+escapeHtml(lab.notes||'')+'</textarea></fieldset>'+
    aiHtml+
    '<div class="nav"><button class="sec" onclick="go(-1)">◀ Prev</button><button onclick="go(1)">Save &amp; Next ▶</button></div></div>';
}
function escapeHtml(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function setV(v){labels[DATA[cur].i]=Object.assign({},labels[DATA[cur].i],{verdict:v});save();}
function setF(f,v){labels[DATA[cur].i]=Object.assign({verdict:''},labels[DATA[cur].i],{[f]:v});save();}
function reveal(){labels[DATA[cur].i]=Object.assign({},labels[DATA[cur].i],{aiRevealed:true});save();}
function go(d){cur=Math.max(0,Math.min(DATA.length-1,cur+d));save();window.scrollTo(0,0);}
function jumpUnlabeled(){const i=DATA.findIndex(b=>!(labels[b.i]&&labels[b.i].verdict));if(i>=0){cur=i;save();window.scrollTo(0,0);}else alert('All labeled — Export!');}
function exportJSON(){
  const out={annotator:annotEl().value,exported_at:new Date().toISOString(),n:DATA.length,
    labels:DATA.map(b=>({i:b.i,t:b.t,l:b.l,stratum:b.stratum,stratum_pop:b.stratum_pop,
      verdict:(labels[b.i]||{}).verdict||null,prior:(labels[b.i]||{}).prior||'',conf:(labels[b.i]||{}).conf||'',notes:(labels[b.i]||{}).notes||'',ai:b.ai}))};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ft-gold-labels-'+(annotEl().value||'anon').replace(/\\s+/g,'_')+'.json';a.click();
}
render();
</script></div></body></html>`;
}
