#!/usr/bin/env node
/**
 * #5099 step 2 of 3: fill clip_embeddings.embedding_v4 from a transformers-v4
 * CLIP server, row by row, without touching the live `embedding` column.
 *
 * Every row is re-embedded from ITS OWN image_url — the URL the live vector was
 * made from — so the v2 and v4 vectors of a row describe the same image. A row
 * is due when embedding_v4 is empty or embedding_v4_url no longer equals
 * image_url (the nightly backfill rewrote it). The UPDATE is guarded on
 * image_url, so a row that changes while its batch is in flight is left for the
 * next pass rather than given a vector of the old image.
 *
 * Refuses to write unless the server's /health says runtime v4: a v2 vector in
 * the v4 column would be invisible to every check except a cosine of 1.0.
 *
 * Walks by id (keyset) with a checkpoint file, so a killed run resumes where it
 * stopped; failures go to a JSONL file with the server's reason, and a second
 * pass (--from-start) retries them. Nothing is deleted.
 *
 * Usage (on Hetzner, beside the v4 server on :3458):
 *   set -a; source .env.production.local; set +a
 *   nice -n 10 node scripts/maintenance/clip-v4-shadow-reembed.mjs \
 *     [--clip-url=http://localhost:3458] [--concurrency=2] [--limit=N] [--dry-run] [--from-start] \
 *     [--state-dir=/var/log/sourcelibrary/clip-v4] [--only-url=S | --exclude-url=S] [--pause-ms=N]
 *
 * Needs the shadow columns (scripts/migration/clip-embeddings-v4-shadow.sql).
 * Next: scripts/audit/clip-v4-shadow-verify.mjs, then the cutover SQL.
 *
 * PRIOR ART: scripts/backfill-clip-embeddings.mjs — enumerates Mongo, skips any
 * id already in the table and writes the LIVE column, so it cannot re-embed
 * existing rows into a second column; scripts/maintenance/clip-index-repair.mjs
 * rewrites denormalised labels, not vectors.
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';

const opt = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const CLIP_URL = opt('clip-url', 'http://localhost:3458');
const CONCURRENCY = parseInt(opt('concurrency', '2'));
const LIMIT = parseInt(opt('limit', '0')) || 0;
const DRY_RUN = process.argv.includes('--dry-run');
const FROM_START = process.argv.includes('--from-start');
const STATE_DIR = opt('state-dir', '/var/log/sourcelibrary/clip-v4');
// Some IIIF hosts rate-limit hard: MDZ (api.digitale-sammlungen.de) returned 429
// for ~20K of 21.7K rows at concurrency 6. Re-run those alone and slowly:
//   --only-url=digitale-sammlungen --concurrency=1 --pause-ms=2000
// and the rest with --exclude-url=digitale-sammlungen.
const ONLY_URL = opt('only-url', '');
const EXCLUDE_URL = opt('exclude-url', '');
const PAUSE_MS = parseInt(opt('pause-ms', '0')) || 0;
const BATCH = 10;   // urls per /embed-images call
const PAGE = 200;   // rows per keyset page

fs.mkdirSync(STATE_DIR, { recursive: true });
const CHECKPOINT = path.join(STATE_DIR, `checkpoint${opt('only-url', '') ? '-only-' + opt('only-url', '').replace(/\W+/g, '_') : ''}${opt('exclude-url', '') ? '-excl-' + opt('exclude-url', '').replace(/\W+/g, '_') : ''}.txt`);
const FAILURES = path.join(STATE_DIR, 'failures.jsonl');
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

const health = await fetch(`${CLIP_URL}/health`).then(r => r.json()).catch(e => ({ error: e.message }));
if (health.runtime !== 'v4') {
  console.error(`REFUSING: ${CLIP_URL}/health reports runtime ${health.runtime ?? '(none)'} — only a v4 server may fill embedding_v4.`, health.error || '');
  process.exit(1);
}
log(`v4 server ok: ${health.embedding_model}`);

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL.replace(':6543/', ':5432/'), ssl: { rejectUnauthorized: false } });
await db.connect();

const DUE = `(embedding_v4 IS NULL OR embedding_v4_url IS DISTINCT FROM image_url)`
  + (ONLY_URL ? ` AND strpos(image_url, ${pgLiteral(ONLY_URL)}) > 0` : '')
  + (EXCLUDE_URL ? ` AND strpos(image_url, ${pgLiteral(EXCLUDE_URL)}) = 0` : '');
function pgLiteral(s) { return `'${s.replace(/'/g, "''")}'`; }
const { rows: [c] } = await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE ${DUE})::int AS due FROM clip_embeddings`);
log(`clip_embeddings: ${c.total} rows, ${c.due} due for a v4 vector`);
if (DRY_RUN) { await db.end(); process.exit(0); }

let cursor = !FROM_START && fs.existsSync(CHECKPOINT) ? fs.readFileSync(CHECKPOINT, 'utf8').trim() : '';
if (cursor) log(`resuming after id ${cursor}`);

let done = 0, failed = 0, skipped = 0;
const t0 = Date.now();

async function embedBatch(rows) {
  const res = await fetch(`${CLIP_URL}/embed-images`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: rows.map(r => r.image_url) }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) throw new Error(`embed-images HTTP ${res.status}`);
  const data = await res.json();
  const ok = [];
  data.results.forEach((r, i) => {
    if (r.embedding && r.embedding.length === 512) ok.push({ ...rows[i], embedding: r.embedding });
    else { failed++; fs.appendFileSync(FAILURES, JSON.stringify({ id: rows[i].id, url: rows[i].image_url, reason: r.error || 'no embedding', at: new Date().toISOString() }) + '\n'); }
  });
  if (ok.length) {
    const params = [];
    const values = ok.map((r, i) => { params.push(r.id, r.image_url, `[${r.embedding.join(',')}]`); return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::vector)`; });
    const { rowCount } = await db.query(
      `UPDATE clip_embeddings c SET embedding_v4 = v.e, embedding_v4_url = v.u, embedding_v4_at = now()
         FROM (VALUES ${values.join(',')}) AS v(id, u, e)
        WHERE c.id = v.id AND c.image_url = v.u`, params);
    done += rowCount;
    skipped += ok.length - rowCount; // image_url changed mid-flight; next pass picks it up
  }
}

while (true) {
  const { rows } = await db.query(
    `SELECT id, image_url FROM clip_embeddings WHERE id > $1 AND ${DUE} ORDER BY id LIMIT ${PAGE}`, [cursor]);
  if (!rows.length) break;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  // A small pool: overlaps image fetches with inference without starving the box.
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(b => embedBatch(b).catch(e => {
      failed += b.length;
      for (const r of b) fs.appendFileSync(FAILURES, JSON.stringify({ id: r.id, url: r.image_url, reason: `batch: ${e.message}`, at: new Date().toISOString() }) + '\n');
    })));
    if (PAUSE_MS) await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  cursor = rows[rows.length - 1].id;
  fs.writeFileSync(CHECKPOINT, cursor);
  const secs = (Date.now() - t0) / 1000;
  log(`${done} written, ${failed} failed, ${skipped} skipped — ${(done / secs).toFixed(2)}/s — at ${cursor}`);
  if (LIMIT && done + failed >= LIMIT) break;
}

const { rows: [after] } = await db.query(`SELECT count(*) FILTER (WHERE ${DUE})::int AS due FROM clip_embeddings`);
log(`DONE this pass: ${done} written, ${failed} failed, ${skipped} skipped; ${after.due} rows still due (failures in ${FAILURES})`);
await db.end();
