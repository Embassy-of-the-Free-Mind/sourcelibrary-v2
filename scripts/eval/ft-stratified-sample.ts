#!/usr/bin/env node
/**
 * Stratified sampler for the first-translation corpus estimate (issue #2564).
 *
 * Stratifies the public firsts by catalogue-density × language-family ×
 * disposition (density is the PRIMARY axis — the 5-book probe showed error
 * tracks fame, not language), draws a random sample per stratum, and writes a
 * sample MANIFEST + the projected confidence interval.
 *
 * This step is FREE (read-only). The manifest feeds Tier-2 agentic ground-
 * truthing (paid) — run that separately, then feed verdicts back through the
 * inference module to get "N ± M first translations."
 *
 * Catalogue-density proxy = how many translation_catalogs rows we hold by this
 * book's author (also the internal-match-recall signal): canonical ≥5, mid 1-4,
 * obscure 0. Ties density directly to "do we already hold a translation here."
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-stratified-sample.ts [--per=30] [--out=scripts/eval/results/ft-sample.json]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { estimateCorpus, suggestSampleSize } from '@/lib/first-translation/inference';

const args = process.argv.slice(2);
const PER = parseInt(args.find((a) => a.startsWith('--per='))?.split('=')[1] || '0', 10);
const OUT = args.find((a) => a.startsWith('--out='))?.split('=')[1]
  || 'scripts/eval/results/ft-sample-manifest.json';

const FAMILY = {
  Tibetan: 'tibetan', Chinese: 'cjk', Japanese: 'cjk', Korean: 'cjk',
  Sanskrit: 'indic', Tamil: 'indic', Pali: 'indic',
  Hebrew: 'semitic', Arabic: 'semitic', Syriac: 'semitic', Aramaic: 'semitic',
  Armenian: 'other', "Ge'ez": 'other', Geez: 'other', Coptic: 'other',
  'Egyptian hieroglyphs': 'other', Egyptian: 'other', Navajo: 'other',
};
const family = (l) => (!l ? 'unknown' : FAMILY[l] || 'western');
const density = (n) => (n >= 5 ? 'canonical' : n >= 1 ? 'mid' : 'obscure');

// Placeholder "authors" that must NOT pool into a single high-density key —
// otherwise every Anonymous/Unknown work is mis-stratified as `canonical`.
const PLACEHOLDER_AUTHORS = new Set(['anonymous', 'anon', 'unknown', 'various', 'anonymus', 'n a', 'unbekannt', 'sundry']);
function normAuthor(a) {
  if (!a) return '';
  // surname-ish key: take the part before the first comma, lowercase, strip dates.
  const key = a.split(',')[0].toLowerCase().replace(/[^a-zÀ-ɏ ]/g, '').trim();
  return PLACEHOLDER_AUTHORS.has(key) ? '' : key;
}

// Fisher-Yates with a tiny seeded PRNG so draws are reproducible per run.
function shuffle(arr, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

// Build an author -> catalog-row-count map (the density / internal-recall signal).
console.error('Building translation_catalogs author density map…');
const catalogAgg = await db.collection('translation_catalogs').aggregate([
  { $group: { _id: '$author_normalized', n: { $sum: 1 } } },
]).toArray();
const byNormAuthor = new Map();
for (const { _id, n } of catalogAgg) {
  if (_id) byNormAuthor.set(String(_id).toLowerCase().trim(), n);
}
// also index by surname key for fuzzy fallback
const bySurname = new Map();
for (const { _id, n } of catalogAgg) {
  const k = normAuthor(_id);
  if (k) bySurname.set(k, (bySurname.get(k) || 0) + n);
}
function catalogRowsFor(author) {
  if (!author) return 0;
  const surnameKey = normAuthor(author); // '' for placeholder/anonymous authors
  if (!surnameKey) return 0; // never pool Anonymous/Unknown into a density bucket
  const exact = byNormAuthor.get(author.toLowerCase().trim());
  if (exact) return exact;
  return bySurname.get(surnameKey) || 0;
}

console.error('Loading public firsts…');
const PUBLIC = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 } };
const docs = await db.collection('books').find(PUBLIC, {
  projection: { id: 1, title: 1, author: 1, language: 1,
    'translation_verification.disposition': 1, work_id: 1 },
}).toArray();

// Internal-match recall floor: of public firsts, how many are by an author we
// already hold an English translation for in our own catalog?
let authorHeld = 0;
const strata = new Map();
for (const b of docs) {
  const rows = catalogRowsFor(b.author);
  if (rows > 0) authorHeld++;
  const key = `${density(rows)} | ${family(b.language)} | ${b.translation_verification?.disposition || 'null'}`;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push({ id: b.id || String(b._id), author: b.author, title: b.title, language: b.language, catalog_rows: rows });
}

// Draw the sample per stratum.
const manifest = [];
const plan = [];
let seed = 20260619;
for (const [key, members] of [...strata.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const size = members.length;
  const target = PER > 0 ? Math.min(PER, size) : suggestSampleSize(size, 0.1);
  const sampled = shuffle([...members], seed++).slice(0, target);
  manifest.push({ stratum: key, size, sampled });
  plan.push({ key, size, sample: sampled.length });
}

// Projected CI if every sampled book were ground-truthed (worst-case p=0.5
// gives the widest honest band; we report the projection, not a result).
const projection = estimateCorpus(
  plan.map((p) => ({ key: p.key, size: p.size, sampled: p.sample, falseFirsts: Math.round(p.sample * 0.5) })),
);

console.error('\n=== STRATA (density | family | disposition) ===');
for (const p of plan) console.error(`  ${p.key}  —  N=${p.size}  sample=${p.sample}`);
console.error(`\nTotal public firsts: ${docs.length}`);
console.error(`Author-level internal-match floor: ${authorHeld} (${((authorHeld / docs.length) * 100).toFixed(1)}%) are by an author we already hold an English translation for`);
console.error(`Total to Tier-2 ground-truth: ${plan.reduce((a, p) => a + p.sample, 0)} books`);
console.error(`Projected corpus 95% half-width at worst-case p=0.5: ±${projection.ciHalfWidth.toFixed(0)}`);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  built: new Date().toISOString(),
  total_public_firsts: docs.length,
  author_internal_match_floor: authorHeld,
  strata_plan: plan,
  projection: { ci_half_width_worst_case: projection.ciHalfWidth },
  manifest,
}, null, 2));
console.error(`\nManifest written: ${OUT}`);
await client.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
