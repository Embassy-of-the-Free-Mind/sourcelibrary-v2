#!/usr/bin/env node
/**
 * Chinese scan-coverage join: works (Frame B catalog) ↔ ia_language=chinese IA
 * manifests (Frame A harvest, 717K) → work_sources(kind='scan', source='ia-chinese').
 *
 * Complements ingest-ia-cadal.mjs (the curated CADAL classical set). The broad
 * 717K ia_language=chinese harvest is mostly modern/Republican reprints, so the
 * recoverable classical-canon overlap is small (~245 works at the precise tier)
 * but high-precision: we only accept a match when the work's CJK-normalized title
 * is a PREFIX of the IA normalized title (work name leads; IA adds commentary /
 * volume / edition — 太極圖說 → 太極圖說論, 淮南鴻烈解 → 淮南鴻烈解·卷一~卷三).
 *
 * Generic short titles collide (周易 appears in thousands of IA titles), so a
 * minimum normalized-title length gates the match (default 4). Prints a
 * calibration sample + per-threshold coverage; only --apply writes work_sources.
 *
 * Run on Hetzner (needs MONGODB_URI + SUPABASE_DB_URL).
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/match-scans-chinese.mjs              # measure + sample
 *   node scripts/works-catalog/match-scans-chinese.mjs --apply      # write scan sources
 *   node scripts/works-catalog/match-scans-chinese.mjs --min-len=5 --sample=40
 */
import { MongoClient } from 'mongodb';
import { pgClient, upsertSources, normalizeCjk } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.slice(2).split('='); return [k, v ?? true];
}));
const MIN_LEN = parseInt(args['min-len']) || 4;   // min normalized-title chars to accept (collision guard)
const APPLY = 'apply' in args;
const SAMPLE = parseInt(args.sample) || 30;
const MAX_SRC_PER_WORK = 3;

// ── 1. index IA chinese manifests by 2-char block key of normalized title ─────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const col = mc.db('bookstore').collection('import_candidates');
console.log('Indexing ia_language=chinese manifests by normalized-title key…');
const byKey = new Map();
let iaCount = 0;
const cur = col.find(
  { source: 'ia_language', 'metadata.discovery_query': 'chinese', manifest_url: { $ne: null } },
  { projection: { title: 1, manifest_url: 1, source_id: 1, 'metadata.access_restricted': 1 } });
for await (const d of cur) {
  const n = normalizeCjk(d.title);
  if (n.length < 2) continue;
  const k = n.slice(0, 2);
  if (!byKey.has(k)) byKey.set(k, []);
  const arr = byKey.get(k);
  if (arr.length < 400) arr.push({ n, url: d.manifest_url, ia: d.source_id, title: d.title, restricted: !!d.metadata?.access_restricted });
  iaCount++;
}
console.log(`Indexed ${iaCount.toLocaleString()} manifests → ${byKey.size.toLocaleString()} keys`);

// ── 2. probe chinese works that have no scan yet ──────────────────────────────
const pg = pgClient();
await pg.connect();
const { rows: works } = await pg.query(
  `select w.id, w.title, w.title_normalized from works w
   where w.tradition = 'chinese'
     and not exists (select 1 from work_sources s where s.work_id = w.id and s.kind = 'scan')`);
console.log(`Probing ${works.length.toLocaleString()} chinese works WITHOUT a scan yet (min-len ${MIN_LEN})…\n`);

const cov = { 3: 0, 4: 0, 5: 0 }, tot = { 3: 0, 4: 0, 5: 0 };
let matched = 0;
const sources = [];
const samplePairs = [];
for (const w of works) {
  const wn = w.title_normalized || normalizeCjk(w.title);
  if (wn.length < 3) continue;
  for (const L of [3, 4, 5]) if (wn.length >= L) tot[L]++;
  const cand = byKey.get(wn.slice(0, 2)) || [];
  const hits = cand.filter(c => c.n.startsWith(wn));
  if (!hits.length) continue;
  for (const L of [3, 4, 5]) if (wn.length >= L) cov[L]++;
  if (wn.length < MIN_LEN) continue;   // below the accept threshold: counted in coverage, not written
  matched++;
  if (samplePairs.length < SAMPLE) samplePairs.push({ w: w.title, ia: hits[0].title });
  for (const h of hits.slice(0, MAX_SRC_PER_WORK)) {
    sources.push({
      work_id: w.id, source: 'ia-chinese', source_id: h.ia, kind: 'scan',
      url: h.url, iiif: true, coverage: null,
      extra: { ia_title: h.title?.slice(0, 120), access_restricted: h.restricted, match: 'cjk-prefix' },
    });
  }
}
await mc.close();

// ── 3. report (always) + apply (optional) ────────────────────────────────────
console.log('=== CALIBRATION SAMPLE (work title → matched IA title) ===');
for (const p of samplePairs) console.log(`  ${(p.w || '').slice(0, 24).padEnd(24)} → ${(p.ia || '').slice(0, 56)}`);
console.log('\n=== RECOVERABLE CHINESE SCAN COVERAGE (CJK-prefix match) ===');
for (const L of [3, 4, 5]) console.log(`  min title ${L} chars: ${cov[L].toLocaleString()} / ${tot[L].toLocaleString()} (${(100 * cov[L] / tot[L]).toFixed(1)}%)`);
console.log(`\nAccepting min-len ${MIN_LEN}: ${matched.toLocaleString()} works, ${sources.length.toLocaleString()} scan source rows prepared.`);
console.log('NOTE: precision drops sharply below len 4 (周易, 論語 too generic). Eyeball the sample.');

if (APPLY) {
  const n = await upsertSources(pg, sources);
  console.log(`\nApplied ${n} ia-chinese scan work_sources.`);
} else {
  console.log('\nMEASUREMENT ONLY — re-run with --apply to write work_sources.');
}
await pg.end();
