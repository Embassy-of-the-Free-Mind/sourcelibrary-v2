#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-vector-truth.mjs --e5-scan reads every row of a LISTED book (exact, but it
 * needs the book list, and the 3-rows-per-book sample that made the list missed half the books).
 * A table scan of the 33 GB TOAST is not affordable on the live instance. Nothing listed the e5 rows corpus-wide.
 *
 * e5-enum — list every e5-shaped row of page_translations through the HNSW index (#6175).
 * e5-base vectors sit within 0.30 (cosine distance) of their centroid; Gemini rows start at 0.9. So the
 * nearest neighbours of the centroid ARE the e5 rows, and a pgvector 0.8 iterative scan streams them
 * until the first Gemini row. Read-only, one transaction, cursor-fed JSONL: [page_id, book_id, label, d].
 * Measured 2026-10-07: 211,377 rows in 41 min; recall 99.97% against 78,143 known rows.
 * A clean table returns 0 rows in seconds, which makes this the cheap "is it fixed?" check.
 *
 * Usage: node --env-file=.env.production.local scripts/eval/vector-truth/e5-enum.mjs OUT.jsonl
 */
import pg from 'pg'; import fs from 'node:fs';
import { e5CentroidLiteral, E5_SIGNATURE_MAX_DISTANCE } from '../../lib/vector-truth.mjs';
const OUT = process.argv[2];
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
await c.query('BEGIN READ ONLY');
await c.query("SET LOCAL statement_timeout = '5h'");
await c.query('SET LOCAL hnsw.ef_search = 1000');
await c.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
await c.query('SET LOCAL hnsw.max_scan_tuples = 3000000');
await c.query('SET LOCAL hnsw.scan_mem_multiplier = 16').catch(() => {});
await c.query(`DECLARE e5 NO SCROLL CURSOR FOR SELECT page_id, book_id, embedding_model, embedding <=> '${e5CentroidLiteral()}'::vector AS d FROM page_translations WHERE embedding IS NOT NULL ORDER BY embedding <=> '${e5CentroidLiteral()}'::vector`);
const out = fs.createWriteStream(OUT, { flags: 'w' });
let n = 0, far = 0; const t = Date.now();
for (;;) {
  const r = await c.query('FETCH 500 FROM e5');
  if (!r.rowCount) break;
  const hit = r.rows.filter(x => x.d < E5_SIGNATURE_MAX_DISTANCE);
  for (const x of hit) out.write(JSON.stringify([x.page_id, x.book_id, x.embedding_model, +x.d.toFixed(4)]) + '\n');
  n += hit.length;
  far = hit.length ? 0 : far + 1;
  if (n % 5000 < 500) console.log(`${new Date().toISOString()} ${n} e5 rows, ${((Date.now() - t) / 1000).toFixed(0)}s, last d ${r.rows.at(-1).d.toFixed(3)}`);
  if (far >= 2) break; // two full fetches with nothing e5-shaped: the cluster is exhausted
}
await new Promise(res => out.end(res));
await c.query('ROLLBACK'); await c.end();
console.log(`DONE ${n} e5 rows in ${((Date.now() - t) / 1000).toFixed(0)}s`);
