#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gemini-arm.mjs (step 1) — reads the
 * stored `page_translations` vectors for the #5729 pool by book id, without
 * checking WHICH text the vector was made from. A page that gained a translation
 * since has a vector of the English, not of the OCR, so here each row is kept
 * only when its kind matches the pool's (A: OCR-only row; B: translated row).
 *
 * stored — production's vectors for the pool pages (arm 1). Read, never written.
 * Writes <dir>/<pool>/stored.f32 (768-d, pool order, zero rows where unusable)
 * and stored-mask.json (1 = usable, 0 = no row, 2 = row of the other text kind).
 *
 *   node --env-file=.env.production.local scripts/eval/embed-format/stored.mjs --dir D
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { arg, readJsonl } from './common.mjs';

const DIR = arg('--dir');
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET statement_timeout = 300000');
for (const pool of ['A', 'B']) {
  const rows = readJsonl(path.join(DIR, pool, 'pool.jsonl'));
  const index = new Map(rows.map((r, i) => [`${r.book_id}:${r.page_number}`, i]));
  const out = new Float32Array(rows.length * 768);
  const mask = new Array(rows.length).fill(0);
  const models = {};
  const books = [...new Set(rows.map((r) => r.book_id))];
  for (let k = 0; k < books.length; k += 40) {
    const chunk = books.slice(k, k + 40);
    const nums = [...new Set(rows.filter((r) => chunk.includes(r.book_id)).map((r) => r.page_number))];
    const { rows: got } = await client.query(
      `SELECT book_id, page_number, embedding::text AS e, coalesce(translation, '') = '' AS ocr_only, embedding_model
       FROM page_translations WHERE book_id = ANY($1) AND page_number = ANY($2) AND embedding IS NOT NULL`, [chunk, nums]);
    for (const g of got) {
      const i = index.get(`${g.book_id}:${g.page_number}`);
      if (i === undefined) continue;
      if (g.ocr_only !== (pool === 'A')) { mask[i] = 2; continue; }
      out.set(JSON.parse(g.e), i * 768);
      mask[i] = 1;
      models[g.embedding_model] = (models[g.embedding_model] || 0) + 1;
    }
  }
  fs.writeFileSync(path.join(DIR, pool, 'stored.f32'), Buffer.from(out.buffer));
  fs.writeFileSync(path.join(DIR, pool, 'stored-mask.json'), JSON.stringify(mask));
  console.log(`${pool}: usable ${mask.filter((m) => m === 1).length} / ${rows.length}; other kind ${mask.filter((m) => m === 2).length}; none ${mask.filter((m) => m === 0).length}; models ${JSON.stringify(models)}`);
}
await client.end();
