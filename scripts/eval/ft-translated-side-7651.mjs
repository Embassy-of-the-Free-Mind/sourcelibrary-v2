#!/usr/bin/env node
// PRIOR ART: scripts/eval/ft-pilot-score-r5.ts scores round 5 by its own badged × western strata, not by
// language group or period; scripts/audit/ft-method-agreement.mjs pairs instruments, it does not re-weight.
// #7651 needs the TRANSLATED side in the same language groups and periods as the untranslated sample,
// from evidence already on file (no new searches). This reads it and writes one JSON.
//
// Three instruments, never pooled (they measure different things on different populations):
//   fresh  — the #7598 fresh Sonnet search (first_translation_attempts, method claude_subagent_verify,
//            no _src, dated >= 2026-10-27): latest row per book. Drawn in priority tiers, not uniformly.
//   r5     — round 5 Tier-1 grounded Gemini (gemini_grounded_search rows dated 2026-08-31 on the round-5
//            manifest), weighted by round-5 stratum design weights. Tier-1, not the oracle.
//   cards  — reviewed work_translation_history status (no_prior_known / prior_exists / not_a_single_work).
// Each is re-weighted to TODAY's translated frame by post-stratifying on language group × period.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ft-translated-side-7651.mjs \
//     --out scripts/eval/results/ft-translated-side-7651.json
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', 'scripts/eval/results/ft-translated-side-7651.json');

// Same grouping and period rules as the pre-registered sampler (kept in step by copy: that file runs on import).
function languageGroup(lang) {
  const s = String(lang ?? '').trim().toLowerCase();
  if (!s) return 'other';
  if (s.includes('english')) return null;
  const first = s.split(/[;,/.]| and /)[0].trim();
  const map = [
    [/^(latin|la|lat)$/, 'latin'],
    [/^(classical )?chinese|^(zh|lzh|chi|zho)$/, 'chinese'],
    [/^(german|de|ger|deu|gmh|goh|nds|middle high german|low german)$/, 'german'],
    [/^(french|fr|fre|fra|frm|fro|italian|it|ita|spanish|es|spa|dutch|nl|dut|nld|dum)$/, 'fr_it_es_nl'],
    [/^(greek|grc|el|gre|ell|ancient greek)$/, 'greek'],
    [/^(hebrew|he|heb|samaritan hebrew|arabic|ar|ara|persian|fa|per|fas|syriac|syr)$/, 'he_ar_fa_syr'],
  ];
  for (const [re, g] of map) if (re.test(first)) return g;
  if (/^(en|eng)$/.test(first)) return null;
  return 'other';
}
function yearOf(b) {
  if (typeof b.year === 'number' && b.year > 0 && b.year < 2100) return b.year;
  const m = String(b.published ?? '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? parseInt(m[1], 10) : null;
}
function periodOf(y) {
  if (y == null) return 'unknown';
  if (y < 1500) return '<1500';
  if (y < 1600) return '1500s';
  if (y < 1700) return '1600s';
  if (y < 1800) return '1700s';
  if (y < 1900) return '1800s';
  return '1900+';
}
const STRATA = ['latin', 'chinese', 'german', 'fr_it_es_nl', 'greek', 'he_ar_fa_syr', 'other'];
const PERIODS = ['<1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown'];

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const bid = (b) => b.id || String(b._id);
const all = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } },
  { projection: { id: 1, language: 1, year: 1, published: 1, work_id: 1 } }).toArray();
const frame = new Map();
let english = 0;
for (const b of all) {
  const g = languageGroup(b.language);
  if (!g) { english++; continue; }
  frame.set(bid(b), { g, p: periodOf(yearOf(b)), work: b.work_id ? String(b.work_id) : `book:${bid(b)}` });
}

// fresh (#7598): latest row per book.
const fresh = new Map();
for (const r of await db.collection('first_translation_attempts').find(
  { method: 'claude_subagent_verify', _src: { $exists: false }, date: { $gte: '2026-10-27' } },
  { projection: { book_id: 1, date: 1, result: 1, notes: 1, priors: 1 } }).sort({ date: 1 }).toArray()) {
  let v;
  if (r.result === 'not_found' || r.result === 'none') v = 'no_prior';
  else if (r.result === 'found') v = (r.priors || []).length && (r.priors || []).every((p) => /partial|excerpt/.test(p.completeness || '')) ? 'partial' : 'prior';
  else v = /partial_only/.test(r.notes || '') ? 'partial' : 'unclear';
  fresh.set(r.book_id, v);
}

// r5 Tier-1, with round-5 design weights (stratum available / drawn).
const r5m = JSON.parse(readFileSync('scripts/eval/results/ft-pilot-sample-r5-2026-08-31.json', 'utf8'));
const r5w = new Map();
for (const s of r5m.manifest) for (const x of s.sampled) r5w.set(x.id, s.available / s.drawn);
const r5 = new Map();
for (const r of await db.collection('first_translation_attempts').find(
  { book_id: { $in: [...r5w.keys()] }, method: 'gemini_grounded_search', date: { $gte: '2026-08-31', $lt: '2026-09-01' } },
  { projection: { book_id: 1, result: 1 } }).sort({ date: 1 }).toArray()) {
  r5.set(r.book_id, r.result === 'found' ? 'prior' : r.result === 'not_found' || r.result === 'none' ? 'no_prior' : 'unclear');
}

// cards by work.
const works = [...new Set([...frame.values()].map((f) => f.work))];
const cards = new Map();
for (let i = 0; i < works.length; i += 5000) {
  for (const w of await db.collection('work_translation_history').find({ _id: { $in: works.slice(i, i + 5000) }, status: { $in: ['no_prior_known', 'prior_exists', 'not_a_single_work'] } }, { projection: { status: 1 } }).toArray()) {
    cards.set(String(w._id), w.status === 'no_prior_known' ? 'no_prior' : w.status === 'prior_exists' ? 'prior' : 'not_single');
  }
}

const cell = () => ({ books: 0, works: new Set(), fresh: { n: 0, no_prior: 0, prior: 0, partial: 0, unclear: 0 }, r5: { n: 0, w: 0, no_prior_w: 0, no_prior: 0 }, cards: { n: 0, no_prior: 0, prior: 0, not_single: 0 } });
const byG = Object.fromEntries(STRATA.map((s) => [s, cell()]));
const byP = Object.fromEntries(PERIODS.map((p) => [p, cell()]));
const byGP = {};
const total = cell();
const seenWorkCard = new Set();
for (const [id, f] of frame) {
  const k = `${f.g}|${f.p}`;
  byGP[k] ||= cell();
  for (const x of [byG[f.g], byP[f.p], byGP[k], total]) {
    x.books++; x.works.add(f.work);
    const v = fresh.get(id);
    if (v) { x.fresh.n++; x.fresh[v]++; }
    const r = r5.get(id);
    if (r && r !== 'unclear') { const w = r5w.get(id); x.r5.n++; x.r5.w += w; if (r === 'no_prior') { x.r5.no_prior++; x.r5.no_prior_w += w; } }
  }
  const cv = cards.get(f.work);
  if (cv) for (const [x, key] of [[byG[f.g], `g${f.g}`], [byP[f.p], `p${f.p}`], [byGP[k], `c${k}`], [total, 'T']]) {
    if (seenWorkCard.has(`${key}|${f.work}`)) continue;
    seenWorkCard.add(`${key}|${f.work}`);
    x.cards.n++; x.cards[cv]++;
  }
}

// Fresh-search rate per book; post-stratified count = Σ over group×period cells of books × cell rate,
// falling back to the group rate where a cell has fewer than 10 searched books ("carried").
const rate = (x) => (x.fresh.n ? x.fresh.no_prior / x.fresh.n : null);
const wilson = (k, n) => {
  if (!n) return [null, null];
  const z = 1.96, p = k / n, d = 1 + z * z / n, ctr = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [ctr - h, ctr + h];
};
const summarise = (x) => ({
  books: x.books, works: x.works.size,
  fresh: { ...x.fresh, rate_no_prior: rate(x), ci: wilson(x.fresh.no_prior, x.fresh.n) },
  r5_tier1: { n: x.r5.n, rate_no_prior_weighted: x.r5.w ? x.r5.no_prior_w / x.r5.w : null },
  cards: { ...x.cards, rate_no_prior: x.cards.n ? x.cards.no_prior / x.cards.n : null },
});
let est = 0;
const cellsOut = {};
for (const [k, x] of Object.entries(byGP)) {
  const [g] = k.split('|');
  const measured = x.fresh.n >= 10;
  const r = measured ? rate(x) : rate(byG[g]);
  est += x.books * (r ?? 0);
  cellsOut[k] = { ...summarise(x), basis: measured ? (x.fresh.n >= 30 ? 'measured' : 'thin') : 'carried_from_group', est_no_prior_books: Math.round(x.books * (r ?? 0)) };
}
const out = {
  issue: 7651, built: new Date().toISOString(),
  frame: 'visible && pages_count>0 && pages_translated>0 && language group != English',
  frame_books: frame.size, english_excluded: english, translated_live_all: all.length,
  instruments: {
    fresh: '#7598 Sonnet claude -p, latest row per book since 2026-10-27; priority-tier draw (never-searched first) — NOT uniform',
    r5_tier1: 'round 5 Tier-1 grounded gemini-3-flash-preview, 2026-08-31, weighted by round-5 stratum design weights; Tier-1 over-claims firsts by +12–14pp in non-western strata vs the oracle',
    cards: 'reviewed work cards; drained in seeded random tranches over the focus queue (>50% OCR and translated) plus targeted rounds — NOT uniform',
  },
  post_stratified_no_prior_books_fresh: Math.round(est),
  total: summarise(total),
  by_group: Object.fromEntries(STRATA.map((s) => [s, summarise(byG[s])])),
  by_period: Object.fromEntries(PERIODS.map((p) => [p, summarise(byP[p])])),
  cells: cellsOut,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`translated frame ${frame.size} books (all translated live ${all.length}, english ${english}); fresh rows ${fresh.size}, r5 rows ${r5.size}, carded works ${cards.size}`);
console.log(`post-stratified no-prior books (fresh): ${Math.round(est)}`);
for (const s of STRATA) { const y = out.by_group[s]; console.log(s.padEnd(13), y.books, y.works, 'fresh', y.fresh.n, y.fresh.rate_no_prior?.toFixed(3), 'r5', y.r5_tier1.n, y.r5_tier1.rate_no_prior_weighted?.toFixed(3), 'cards', y.cards.n, y.cards.rate_no_prior?.toFixed(3)); }
for (const p of PERIODS) { const y = out.by_period[p]; console.log(p.padEnd(13), y.books, y.works, 'fresh', y.fresh.n, y.fresh.rate_no_prior?.toFixed(3), 'r5', y.r5_tier1.n, y.r5_tier1.rate_no_prior_weighted?.toFixed(3), 'cards', y.cards.n, y.cards.rate_no_prior?.toFixed(3)); }
await c.close();
