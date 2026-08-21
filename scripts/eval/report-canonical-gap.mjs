#!/usr/bin/env node
// Canonical vs non-canonical gap analysis over the observations dataset (#3235).
// The gap ≈ the memorization subsidy: how much better models score on passages
// they can recite vs passages they can only read. Same-book contrasts control
// for edition/scan difficulty; pooled numbers are confounded by page mix.
//   node scripts/eval/report-canonical-gap.mjs [observations.jsonl]
import fs from 'fs';

const file = process.argv[2] || `scripts/eval/observations/ocr-observations-${new Date().toISOString().slice(0, 10)}.jsonl`;
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(r => r.slug && r.page_class); // reference-scored rows only

const label = r => r.page_class.canonical_text === false ? 'noncanon' : 'canon';
const shortModel = m => m.replace('gemini-3.1-pro-preview', 'pro').replace('gemini-3-flash-preview', 'flash')
  .replace('gemini-3.1-flash-lite-preview', 'lite').replace('gemini-3.1-flash-lite', 'lite')
  .replace('claude-sonnet-5', 'sonnet5');

// aggregate: model × language × canon/noncanon → aligned rate + mean char acc of aligned
const agg = new Map();
for (const r of rows) {
  if (r.source === 'interactive') continue;
  const model = r.source === 'pipeline' ? 'pipeline' : shortModel(r.model);
  const key = [model, r.language, label(r)].join('|');
  if (!agg.has(key)) agg.set(key, { n: 0, aligned: 0, accSum: 0, accN: 0 });
  const a = agg.get(key);
  a.n++;
  if (r.aligned) { a.aligned++; a.accSum += r.char_accuracy; a.accN++; }
}

const models = [...new Set([...agg.keys()].map(k => k.split('|')[0]))].sort();
const langs = [...new Set(rows.map(r => r.language))].sort();
console.log('\n=== aligned-rate / mean char-accuracy(aligned), canon vs noncanon ===');
for (const m of models) {
  console.log(`\n${m}`);
  for (const lg of langs) {
    const parts = [];
    for (const c of ['canon', 'noncanon']) {
      const a = agg.get([m, lg, c].join('|'));
      parts.push(a ? `${c}: ${a.aligned}/${a.n} aligned, acc ${(a.accN ? a.accSum / a.accN * 100 : 0).toFixed(1)}%` : `${c}: —`);
    }
    console.log(`  ${lg.padEnd(9)} ${parts.join('   ')}`);
  }
}

// overall gap per model (pooled over languages, aligned runs only)
console.log('\n=== pooled gap per model (mean char accuracy of aligned runs) ===');
for (const m of models) {
  const pool = { canon: [], noncanon: [] };
  for (const r of rows) {
    if (r.source === 'interactive' || !r.aligned) continue;
    const model = r.source === 'pipeline' ? 'pipeline' : shortModel(r.model);
    if (model !== m) continue;
    pool[label(r)].push(r.char_accuracy);
  }
  const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
  const c = mean(pool.canon), n = mean(pool.noncanon);
  console.log(`  ${m.padEnd(9)} canon ${(c * 100).toFixed(2)}% (n=${pool.canon.length})  noncanon ${(n * 100).toFixed(2)}% (n=${pool.noncanon.length})  gap ${((c - n) * 100).toFixed(2)}pp`);
}

// Outcome battery per model — ALL runs, not just aligned (no survivorship bias):
// aligned rate; unconditional (raw) accuracy; truncation rate; span dispersion.
console.log('\n=== outcome battery per model (all runs; no alignment survivorship) ===');
console.log('  model      aligned   acc_uncond   truncated   dispersion(med)');
for (const m of models) {
  const runs = rows.filter(r => {
    if (r.source === 'interactive') return false;
    return (r.source === 'pipeline' ? 'pipeline' : shortModel(r.model)) === m;
  });
  if (!runs.length) continue;
  const alignedRate = runs.filter(r => r.aligned).length / runs.length;
  const rawAcc = runs.filter(r => r.char_accuracy_raw != null);
  const accU = rawAcc.length ? rawAcc.reduce((s, r) => s + r.char_accuracy_raw, 0) / rawAcc.length : NaN;
  const trunc = runs.filter(r => r.finish_reason === 'MAX_TOKENS').length / runs.length;
  const disp = runs.map(r => r.span_dispersion).filter(d => d != null).sort((a, b) => a - b);
  const dMed = disp.length ? disp[Math.floor(disp.length / 2)] : NaN;
  console.log(`  ${m.padEnd(9)}  ${(alignedRate * 100).toFixed(0).padStart(4)}%     ${(accU * 100).toFixed(1).padStart(5)}%       ${(trunc * 100).toFixed(0).padStart(3)}%        ${dMed.toFixed(2)}`);
}

// Recension divergence where alt references exist: printed-edition vs alternate.
const withAlt = rows.filter(r => r.alt_scores && r.source !== 'interactive');
if (withAlt.length) {
  console.log('\n=== recension divergence (printed-edition ref vs alternates) ===');
  for (const r of withAlt) {
    for (const [name, a] of Object.entries(r.alt_scores)) {
      const delta = (a.char_accuracy_raw - r.char_accuracy_raw) * 100;
      if (delta > 1) console.log(`  RECITATION FLAG ${r.slug} ${shortModel(r.model)} run${r.run_index}: matches "${name}" ${delta.toFixed(1)}pp BETTER than the printed edition`);
    }
  }
  console.log(`  (${withAlt.length} runs carry alternate recensions; only >1pp inversions printed)`);
}

// same-book contrasts
console.log('\n=== same-book contrasts (book: canon-slug vs noncanon-slugs) ===');
const byBook = new Map();
for (const r of rows) {
  if (r.source === 'interactive' || !r.aligned) continue;
  const model = r.source === 'pipeline' ? 'pipeline' : shortModel(r.model);
  const k = r.book_id;
  if (!byBook.has(k)) byBook.set(k, new Map());
  const mk = `${model}|${label(r)}`;
  if (!byBook.get(k).has(mk)) byBook.get(k).set(mk, []);
  byBook.get(k).get(mk).push({ slug: r.slug, acc: r.char_accuracy });
}
for (const [book, m] of byBook) {
  const labels = new Set([...m.keys()].map(k => k.split('|')[1]));
  if (labels.size < 2) continue; // book has both canon + noncanon rows
  const slugs = [...new Set([...m.values()].flat().map(x => x.slug))];
  console.log(`\n  book ${book} (${slugs.join(', ')})`);
  for (const mod of models) {
    const c = m.get(`${mod}|canon`), n = m.get(`${mod}|noncanon`);
    if (!c && !n) continue;
    const mean = xs => xs && xs.length ? (xs.reduce((s, x) => s + x.acc, 0) / xs.length * 100).toFixed(1) + '%' : '—';
    console.log(`    ${mod.padEnd(9)} canon ${mean(c)}  noncanon ${mean(n)}`);
  }
}
console.log(`\n${rows.length} reference-scored rows in ${file}`);
