#!/usr/bin/env node
/**
 * Export the human gold-standard review subset for the n≈250 gap validation (#2684).
 *
 * Selects a stratified ~40-work subset (strata × era × AI-verdict, oversampling
 * the consequential/uncertain cells) and writes a self-contained REVIEW HTML in
 * audit mode (systematic-review division of labour: the AI searched, the human
 * audits the search — Agree / Override / Can't-tell, with click-through to the
 * cited record). The captured labels feed gap-validation-gold-score.mjs, which
 * measures each adjudicator's sensitivity/specificity for the Rogan–Gladen
 * correction (see ft-first-translation-paper.md §6).
 *
 * Reads:  eval-data/gap-validation-n250-results.json, -frame.json,
 *         -claude-verdicts.jsonl, -gemini-verdicts.jsonl
 * Writes: eval-data/gap-validation-gold-subset.json  (the picked works + AI evidence)
 *         eval-data/gap-validation-gold-review.html   (open in a browser to label)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EVAL, f), 'utf8'));
const rdl = (f) => fs.readFileSync(path.join(EVAL, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const TARGET = parseInt(process.argv[2] || '40', 10);

const results = rd('gap-validation-n250-results.json');
const frame = new Map(rd('gap-validation-n250-frame.json').works.map((w) => [w.key, w]));
const cla = new Map(rdl('gap-validation-claude-verdicts.jsonl').map((r) => [r.key, r]));
const gem = new Map(rdl('gap-validation-gemini-verdicts.jsonl').map((r) => [r.key, r]));

// deterministic shuffle (seed)
let seed = 4242;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuf = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// build cells: label × era-class × consensus-state, plus a dedicated disagreement cell
const eraClass = (e) => (e === 'antiquity' || e === 'medieval') ? 'ancmed' : (e === 'renaissance_early_modern' ? 'ren' : 'unk');
const cellOf = (r) => r.disagree ? `${r.label}.DISAGREE` : `${r.label}.${eraClass(r.era)}.${r.consensus === true ? 'T' : r.consensus === false ? 'U' : 'ILL'}`;
const cells = new Map();
for (const r of results.rows) { const c = cellOf(r); if (!cells.has(c)) cells.set(c, []); cells.get(c).push(r); }

// allocate: 1 per cell minimum, then round-robin fill to TARGET, prioritising
// consequential cells (disagreements, ill-posed, Renaissance gap, translated precision)
const priority = (c) => c.includes('DISAGREE') ? 0 : c.includes('ILL') ? 1 : c.startsWith('gap.ren') ? 2 : c.startsWith('translated.ren') ? 3 : 4;
const cellKeys = [...cells.keys()].sort((a, b) => priority(a) - priority(b));
const picked = [];
const pickedSet = new Set();
const take = (c) => { const pool = shuf(cells.get(c)).filter((r) => !pickedSet.has(r.key)); if (pool.length) { picked.push(pool[0]); pickedSet.add(pool[0].key); } };
for (const c of cellKeys) take(c);                 // 1 per cell
let i = 0;
while (picked.length < TARGET && i < 1000) { take(cellKeys[i % cellKeys.length]); i++; }

const subset = picked.map((r) => {
  const f = frame.get(r.key), c = cla.get(r.key), g = gem.get(r.key);
  return {
    key: r.key, pipeline_label: r.label, author: f.author, title: f.title, print_year: f.print_year_min,
    composition_era: r.era,
    claude: { verdict: c?.translation_verdict, relationship: c?.relationship, prior: c?.prior, url: c?.evidence_url, strength: c?.evidence_strength, sources: (c?.sources || []).slice(0, 5), reasoning: c?.reasoning },
    gemini: { verdict: g?.translation_verdict, relationship: g?.relationship, prior: g?.prior, url: g?.evidence_url, strength: g?.evidence_strength, sources: (g?.sources || []).slice(0, 5), reasoning: g?.reasoning },
    human: null, // to be filled: { verdict:'translated|untranslated|cant_tell', opened_record:bool, note:'' }
  };
});
fs.writeFileSync(path.join(EVAL, 'gap-validation-gold-subset.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), n: subset.length, target: TARGET, works: subset }, null, 2));

// --- review HTML (audit mode) ---
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const card = (w, idx) => `
<div class="card" data-key="${w.key}">
 <h3>#${idx + 1} · ${esc(w.author)} <span class="muted">(${w.print_year})</span></h3>
 <div class="title">${esc(w.title)}</div>
 <div class="meta">era (AI): <b>${esc(w.composition_era)}</b> · pipeline label: <b>${esc(w.pipeline_label)}</b></div>
 ${['claude', 'gemini'].map((m) => `
  <div class="adj"><b>${m}</b>: <span class="v ${w[m].verdict}">${esc(w[m].verdict)}</span> / ${esc(w[m].relationship)} · ${esc(w[m].strength)}
   ${w[m].prior ? `<div class="prior">prior: ${esc(w[m].prior)} ${w[m].url ? `<a href="${esc(w[m].url)}" target="_blank">[open record]</a>` : ''}</div>` : ''}
   <div class="why">${esc(w[m].reasoning)}</div>
   <div class="src">${(w[m].sources || []).map((s) => `<a href="${esc(s)}" target="_blank">${esc(s.replace(/^https?:\/\//, '').slice(0, 45))}</a>`).join(' · ')}</div>
  </div>`).join('')}
 <div class="verdict-row">
  <label>Your verdict (open a cited record first):</label>
  <button class="b" data-v="translated">complete prior EXISTS</button>
  <button class="b" data-v="untranslated">NO complete prior</button>
  <button class="b" data-v="cant_tell">can't tell</button>
  <label><input type="checkbox" class="opened"> I opened a cited record</label>
  <input class="note" placeholder="note (optional)">
 </div>
</div>`;

const html = `<!doctype html><meta charset=utf8><title>Gap validation — gold review</title>
<style>
 body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#222}
 .card{border:1px solid #ddd;border-radius:10px;padding:14px 16px;margin:16px 0}
 h3{margin:0 0 4px} .title{font-style:italic;color:#444;margin-bottom:6px} .muted{color:#999;font-weight:400}
 .meta{font-size:13px;color:#666;margin-bottom:8px}
 .adj{background:#f7f7f8;border-radius:7px;padding:8px 10px;margin:6px 0;font-size:13px}
 .v.translated{color:#0a7} .v.untranslated{color:#b40} .v.uncertain{color:#a70}
 .prior{margin:3px 0;color:#225} .why{color:#555;margin:3px 0} .src a{color:#69c;font-size:12px;margin-right:4px}
 .verdict-row{margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
 .b{padding:6px 10px;border:1px solid #bbb;background:#fff;border-radius:6px;cursor:pointer}
 .b.sel{background:#222;color:#fff;border-color:#222} .note{flex:1;min-width:160px;padding:5px}
 #bar{position:sticky;top:0;background:#fff;border-bottom:1px solid #eee;padding:10px 0;display:flex;gap:10px;align-items:center;z-index:9}
 #exp{padding:8px 14px;background:#0a7;color:#fff;border:0;border-radius:6px;cursor:pointer}
</style>
<div id=bar><b>Gap validation — human gold review (${subset.length})</b><span id=prog></span><button id=exp>Export labels JSON</button>
 <span class=muted>Audit the AI search; open a record before deciding. Override freely.</span></div>
${subset.map(card).join('')}
<script>
const state={};
document.querySelectorAll('.card').forEach(card=>{const key=card.dataset.key;state[key]={};
 card.querySelectorAll('.b').forEach(b=>b.onclick=()=>{card.querySelectorAll('.b').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');state[key].verdict=b.dataset.v;prog();});
 card.querySelector('.opened').onchange=e=>{state[key].opened_record=e.target.checked;};
 card.querySelector('.note').oninput=e=>{state[key].note=e.target.value;};
});
function prog(){const done=Object.values(state).filter(s=>s.verdict).length;document.getElementById('prog').textContent=' '+done+'/'+${subset.length}+' labeled';}
document.getElementById('exp').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='gap-validation-gold-labels.json';a.click();};
prog();
</script>`;
fs.writeFileSync(path.join(EVAL, 'gap-validation-gold-review.html'), html);

const cellTally = {};
for (const r of picked) cellTally[cellOf(r)] = (cellTally[cellOf(r)] || 0) + 1;
console.log(`gold subset: ${subset.length} works across ${Object.keys(cellTally).length} cells`);
console.log(JSON.stringify(cellTally, null, 0));
console.log(`wrote gap-validation-gold-subset.json + gap-validation-gold-review.html`);
console.log(`→ open the HTML, label, click "Export labels JSON", drop it next to the subset, then run gap-validation-gold-score.mjs`);
