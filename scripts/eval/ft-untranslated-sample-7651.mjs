#!/usr/bin/env node
// PRIOR ART: scripts/eval/ft-pilot-sample.mjs (round 5) draws TRANSLATED books in badged × western strata;
// scripts/ft-search/select-batch.mjs (#7598) draws translated books in priority tiers for writing badges;
// the #4617 excluded-stratum draw lived in an untracked .claude/drain-4617/ that no longer exists. None
// samples the UNTRANSLATED pool by language group, one book per work, which is what #7651 asks.
//
// Pre-registered draw for #7651: how many untranslated, non-English, live books would be FIRST English
// translations? Writes the manifest (frame sizes, strata, the drawn works, controls, the re-judge set)
// BEFORE any search runs. Measure-only: reads Mongo, writes one JSON file, no book or card writes.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ft-untranslated-sample-7651.mjs \
//     --out scripts/eval/results/ft-untranslated-sample-7651-manifest.json
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', 'scripts/eval/results/ft-untranslated-sample-7651-manifest.json');
const SEED = 7651;
const PER_STRATUM = 50;
const N_CONTROLS = 10;
const N_REJUDGE = 20;

// Seeded shuffle (mulberry32, as in scripts/ft-search/select-batch.mjs) so the draw is reproducible.
function rng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const STRATA = ['latin', 'chinese', 'german', 'fr_it_es_nl', 'greek', 'he_ar_fa_syr', 'other'];

// Language group from books.language (the EDITION's language). The first named language decides a
// mixed label ("Latin, Greek" → latin). Anything carrying "english" is out of frame.
export function languageGroup(lang) {
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

// Year bucket of the EDITION we hold: books.year, else the first plausible year in books.published.
export function yearOf(b) {
  if (typeof b.year === 'number' && b.year > 0 && b.year < 2100) return b.year;
  const m = String(b.published ?? '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? parseInt(m[1], 10) : null;
}
export function periodOf(y) {
  if (y == null) return 'unknown';
  if (y < 1500) return '<1500';
  if (y < 1600) return '1500s';
  if (y < 1700) return '1600s';
  if (y < 1800) return '1700s';
  if (y < 1900) return '1800s';
  return '1900+';
}
const PERIODS = ['<1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown'];

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const proj = { id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, published: 1, work_id: 1, pages_count: 1, pages_ocr: 1 };
const untranslated = { $or: [{ pages_translated: { $exists: false } }, { pages_translated: null }, { pages_translated: { $lte: 0 } }] };
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, ...untranslated }, { projection: proj }).toArray();
const bid = (b) => b.id || String(b._id);
books.sort((a, b) => (bid(a) < bid(b) ? -1 : 1));

const frame = [];
let englishExcluded = 0;
for (const b of books) {
  const g = languageGroup(b.language);
  if (g === null) { englishExcluded++; continue; }
  const y = yearOf(b);
  frame.push({ id: bid(b), g, work: b.work_id ? String(b.work_id) : `book:${bid(b)}`, year: y, period: periodOf(y), b });
}

// Works per stratum (a work whose books fall in two language groups is a work in each; counted, see below).
const strata = {};
for (const s of STRATA) strata[s] = new Map();
for (const f of frame) {
  const m = strata[f.g];
  if (!m.has(f.work)) m.set(f.work, []);
  m.get(f.work).push(f);
}
const workKeysAll = new Set(frame.map((f) => f.work));
const crossStratum = [...workKeysAll].filter((w) => STRATA.filter((s) => strata[s].has(w)).length > 1).length;

const rnd = rng(SEED);
const frameSizes = {};
const sample = [];
for (const s of STRATA) {
  const works = [...strata[s].keys()].sort();
  const books_n = [...strata[s].values()].reduce((n, l) => n + l.length, 0);
  const byPeriod = Object.fromEntries(PERIODS.map((p) => [p, 0]));
  for (const l of strata[s].values()) for (const f of l) byPeriod[f.period]++;
  frameSizes[s] = { books: books_n, works: works.length, books_by_period: byPeriod };
  shuffle(works, rnd);
  for (const w of works.slice(0, PER_STRATUM)) {
    const members = strata[s].get(w);
    const f = members[Math.floor(rnd() * members.length)];
    sample.push({
      id: f.id, stratum: s, work_key: w, work_books_in_stratum: members.length,
      title: f.b.display_title || f.b.title || '', author: f.b.author || '', language: f.b.language || '',
      year: f.year, period: f.period, pages_count: f.b.pages_count || 0, pages_ocr: f.b.pages_ocr || 0,
    });
  }
}

// Controls: books whose work carries a REVIEWED card with a verified, complete English translation, so the
// search should find it. Drawn blind into the run (same prompt, shuffled order); never the sampled works.
const sampledWorks = new Set(sample.map((x) => x.work_key));
const cards = await db.collection('work_translation_history').find(
  { status: 'prior_exists', entries: { $elemMatch: { verified: true, completeness: 'complete', citation_url: { $type: 'string' } } } },
  { projection: { _id: 1 } },
).toArray();
const cardWorks = cards.map((x) => String(x._id)).sort();
const ctrlBooks = await db.collection('books').find(
  { work_id: { $in: cardWorks }, visible: true, pages_count: { $gt: 0 } },
  { projection: { ...proj, pages_translated: 1 } },
).toArray();
ctrlBooks.sort((a, b) => (bid(a) < bid(b) ? -1 : 1));
const ctrlCand = ctrlBooks.filter((b) => languageGroup(b.language) && !sampledWorks.has(String(b.work_id)));
// Prefer frame-like controls (untranslated); a control's translation state is never shown to the searcher.
const ctrlUntr = ctrlCand.filter((b) => !(b.pages_translated > 0));
const pool = ctrlUntr.length >= N_CONTROLS ? ctrlUntr : ctrlCand;
const seenW = new Set();
const controls = [];
for (const b of shuffle([...pool], rnd)) {
  if (seenW.has(String(b.work_id))) continue;
  seenW.add(String(b.work_id));
  const y = yearOf(b);
  controls.push({ id: bid(b), work_key: String(b.work_id), group: languageGroup(b.language), title: b.display_title || b.title || '', author: b.author || '', language: b.language || '', year: y, period: periodOf(y), translated: b.pages_translated > 0 });
  if (controls.length === N_CONTROLS) break;
}

const rejudge = shuffle(sample.map((x) => x.id), rnd).slice(0, N_REJUDGE).sort();
const runOrder = shuffle([...sample.map((x) => x.id), ...controls.map((x) => x.id)], rnd);

const manifest = {
  issue: 7651,
  seed: SEED,
  built: new Date().toISOString(),
  frame_definition: 'books: visible && pages_count>0 && no translated pages (pages_translated absent/null/<=0) && language group != English (any books.language containing "english", or en/eng, excluded)',
  frame_books_live_untranslated: books.length,
  frame_english_excluded: englishExcluded,
  frame_books: frame.length,
  frame_works: workKeysAll.size,
  works_in_two_strata: crossStratum,
  unit: 'work (books.work_id; a book without work_id is its own work); one random book per drawn work',
  strata: frameSizes,
  per_stratum_n: PER_STRATUM,
  verdicts: ['no_prior_known', 'prior_exists', 'partial_only', 'not_a_single_work', 'identity_unresolved', 'already_english', 'could_not_search'],
  estimator: {
    headline: 'no_prior_known share of drawn works per stratum (all verdicts in the denominator except could_not_search, which is retried and reported separately)',
    works: 'stratum rate × stratum frame works; corpus total = Σ_h W_h p_h; Wilson 95% per stratum; corpus CI from Σ W_h² p(1−p)/n_h × fpc',
    books: 'ratio estimator per stratum (Σ y_i m_i / Σ m_i, m_i = the work\'s books in the stratum frame) × stratum frame books; 95% CI by stratified bootstrap (2,000 reps, seed 7651)',
    period: 'post-stratified by the drawn book\'s edition-year bucket, each drawn work weighted W_h/n_h; bootstrap CI; cells with n<10 marked thin',
  },
  controls_rule: 'reviewed card status prior_exists with a verified, complete, cited entry; untranslated books preferred; one per work; blind in the run order',
  rejudge_rule: '20 random sample ids re-judged by an independent second pass (fresh process, different model, never shown the first verdict)',
  sample,
  controls,
  rejudge,
  run_order: runOrder,
};
writeFileSync(OUT, JSON.stringify(manifest, null, 1) + '\n');
console.log(`frame ${frame.length} books / ${workKeysAll.size} works (english excluded ${englishExcluded}; works in two strata ${crossStratum})`);
for (const s of STRATA) console.log(s.padEnd(14), JSON.stringify(frameSizes[s]));
console.log(`sample ${sample.length}, controls ${controls.length} (from ${pool === ctrlUntr ? 'untranslated' : 'any'} pool of ${pool.length}), rejudge ${rejudge.length} → ${OUT}`);
await c.close();
