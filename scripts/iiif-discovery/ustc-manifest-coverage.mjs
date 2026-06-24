#!/usr/bin/env node
/**
 * USTC ↔ import_candidates manifest-coverage join (#2447, Frame B census).
 *
 * Answers the work-first census question with REAL evidence instead of the
 * provenance-free `ustc_editions.has_iiif_scan` flag (#2476):
 *
 *   "Of N known works (USTC work_cluster_id), how many do we actually hold a
 *    IIIF manifest for, anywhere in import_candidates?"
 *
 * Mechanism — an in-memory hash join (cross-DB: Mongo candidates + Supabase
 * USTC). Per-row fuzzy queries are infeasible at 2.2M × 1M, and
 * import_candidates.normalized_title is empty (index exists, never written),
 * so we normalize both sides identically and block on a content-word key.
 *
 * Normalization is tuned for early-modern Latin/European print: u↔v and i↔j
 * are merged (the orthography that sank a naive substring match — "Ivris"
 * vs "Iuris"), ligatures expanded, diacritics stripped. The block key is the
 * first N significant words (default 4); a work is "covered" if any candidate
 * shares that key. Year is NOT required to match — IA `date_earliest` is
 * often a reprint/upload year, and coverage asks only whether SOME manifest
 * of the work exists.
 *
 * Usage (run on Hetzner — needs both MONGODB_URI and SUPABASE_DB_URL):
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/ustc-manifest-coverage.mjs            # full
 *   node scripts/iiif-discovery/ustc-manifest-coverage.mjs --keywords=5
 *   node scripts/iiif-discovery/ustc-manifest-coverage.mjs --sample=20000
 *
 * Options:
 *   --keywords=N   significant words in the block key (default 4)
 *   --sample=N     sample N USTC works instead of all (faster estimate)
 *   --min-year=N --max-year=N   candidate date window to index (default 1450-1750)
 *
 * Read-only. Reports coverage % overall and per language. Writes nothing.
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const KEYWORDS = parseInt(args.keywords) || 4;
const SAMPLE = args.sample ? parseInt(args.sample) : null;
const MIN_YEAR = parseInt(args['min-year']) || 1450;
const MAX_YEAR = parseInt(args['max-year']) || 1750;

const STOPWORDS = new Set(['de', 'et', 'in', 'ad', 'ex', 'cum', 'per', 'pro', 'seu', 'siue',
  'sive', 'das', 'der', 'die', 'und', 'von', 'le', 'la', 'les', 'des', 'du', 'of', 'the', 'and',
  'or', 'a', 'an', 'libri', 'liber', 'tomus', 'pars', 'opera', 'opus']);

/** Early-modern-aware normalization shared by both sides. */
function normWords(title) {
  if (!title) return [];
  return title
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/[jiíìî]/g, 'i').replace(/[uvûù]/g, 'v') // i↔j, u↔v collapse
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));
}
function blockKey(title, n) {
  const w = normWords(title);
  if (w.length < 2) return null; // too thin to key reliably
  return w.slice(0, n).join(' ');
}

// ── 1. Index candidate manifests by block key ────────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const col = mc.db('bookstore').collection('import_candidates');

console.log(`\n=== USTC manifest-coverage join (keywords=${KEYWORDS}, window ${MIN_YEAR}-${MAX_YEAR}) ===`);
console.log('Indexing candidate manifests by block key…');
const candKeys = new Set();
let candIndexed = 0, candThin = 0;
const cursor = col.find(
  { date_earliest: { $gte: MIN_YEAR, $lte: MAX_YEAR } },
  { projection: { title: 1 } }
);
for await (const d of cursor) {
  const k = blockKey(d.title, KEYWORDS);
  if (!k) { candThin++; continue; }
  candKeys.add(k);
  candIndexed++;
  if (candIndexed % 200000 === 0) console.log(`  …${candIndexed.toLocaleString()} candidates indexed (${candKeys.size.toLocaleString()} distinct keys)`);
}
console.log(`Indexed ${candIndexed.toLocaleString()} candidates → ${candKeys.size.toLocaleString()} distinct block keys (${candThin.toLocaleString()} too thin to key)`);

// ── 2. Stream USTC works, probe the index ────────────────────────────────────
const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await pgc.connect();
await pgc.query('SET statement_timeout=0');

// One representative edition per work_cluster_id (earliest year), with language.
// ~954K small rows fit comfortably in memory — single query, no cursor dep.
const sampleClause = SAMPLE ? `ORDER BY random() LIMIT ${SAMPLE}` : '';
const queryText = `
  SELECT work_cluster_id, title, language_1, year FROM (
    SELECT DISTINCT ON (work_cluster_id) work_cluster_id, title, language_1, year
    FROM ustc_editions
    WHERE work_cluster_id IS NOT NULL
    ORDER BY work_cluster_id, year NULLS LAST
  ) w ${sampleClause}`;
console.log(`Loading USTC works${SAMPLE ? ` (random sample ${SAMPLE})` : ''}…`);
const { rows } = await pgc.query(queryText);
await pgc.end();
console.log(`Probing ${rows.length.toLocaleString()} works against the manifest index…`);

const byLang = {}; // lang -> { works, covered }
let works = 0, covered = 0, thin = 0;
for (const r of rows) {
  works++;
  const lang = r.language_1 || 'Unknown';
  const b = byLang[lang] ??= { works: 0, covered: 0 };
  b.works++;
  const k = blockKey(r.title, KEYWORDS);
  if (!k) { thin++; continue; }
  if (candKeys.has(k)) { covered++; b.covered++; }
}
await mc.close();

// ── 3. Report ────────────────────────────────────────────────────────────────
console.log(`\n=== COVERAGE (work-level, real manifests) ===`);
console.log(`Works probed:    ${works.toLocaleString()}`);
console.log(`Too thin to key: ${thin.toLocaleString()}`);
console.log(`Covered:         ${covered.toLocaleString()} (${(covered / works * 100).toFixed(1)}%)`);
console.log(`\n--- by language (works ≥ 2000) ---`);
for (const [lang, b] of Object.entries(byLang).sort((a, b2) => b2[1].works - a[1].works)) {
  if (b.works < 2000) continue;
  console.log(`  ${lang.padEnd(16)} ${String(b.covered).padStart(7)} / ${String(b.works).padStart(7)} = ${(b.covered / b.works * 100).toFixed(1)}%`);
}
console.log('\nNote: block-key match is a FLOOR (exact normalized first-N-words); real');
console.log('coverage is higher. Compare against USTC has_iiif_scan flag (#2476) which');
console.log('claims coverage with zero persisted evidence.');
console.log('COVERAGE_DONE');
