#!/usr/bin/env node
/**
 * Scan-coverage join: works (Frame B catalog) ↔ IA manifests (Frame A harvest)
 * → work_sources(kind='scan'). Phase 1 of the coverage plan (#2453), Sanskrit pilot.
 *
 * Answers, with real evidence (not the #2476 hollow flag): of N known Sanskrit
 * works, how many do we hold an IA manifest for?
 *
 * The matching is hard because the catalog uses IAST (Bṛhadāraṇyaka) while IA
 * titles use a different romanization (Brihadaranyaka: ṛ→ri, ṣ/ś→sh) plus noise
 * (leading IA-ids, English descriptions). So we key on a CONSONANT SKELETON:
 * strip diacritics, lowercase, drop vowels and aspirate-h. Both spellings of
 * Bṛhadāraṇyaka collapse to "brdrnyk". Lossy → collisions possible → this runs
 * as a MEASUREMENT by default (prints coverage + a calibration sample); only
 * --apply writes work_sources.
 *
 * Run on Hetzner (needs MONGODB_URI + SUPABASE_DB_URL).
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/match-scans-ia.mjs                 # measure + sample
 *   node scripts/works-catalog/match-scans-ia.mjs --apply         # write scan sources
 *   node scripts/works-catalog/match-scans-ia.mjs --keylen=7 --sample=30
 */
import { MongoClient } from 'mongodb';
import { pgClient, upsertSources } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('='); return [k, v ?? true];
}));
const TRADITION = args.tradition || 'sanskrit';
const IA_QUERY = args['ia-query'] || 'sanskrit';   // metadata.discovery_query
const KEYLEN = parseInt(args.keylen) || 8;          // consonants in the block key
const APPLY = 'apply' in args;
const SAMPLE = parseInt(args.sample) || 25;
const MAX_SRC_PER_WORK = 3;

// Sanskrit consonant skeleton: diacritics out, vowels + aspirate-h out.
const VOWELS = /[aeiou]/g;
function skeleton(t) {
  return (t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // ā→a, ṛ→r, ś→s, ṭ→t …
    .toLowerCase()
    .replace(/^[\s\d._-]+/, '')                          // strip leading IA-id / numbers
    .replace(/[^a-z]+/g, '')                             // letters only (drops spaces too)
    .replace(/h/g, '')                                  // aspirates + inserted-h (bh→b, sh→s)
    .replace(/[mn]/g, 'n')                              // anusvāra: ṃ↔m↔n (Saṃdhi/Sandhi)
    .replace(VOWELS, '');                               // consonant skeleton
}
function keyOf(t) {
  const s = skeleton(t);
  return s.length >= 5 ? s.slice(0, KEYLEN) : null;
}

// ── 1. index IA manifests by skeleton key ────────────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const col = mc.db('bookstore').collection('import_candidates');
console.log(`Indexing IA ${IA_QUERY} manifests by consonant-skeleton key (len ${KEYLEN})…`);
const iaByKey = new Map();
let iaCount = 0;
const cur = col.find(
  { source: 'ia_language', 'metadata.discovery_query': IA_QUERY, manifest_url: { $ne: null } },
  { projection: { title: 1, manifest_url: 1, source_id: 1, 'metadata.access_restricted': 1 } });
for await (const d of cur) {
  const k = keyOf(d.title);
  if (!k) continue;
  if (!iaByKey.has(k)) iaByKey.set(k, []);
  const arr = iaByKey.get(k);
  if (arr.length < 12) arr.push({ url: d.manifest_url, ia: d.source_id, title: d.title, restricted: !!d.metadata?.access_restricted });
  iaCount++;
}
console.log(`Indexed ${iaCount.toLocaleString()} IA manifests → ${iaByKey.size.toLocaleString()} distinct keys`);

// ── 2. probe works ───────────────────────────────────────────────────────────
const pg = pgClient();
await pg.connect();
const { rows: works } = await pg.query(
  `select id, title, title_romanized, author from works where tradition = $1`, [TRADITION]);
console.log(`Probing ${works.length.toLocaleString()} ${TRADITION} works…\n`);

let matched = 0, thin = 0;
const sources = [];
const samplePairs = [];
for (const w of works) {
  const k = keyOf(w.title) || keyOf(w.title_romanized);
  if (!k) { thin++; continue; }
  const hits = iaByKey.get(k);
  if (!hits || !hits.length) continue;
  matched++;
  if (samplePairs.length < SAMPLE) samplePairs.push({ w: w.title, ia: hits[0].title, k });
  for (const h of hits.slice(0, MAX_SRC_PER_WORK)) {
    sources.push({
      work_id: w.id, source: 'ia-sanskrit', source_id: h.ia, kind: 'scan',
      url: h.url, iiif: true, coverage: null,
      extra: { ia_title: h.title?.slice(0, 120), access_restricted: h.restricted, match_key: k },
    });
  }
}
await mc.close();

// ── 3. report (always) + apply (optional) ────────────────────────────────────
const pct = (matched / (works.length - thin) * 100).toFixed(1);
console.log('=== CALIBRATION SAMPLE (eyeball precision before trusting the %) ===');
for (const p of samplePairs) console.log(`  [${p.k}]  work: ${(p.w || '').slice(0, 38).padEnd(38)}  IA: ${(p.ia || '').slice(0, 42)}`);
console.log(`\n=== SCAN COVERAGE (${TRADITION}, key=${KEYLEN}-consonant skeleton) ===`);
console.log(`Works: ${works.length.toLocaleString()} (thin/unkeyable ${thin})`);
console.log(`Works with ≥1 IA manifest: ${matched.toLocaleString()} (${pct}% of keyable)`);
console.log(`Scan source rows prepared: ${sources.length.toLocaleString()}`);
console.log('NOTE: floor — only IA-Sanskrit (93K), only when the work name leads the IA title;');
console.log('institutional + DLI-untagged manifests not yet matched. Verify the sample above.');

if (APPLY) {
  const n = await upsertSources(pg, sources);
  console.log(`\nApplied ${n} ia-sanskrit scan work_sources.`);
} else {
  console.log('\nMEASUREMENT ONLY — re-run with --apply to write work_sources.');
}
await pg.end();
