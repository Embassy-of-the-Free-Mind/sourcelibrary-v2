#!/usr/bin/env node
/**
 * Recall of tenant-scoped semantic PAGE search against exact ground truth (#4330).
 *
 * PRIOR ART: scripts/audit/semantic-language-filter-recall.mjs — pins that a
 * LANGUAGE filter on the global RPC pre-filters, by asserting a rare language
 * returns rows. It has no ground truth and no book-set scope, so it cannot say
 * how much of a tenant's true top-N the scoped lane returns. This one can.
 *
 * WHY IT EXISTS. A partner reading room searches only its own shelf. The scope
 * is a list of book ids, and a WHERE on an `ORDER BY embedding <=> q LIMIT n`
 * query is a post-filter over HNSW (`.claude/docs/embeddings.md`): the deployed
 * `match_pages_in_books`, given a tenant's ~2,000 ids, answers an off-topic
 * query with ZERO rows in 150 ms. `match_pages_in_scope`
 * (scripts/migration/add-scoped-embedding-rpcs.sql) replaces it with bounded
 * work — nearest books in scope, their pages exactly, plus one HNSW pass — and
 * bounded work is not exact recall. This measures the gap.
 *
 * Three arms per query, all read-only:
 *   truth   exact top-N over EVERY page vector in the tenant, scanned in chunks
 *           of books (a single statement over 300K+ rows did not finish in 90 s)
 *   scoped  match_pages_in_scope
 *   before  the global match_semantic top-N, filtered to the tenant afterwards —
 *           what the lanes did until now
 *
 * Runs against the DEPLOYED function when it exists; otherwise it loads the
 * migration file into `pg_temp` inside a transaction that is rolled back, so the
 * SQL in the PR can be measured before anyone applies it. Nothing is written.
 *
 * The truth arm reads every page vector of the tenant once: minutes, not
 * seconds, on a cold cache. Run it when the function or its `probe_books`
 * default changes, not on a schedule.
 *
 * The scoped and before arms run FIRST, twice, so their latency is read on the
 * cache as production has it — the truth scan evicts the vector index and a
 * scoped call timed after it took 5–11 s against 0.1–3 s before it.
 *
 *   node --env-file=.env.production.local scripts/audit/scoped-page-recall.mjs [tenant-slug] [--probe=12,24] [--near=200,400] [--limit=15]
 *
 * Exit codes: 0 pass (mean recall of the FIRST setting >= --min, default 0.6,
 * and no query starved), 1 fail, 2 unknown (a control failed: no rows in scope,
 * or no embedding).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const val = (f) => { const m = args.find((a) => a.startsWith(`${f}=`)); return m ? m.slice(f.length + 1) : undefined; };
const TENANT_SLUG = args.find((a) => !a.startsWith('--')) || 'bhutan';
const LIMIT = parseInt(val('--limit') || '15', 10);
// Comma lists sweep: --probe=12,24 --near=200,400 measures every combination
// against one truth scan. Omitted = the function's own defaults.
const list = (f) => (val(f) ? val(f).split(',').map((n) => parseInt(n, 10)) : [null]);
const PROBES = list('--probe');
const NEARS = list('--near');
const MIN_RECALL = parseFloat(val('--min') || '0.6');
const CHUNK_BOOKS = 40;
const THRESHOLD = 0.3;

// Half are subjects the shelf is about, half are not: the off-topic ones are
// where a post-filter starves, so they are the ones that prove anything.
const QUERIES = {
  bhutan: [
    'compassion and emptiness',
    'ritual offering to the protector deities',
    'medicine and healing herbs',
    'alchemy and the philosophers stone',
    'astrology and the calculation of the calendar',
  ],
  bph: [
    'alchemy and the philosophers stone',
    'rosicrucian brotherhood',
    'compassion and emptiness',
    'navigation by the stars at sea',
    'the anatomy of the human heart',
  ],
};

async function embed(text) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ model: 'models/gemini-embedding-2-preview', content: { parts: [{ text }] }, outputDimensionality: 768 }],
      }),
    },
  );
  const d = await r.json();
  return d.embeddings?.[0]?.values || null;
}

const m = new MongoClient(process.env.MONGODB_URI);
await m.connect();
const db = m.db(process.env.MONGODB_DB || 'bookstore');
const tenant = await db.collection('tenants').findOne({ slug: TENANT_SLUG, status: { $ne: 'deleted' } });
if (!tenant) { console.error(`No tenant for slug "${TENANT_SLUG}"`); process.exit(2); }
// Same predicate as src/lib/tenant-search-scope.ts.
const ids = (await db.collection('books')
  .find({ tenantId: tenant.id, visible: true, hidden: { $ne: true } })
  .project({ _id: 0, id: 1 }).toArray()).map((b) => b.id).filter(Boolean);
await m.close();
const idSet = new Set(ids);

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
await c.query('BEGIN');
await c.query("SET LOCAL statement_timeout = '180s'");

const deployed = (await c.query(
  "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'match_pages_in_scope'",
)).rowCount > 0;
let schema = 'public';
if (!deployed) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migration', 'add-scoped-embedding-rpcs.sql');
  const sql = fs.readFileSync(file, 'utf8')
    .replace(/public\.match_/g, 'pg_temp.match_')
    .replace(/CREATE OR REPLACE FUNCTION/g, 'CREATE FUNCTION')
    .replace(/^NOTIFY.*$/m, '');
  await c.query(sql);
  schema = 'pg_temp';
}

const inScope = (await c.query('select count(embedding)::int n from page_translations where book_id = any($1)', [ids])).rows[0].n;
console.log(`Tenant "${TENANT_SLUG}": ${ids.length} books in scope, ${inScope} page vectors.`);
console.log(`Function: ${schema}.match_pages_in_scope (${deployed ? 'deployed' : 'NOT deployed — loaded from the migration file, session-local'}), limit=${LIMIT}\n`);
if (ids.length === 0 || inScope === 0) { console.error('UNKNOWN: nothing in scope to measure.'); await c.query('ROLLBACK'); await c.end(); process.exit(2); }

const queries = QUERIES[TENANT_SLUG] || QUERIES.bph;
const embedded = [];
for (const q of queries) {
  const e = await embed(q);
  if (!e) { console.error(`UNKNOWN: embedding failed for "${q}"`); await c.query('ROLLBACK'); await c.end(); process.exit(2); }
  embedded.push({ q, e: JSON.stringify(e), truth: [] });
}

const settings = PROBES.flatMap((probe) => NEARS.map((near) => ({ probe, near })));
const label = (st) => `probe=${st.probe ?? 'default'} near=${st.near ?? 'default'}`;
const scopedCall = (item, st) => c.query(
  `select page_id, book_id, similarity from ${schema}.match_pages_in_scope($1::vector, $2, ${THRESHOLD}, ${LIMIT}` +
  `${st.probe != null || st.near != null ? `, ${st.probe ?? 12}` : ''}${st.near != null ? `, ${st.near}` : ''})`,
  [item.e, ids],
);

// ── scoped + before, first: latency on an undisturbed cache ──
for (const item of embedded) {
  item.scoped = [];
  for (const st of settings) {
    const s0 = Date.now();
    const rows = (await scopedCall(item, st)).rows;
    const coldMs = Date.now() - s0;
    const s1 = Date.now();
    await scopedCall(item, st);
    item.scoped.push({ st, rows, coldMs, warmMs: Date.now() - s1 });
  }
  item.before = (await c.query(
    `select page_id, book_id from public.match_semantic($1::vector, ${THRESHOLD}, ${LIMIT}, null, null, null, null, null, null)`,
    [item.e],
  )).rows.filter((r) => idSet.has(r.book_id));
}

// ── truth: exact scan, chunked by book ──
const t0 = Date.now();
for (let i = 0; i < ids.length; i += CHUNK_BOOKS) {
  const chunk = ids.slice(i, i + CHUNK_BOOKS);
  for (const item of embedded) {
    const r = await c.query(
      `SELECT s.page_id, s.dist FROM (
         SELECT p.page_id, (p.embedding <=> $1::vector) AS dist
         FROM page_translations p WHERE p.book_id = ANY($2) AND p.embedding IS NOT NULL OFFSET 0
       ) s WHERE 1 - s.dist > ${THRESHOLD} ORDER BY s.dist LIMIT ${LIMIT}`,
      [item.e, chunk],
    );
    item.truth.push(...r.rows);
  }
  if ((i / CHUNK_BOOKS) % 10 === 0) process.stderr.write(`  truth: ${Math.min(i + CHUNK_BOOKS, ids.length)}/${ids.length} books, ${Math.round((Date.now() - t0) / 1000)}s\n`);
}
await c.query('ROLLBACK');
await c.end();

const sums = settings.map(() => 0);
let starved = 0;
let beforeSum = 0;
for (const item of embedded) {
  const truth = item.truth.sort((a, b) => a.dist - b.dist).slice(0, LIMIT);
  const truthIds = new Set(truth.map((r) => r.page_id));
  const hit = (rows) => (truthIds.size ? rows.filter((r) => truthIds.has(r.page_id)).length / truthIds.size : 1);
  const beforeRecall = hit(item.before);
  beforeSum += beforeRecall;
  console.log(`"${item.q}"`);
  console.log(`   truth  ${truth.length} rows, best ${truth[0] ? (1 - truth[0].dist).toFixed(3) : '-'}, ${LIMIT}th ${truth.at(-1) ? (1 - truth.at(-1).dist).toFixed(3) : '-'}`);
  console.log(`   before ${item.before.length} rows (global top-${LIMIT}, post-filtered), recall ${(beforeRecall * 100).toFixed(0)}%`);
  item.scoped.forEach(({ st, rows, coldMs, warmMs }, k) => {
    const recall = hit(rows);
    const foreign = rows.filter((r) => !idSet.has(r.book_id)).length;
    sums[k] += recall;
    // Starved: the shelf answers the query and the lane returned nothing. A
    // foreign row is worse than a missing one and fails the same way.
    if (k === 0 && ((truth.length > 0 && rows.length === 0) || foreign > 0)) starved++;
    console.log(`   scoped [${label(st)}] ${rows.length} rows, best ${rows[0]?.similarity.toFixed(3) ?? '-'}, ${LIMIT}th ${rows.at(-1)?.similarity.toFixed(3) ?? '-'}, recall@${LIMIT} ${(recall * 100).toFixed(0)}%, first call ${coldMs}ms, repeat ${warmMs}ms, foreign ${foreign}`);
  });
}

console.log(`\nMean recall@${LIMIT} over ${embedded.length} queries (truth scan ${Math.round((Date.now() - t0) / 1000)}s):`);
console.log(`   before: ${(beforeSum / embedded.length * 100).toFixed(0)}%`);
settings.forEach((st, k) => console.log(`   scoped [${label(st)}]: ${(sums[k] / embedded.length * 100).toFixed(0)}%`));
const mean = sums[0] / embedded.length;
if (starved > 0) { console.error(`FAIL: ${starved} query(ies) starved (rows exist in scope, none returned) or returned a foreign row.`); process.exit(1); }
if (mean < MIN_RECALL) { console.error(`FAIL: mean recall ${(mean * 100).toFixed(0)}% is under the ${(MIN_RECALL * 100).toFixed(0)}% floor.`); process.exit(1); }
console.log('PASS');
