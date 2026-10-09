#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gemini-arm.mjs — reads the stored
 * `page_translations` vectors for a pool the same way (read, never written);
 * its pool, gold file and fill path are #5729's.
 *
 * Arm (a) of #6173: the page vectors production holds today. Pool pages with no
 * stored row are embedded the production way (cleanPageText text, 8,000 chars)
 * into the local store only, so every arm ranks the same 12K pages.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/arm-a-stored.mjs --dir DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { arg, loadPool, DIMS, embedAll, saveVecs } from './lib.mjs';

const DIR = arg('--dir');
const pool = loadPool(DIR);
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET statement_timeout = 600000');
const index = new Map(pool.map((r) => [`${r.book_id}:${r.page_number}`, r.i]));
const bookIds = [...new Set(pool.map((r) => r.book_id))];
const vecs = new Float32Array(pool.length * DIMS);
const have = new Set();
for (let k = 0; k < bookIds.length; k += 20) {
  const { rows } = await client.query(
    'SELECT book_id, page_number, embedding::text AS e FROM page_translations WHERE book_id = ANY($1) AND embedding IS NOT NULL',
    [bookIds.slice(k, k + 20)],
  );
  for (const r of rows) {
    const i = index.get(`${r.book_id}:${r.page_number}`);
    if (i === undefined) continue;
    const v = JSON.parse(r.e);
    const n = Math.hypot(...v) || 1;
    for (let d = 0; d < DIMS; d++) vecs[i * DIMS + d] = v[d] / n;
    have.add(i);
  }
}
await client.end();
const missing = pool.filter((p) => !have.has(p.i));
console.log(`stored vectors: ${have.size}/${pool.length}; filling ${missing.length}`);
let tokens = 0;
if (missing.length) {
  const r = await embedAll(missing.map((p) => p.text), { label: 'fill' });
  tokens = r.tokens;
  missing.forEach((p, j) => vecs.set(r.vecs.subarray(j * DIMS, (j + 1) * DIMS), p.i * DIMS));
}
saveVecs(path.join(DIR, 'vec-a.f32'), vecs);
fs.writeFileSync(path.join(DIR, 'arm-a.json'), JSON.stringify({ stored: have.size, filled: missing.length, fill_tokens: tokens, filled_i: missing.map((p) => p.i) }));
console.log(`arm a written; fill tokens ${tokens}`);
