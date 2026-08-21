#!/usr/bin/env node
/**
 * Agreement→accuracy calibration pilot (#3235 double-OCR workstream).
 *
 * Phase A (anchors): on the pinned reference pages, build cross-model OCR pairs
 * from the scorecard raw outputs, compute inter-output AGREEMENT, and correlate
 * it with mean TRUE accuracy (scoreAgainstReference). Canonical and
 * non-canonical rows are calibrated separately — recitation fakes agreement on
 * canonical text, which is exactly what the split should expose.
 *
 * Phase B (corpus): sample N pairs from `page_revisions` (field:'ocr') joined to
 * the current pages.ocr, compute the same agreement metric + covariates
 * (script/language/year, prior/current model, prompt versions, length delta).
 *
 * Pilot output: correlation table + corpus agreement distribution + regression
 * candidates. Free: Mongo reads + local compute only.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/revision-agreement-pilot.mjs [--sample=5000] [--out=path.json]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAgainstReference, stripWrappers, levenshtein } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '5000');
const OUT = args.out || path.join(__dirname, 'results', `revision-agreement-pilot-${new Date().toISOString().slice(0, 10)}.json`);

// Script-agnostic agreement: strip wrappers, keep letters, word-level
// normalized Levenshtein similarity (capped for speed). Deliberately simple —
// it must be computable on any page pair with no reference.
const toWords = s => stripWrappers(s || '')
  .toLowerCase()
  .replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1).slice(0, 800);
export function agreement(a, b) {
  const A = toWords(a), B = toWords(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  const d = levenshtein(A, B);
  return 1 - d / Math.max(A.length, B.length);
}

// ── Phase A: anchors ─────────────────────────────────────────────
const gtDir = path.join(__dirname, 'ground-truth');
const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth);
const byWork = Object.fromEntries(gts.map(g => [g.work, g]));

const outputsByWork = new Map(); // work -> [{model, run, text}]
const resultsDir = path.join(__dirname, 'results');
for (const f of fs.readdirSync(resultsDir).filter(f => f.startsWith('scorecard-outputs-') && f.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(path.join(resultsDir, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    if (!byWork[o.work] || !o.text) continue;
    if (!outputsByWork.has(o.work)) outputsByWork.set(o.work, []);
    outputsByWork.get(o.work).push({ model: o.model, run: o.run, text: o.text });
  }
}

const anchorPairs = [];
for (const [work, outs] of outputsByWork) {
  const gt = byWork[work];
  const canonical = gt.page_class?.canonical_text !== false;
  // one output per model (first run) → cross-model pairs, the analog of a
  // (prior-model, current-model) revision pair
  const byModel = new Map();
  for (const o of outs) if (!byModel.has(o.model)) byModel.set(o.model, o);
  const models = [...byModel.values()];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const a = models[i], b = models[j];
      const agr = agreement(a.text, b.text);
      if (agr == null) continue;
      const accA = scoreAgainstReference(gt.ocr_ground_truth, a.text, gt.script || 'cjk').charAccuracy;
      const accB = scoreAgainstReference(gt.ocr_ground_truth, b.text, gt.script || 'cjk').charAccuracy;
      anchorPairs.push({
        slug: gt.slug, canonical, script: gt.script,
        models: [a.model, b.model], agreement: +agr.toFixed(4),
        mean_true_accuracy: +((accA + accB) / 2).toFixed(4),
        min_true_accuracy: +Math.min(accA, accB).toFixed(4),
      });
    }
  }
}

const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
};

console.log(`\n=== Phase A: anchor calibration (${anchorPairs.length} cross-model pairs on ${outputsByWork.size} pages) ===`);
for (const which of ['noncanon', 'canon', 'all']) {
  const sel = anchorPairs.filter(p => which === 'all' || (which === 'canon') === p.canonical);
  const r = pearson(sel.map(p => p.agreement), sel.map(p => p.mean_true_accuracy));
  const rMin = pearson(sel.map(p => p.agreement), sel.map(p => p.min_true_accuracy));
  console.log(`  ${which.padEnd(9)} n=${String(sel.length).padStart(3)}  r(agreement, mean_acc)=${r.toFixed(3)}  r(agreement, min_acc)=${rMin.toFixed(3)}`);
}

// ── Phase B: corpus revision pairs ───────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const revs = await db.collection('page_revisions').aggregate([
  { $match: { field: 'ocr', data: { $type: 'string', $ne: '' } } },
  { $sample: { size: SAMPLE } },
  { $project: { page_id: 1, book_id: 1, data: 1, model: 1, prompt_version: 1, created_at: 1 } },
]).toArray();
console.log(`\n=== Phase B: ${revs.length} sampled revision pairs ===`);

const B = db.collection('books');
const bookMeta = new Map();
const corpus = [];
let missing = 0;
for (const rv of revs) {
  const pg = await db.collection('pages').findOne(
    { $or: [{ id: rv.page_id }, { _id: rv.page_id }] },
    { projection: { 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, page_number: 1, book_id: 1 } });
  if (!pg?.ocr?.data) { missing++; continue; }
  if (!bookMeta.has(rv.book_id)) {
    bookMeta.set(rv.book_id, await B.findOne({ $or: [{ id: rv.book_id }, { _id: rv.book_id }] },
      { projection: { language: 1, year: 1 } }));
  }
  const bk = bookMeta.get(rv.book_id);
  const agr = agreement(rv.data, pg.ocr.data);
  if (agr == null) continue;
  corpus.push({
    page_id: rv.page_id, book_id: rv.book_id, page_number: pg.page_number,
    language: bk?.language || null, year: bk?.year || null,
    prior_model: rv.model || null, current_model: pg.ocr.model || null,
    prior_prompt: rv.prompt_version || null, current_prompt: pg.ocr.prompt_version || null,
    agreement: +agr.toFixed(4),
    len_prior: rv.data.length, len_current: pg.ocr.data.length,
    len_ratio: +(pg.ocr.data.length / Math.max(1, rv.data.length)).toFixed(3),
  });
}
await client.close();
console.log(`  usable: ${corpus.length} (${missing} pages missing/empty current OCR)`);

const buckets = [0, 0.5, 0.7, 0.85, 0.95, 1.01];
const hist = new Array(buckets.length - 1).fill(0);
for (const c of corpus) for (let i = 0; i < buckets.length - 1; i++) if (c.agreement >= buckets[i] && c.agreement < buckets[i + 1]) hist[i]++;
console.log('  agreement distribution: ' + hist.map((h, i) => `[${buckets[i]}-${buckets[i + 1] > 1 ? 1 : buckets[i + 1]}) ${(h / corpus.length * 100).toFixed(1)}%`).join('  '));

const byLang = new Map();
for (const c of corpus) {
  const k = c.language || '?';
  if (!byLang.has(k)) byLang.set(k, []);
  byLang.get(k).push(c.agreement);
}
console.log('\n  mean agreement by language (n≥30):');
for (const [lang, xs] of [...byLang.entries()].filter(([, x]) => x.length >= 30).sort((a, b) => (a[1].reduce((s, x) => s + x, 0) / a[1].length) - (b[1].reduce((s, x) => s + x, 0) / b[1].length))) {
  console.log(`    ${lang.padEnd(22)} ${(xs.reduce((s, x) => s + x, 0) / xs.length * 100).toFixed(1)}%  (n=${xs.length})`);
}

// Regression candidates: low agreement AND current much shorter than prior —
// the shape of "re-OCR made it worse".
const regressions = corpus.filter(c => c.agreement < 0.5 && c.len_ratio < 0.6);
console.log(`\n  regression candidates (agreement<0.5 AND current<60% of prior length): ${regressions.length} (${(regressions.length / corpus.length * 100).toFixed(1)}%)`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  date: new Date().toISOString(), sample: SAMPLE,
  anchors: anchorPairs, corpus_summary: {
    usable: corpus.length, missing,
    histogram: Object.fromEntries(hist.map((h, i) => [`${buckets[i]}-${buckets[i + 1]}`, h])),
    regressions: regressions.length,
  },
  corpus,
}, null, 1));
console.log(`\nSaved → ${OUT}`);
