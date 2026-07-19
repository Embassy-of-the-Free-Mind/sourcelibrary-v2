#!/usr/bin/env node
// Experiment-arm analysis for the scorecard's tagged runs (#3235).
//
// The scorecard tags manipulated runs on the MODEL field: `flash@w600` is the
// flash model on a 600px-wide render of the same page, `lite@annotated` is lite
// under the production annotated OCR prompt. Untagged rows are the baseline
// (native resolution, bare transcription prompt), so every arm is a within-page,
// within-model contrast — the only thing that moves is the manipulated factor.
//
//   node scripts/eval/report-arms.mjs [observations.jsonl]
import fs from 'fs';

const file = process.argv[2] || `scripts/eval/observations/ocr-observations-${new Date().toISOString().slice(0, 10)}.jsonl`;
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(r => r.slug && r.source === 'api');

const base = m => m.split('@')[0];
const tag = m => m.includes('@') ? m.split('@')[1] : 'native';
const short = m => base(m).replace('gemini-3.1-pro-preview', 'pro').replace('gemini-3-flash-preview', 'flash')
  .replace('gemini-3.1-flash-lite-preview', 'lite').replace('gemini-3.1-flash-lite', 'lite')
  .replace('claude-sonnet-5', 'sonnet5');

const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
const pct = x => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '  —  ';

// cell = (slug, model, tag) → { aligned rate, conditional acc, unconditional acc, truncation }
const cells = new Map();
for (const r of rows) {
  const k = [r.slug, short(r.model), tag(r.model)].join('|');
  if (!cells.has(k)) cells.set(k, { n: 0, aligned: 0, cond: [], raw: [], trunc: 0 });
  const c = cells.get(k);
  c.n++;
  if (r.aligned) { c.aligned++; c.cond.push(r.char_accuracy); }
  if (r.char_accuracy_raw != null) c.raw.push(r.char_accuracy_raw);
  if (r.finish_reason === 'MAX_TOKENS') c.trunc++;
}
const cell = (slug, model, t) => cells.get([slug, model, t].join('|'));

// ---- Resolution ablation: native vs w2000 / w1000 / w600 on the same pages ----
const widths = ['native', 'w2000', 'w1000', 'w600'];
const resSlugs = [...new Set([...cells.keys()].filter(k => k.endsWith('|w600')).map(k => k.split('|')[0]))].sort();
const resModels = [...new Set([...cells.keys()].filter(k => k.endsWith('|w600')).map(k => k.split('|')[1]))].sort();

console.log('\n=== resolution ablation — unconditional accuracy (all runs), same page × model ===');
console.log('   (accuracy of 0 on a non-aligned run is included: this is the number a user gets)');
for (const m of resModels) {
  console.log(`\n${m}`);
  console.log(`  ${'page'.padEnd(34)} ${widths.map(w => w.padStart(8)).join('')}   truncation(native→600)`);
  for (const s of resSlugs) {
    const line = widths.map(w => pct(mean(cell(s, m, w)?.raw || [])).padStart(8)).join('');
    const t0 = cell(s, m, 'native'), t3 = cell(s, m, 'w600');
    const tr = `${t0 ? Math.round(t0.trunc / t0.n * 100) : 0}% → ${t3 ? Math.round(t3.trunc / t3.n * 100) : 0}%`;
    console.log(`  ${s.slice(0, 34).padEnd(34)} ${line}   ${tr}`);
  }
  const pooled = widths.map(w => pct(mean(resSlugs.flatMap(s => cell(s, m, w)?.raw || []))).padStart(8)).join('');
  console.log(`  ${'POOLED'.padEnd(34)} ${pooled}`);
}

// ---- Prompt ablation: bare (native) vs production annotated prompt ----
const promptSlugs = [...new Set([...cells.keys()].filter(k => k.endsWith('|annotated')).map(k => k.split('|')[0]))].sort();
const promptModels = [...new Set([...cells.keys()].filter(k => k.endsWith('|annotated')).map(k => k.split('|')[1]))].sort();

console.log('\n\n=== prompt ablation — bare transcription vs production annotated prompt ===');
console.log('   delta = annotated minus bare (positive = the annotation contract HELPS)');
for (const m of promptModels) {
  const bareRaw = [], annRaw = [], bareCond = [], annCond = [];
  let bareAl = 0, bareN = 0, annAl = 0, annN = 0, bareTr = 0, annTr = 0;
  const perPage = [];
  for (const s of promptSlugs) {
    const b = cell(s, m, 'native'), a = cell(s, m, 'annotated');
    if (!b || !a) continue;
    bareRaw.push(...b.raw); annRaw.push(...a.raw);
    bareCond.push(...b.cond); annCond.push(...a.cond);
    bareAl += b.aligned; bareN += b.n; annAl += a.aligned; annN += a.n;
    bareTr += b.trunc; annTr += a.trunc;
    perPage.push({ s, d: mean(a.raw) - mean(b.raw) });
  }
  if (!bareN) continue;
  const d = (mean(annRaw) - mean(bareRaw)) * 100;
  console.log(`\n${m}  (${perPage.length} pages with both arms)`);
  console.log(`  unconditional acc   bare ${pct(mean(bareRaw))}   annotated ${pct(mean(annRaw))}   delta ${d >= 0 ? '+' : ''}${d.toFixed(2)}pp`);
  console.log(`  conditional acc     bare ${pct(mean(bareCond))}   annotated ${pct(mean(annCond))}`);
  console.log(`  aligned rate        bare ${pct(bareAl / bareN)}   annotated ${pct(annAl / annN)}`);
  console.log(`  truncation          bare ${pct(bareTr / bareN)}   annotated ${pct(annTr / annN)}`);
  const worst = perPage.filter(p => Number.isFinite(p.d)).sort((a, b) => a.d - b.d);
  if (worst.length) {
    console.log(`  worst pages: ${worst.slice(0, 3).map(p => `${p.s} ${(p.d * 100).toFixed(1)}pp`).join(', ')}`);
    console.log(`  best  pages: ${worst.slice(-3).reverse().map(p => `${p.s} +${(p.d * 100).toFixed(1)}pp`).join(', ')}`);
  }
}

// ---- Prompt ablation split by canonicity (does the contract interact with recitation?) ----
console.log('\n\n=== prompt ablation × canonicity (unconditional accuracy) ===');
const canonOf = new Map(rows.map(r => [r.slug, r.page_class?.canonical_text === false ? 'noncanon' : 'canon']));
for (const m of promptModels) {
  const acc = { canon: { bare: [], ann: [] }, noncanon: { bare: [], ann: [] } };
  for (const s of promptSlugs) {
    const b = cell(s, m, 'native'), a = cell(s, m, 'annotated');
    if (!b || !a) continue;
    acc[canonOf.get(s)].bare.push(...b.raw);
    acc[canonOf.get(s)].ann.push(...a.raw);
  }
  const fmt = c => `${pct(mean(acc[c].bare))} → ${pct(mean(acc[c].ann))} (${((mean(acc[c].ann) - mean(acc[c].bare)) * 100).toFixed(2)}pp, n=${acc[c].bare.length})`;
  console.log(`  ${m.padEnd(8)} canon ${fmt('canon')}   noncanon ${fmt('noncanon')}`);
}
console.log('');
