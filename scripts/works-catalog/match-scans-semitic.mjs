#!/usr/bin/env node
/**
 * Semitic-script scan-coverage join: works (Frame B catalog) ↔ IA manifests
 * harvested for the matching language → work_sources(kind='scan').
 *
 *   --tradition=islamicate  : OpenITI works (Arabic-script title) ↔ IA
 *                             ia_language=arabic + persian manifests. source='ia-islamicate'.
 *   --tradition=hebrew      : Sefaria works (Hebrew-script title) ↔ IA
 *                             ia_language=hebrew manifests. source='ia-hebrew'.
 *
 * Both sides match on the ORIGINAL-SCRIPT title (islamicate title_romanized is a
 * truncated URI slug; hebrew title_english is clean but the IA print volumes are
 * Hebrew-titled), normalized to a diacritic-free skeleton (normalizeArabic /
 * normalizeHebrew in lib.mjs). A match is accepted when one normalized title is a
 * PREFIX of the other (work name leads the IA title, possibly with author /
 * commentary / volume), gated by a minimum length to suppress generic collisions.
 *
 * Lossy → runs as MEASUREMENT by default (coverage + calibration sample); only
 * --apply writes work_sources. ALWAYS eyeball the sample before --apply: the
 * Hebrew corpus is mostly granular Talmud/Mishneh-Torah commentaries that have no
 * standalone print scan, so a low hebrew yield is expected and correct.
 *
 * Run on Hetzner (needs MONGODB_URI + SUPABASE_DB_URL).
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/match-scans-semitic.mjs --tradition=islamicate
 *   node scripts/works-catalog/match-scans-semitic.mjs --tradition=hebrew --apply
 *   node scripts/works-catalog/match-scans-semitic.mjs --tradition=islamicate --min-len=7 --sample=40
 */
import { MongoClient } from 'mongodb';
import { pgClient, upsertSources, normalizeArabic, normalizeHebrew } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('='); return [k, v ?? true];
}));
const TRADITION = args.tradition;
const APPLY = 'apply' in args;
const SAMPLE = parseInt(args.sample) || 30;
const MAX_SRC_PER_WORK = 3;
const KEYLEN = 3;  // block-key length on the normalized skeleton

// minLen = min normalized-skeleton length to accept a prefix match. Calibrated
// 2026-06: islamicate 8 (6 let through generic short IA titles — الكتاب "the
// book", الحضارة "civilization" — that prefix longer work titles; 8 = ~93%
// precision / 4,010 works). hebrew is structurally low-yield (Sefaria nodes are
// granular commentaries, IA has ~2.9K usable Hebrew manifests) — even min-len 9
// is only ~58% precision / 12 works, so hebrew is NOT applied via this path;
// the real Hebrew scan source is NLI / Otzar HaHochma, a separate harvest.
const CONFIG = {
  islamicate: { norm: normalizeArabic, queries: ['arabic', 'persian'], source: 'ia-islamicate', minLen: 8 },
  hebrew:     { norm: normalizeHebrew, queries: ['hebrew'],            source: 'ia-hebrew',     minLen: 9 },
};
const cfg = CONFIG[TRADITION];
if (!cfg) { console.error(`--tradition must be one of: ${Object.keys(CONFIG).join(', ')}`); process.exit(1); }
const MIN_LEN = parseInt(args['min-len']) || cfg.minLen;
const norm = cfg.norm;

// PREFIX precision filter: a key collision is a real match only if one full
// skeleton leads the other (rejects mid-word divergence).
function prefixCompatible(a, b) {
  return a.length >= MIN_LEN && b.length >= MIN_LEN && (a.startsWith(b) || b.startsWith(a));
}

// ── 1. index IA manifests by skeleton block key ───────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const col = mc.db('bookstore').collection('import_candidates');
console.log(`Indexing IA ${cfg.queries.join('+')} manifests by ${TRADITION} skeleton key…`);
const byKey = new Map();
let iaCount = 0;
const cur = col.find(
  { source: 'ia_language', 'metadata.discovery_query': { $in: cfg.queries }, manifest_url: { $ne: null } },
  { projection: { title: 1, manifest_url: 1, source_id: 1, 'metadata.access_restricted': 1 } });
for await (const d of cur) {
  const n = norm(d.title);
  if (n.length < KEYLEN) continue;
  const k = n.slice(0, KEYLEN);
  if (!byKey.has(k)) byKey.set(k, []);
  const arr = byKey.get(k);
  if (arr.length < 600) arr.push({ n, url: d.manifest_url, ia: d.source_id, title: d.title, restricted: !!d.metadata?.access_restricted });
  iaCount++;
}
console.log(`Indexed ${iaCount.toLocaleString()} manifests → ${byKey.size.toLocaleString()} keys`);

// ── 2. probe works ────────────────────────────────────────────────────────────
const pg = pgClient();
await pg.connect();
const { rows: works } = await pg.query(
  `select w.id, w.title, w.title_romanized from works w
   where w.tradition = $1
     and not exists (select 1 from work_sources s where s.work_id = w.id and s.kind = 'scan')`, [TRADITION]);
console.log(`Probing ${works.length.toLocaleString()} ${TRADITION} works WITHOUT a scan yet (min-len ${MIN_LEN})…\n`);

let matched = 0, thin = 0;
const sources = [];
const samplePairs = [];
for (const w of works) {
  const wn = norm(w.title);
  if (wn.length < MIN_LEN) { thin++; continue; }
  const hits = (byKey.get(wn.slice(0, KEYLEN)) || []).filter(h => prefixCompatible(wn, h.n));
  if (!hits.length) continue;
  matched++;
  if (samplePairs.length < SAMPLE) samplePairs.push({ w: w.title, ia: hits[0].title });
  for (const h of hits.slice(0, MAX_SRC_PER_WORK)) {
    sources.push({
      work_id: w.id, source: cfg.source, source_id: h.ia, kind: 'scan',
      url: h.url, iiif: true, coverage: null,
      extra: { ia_title: h.title?.slice(0, 120), access_restricted: h.restricted, match: 'script-prefix' },
    });
  }
}
await mc.close();

// ── 3. report (always) + apply (optional) ─────────────────────────────────────
const keyable = works.length - thin;
console.log('=== CALIBRATION SAMPLE (work title → matched IA title) ===');
for (const p of samplePairs) console.log(`  ${(p.w || '').slice(0, 30).padEnd(30)} → ${(p.ia || '').slice(0, 50)}`);
console.log(`\n=== SCAN COVERAGE (${TRADITION}, prefix match, min-len ${MIN_LEN}) ===`);
console.log(`Works (no scan yet): ${works.length.toLocaleString()} (thin/unkeyable ${thin})`);
console.log(`Works with ≥1 IA manifest: ${matched.toLocaleString()} (${(matched / keyable * 100).toFixed(1)}% of keyable)`);
console.log(`Scan source rows prepared: ${sources.length.toLocaleString()}`);
console.log('NOTE: floor — only IA-harvested manifests, only when one title leads the other. Verify the sample.');

if (APPLY) {
  const n = await upsertSources(pg, sources);
  console.log(`\nApplied ${n} ${cfg.source} scan work_sources.`);
} else {
  console.log('\nMEASUREMENT ONLY — re-run with --apply to write work_sources.');
}
await pg.end();
