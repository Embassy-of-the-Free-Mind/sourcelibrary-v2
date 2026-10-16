#!/usr/bin/env node
/**
 * PRIOR ART: scripts/migration/add-page-translations-withheld.mjs --move — the same column move (#4523), but it
 * stamps every row `stale_after_reocr_4523`, matches rows with an empty snippet (so a re-run would park a CORRECT
 * OCR-only vector that the worker wrote after the withhold), and does not skip pages that were translated again
 * after the withhold. withhold-leaked-reasoning-6117.mjs parks only the pages it withholds itself.
 * enumerate-reembed-6221.mjs finds the no-text class but, by design, writes nothing.
 *
 * park-withheld-vectors-6221 — take two classes of `page_translations` rows out of search (#6221). Nothing is
 * deleted: the snippet and the vector move to `translation_withheld` / `embedding_withheld`, and every RPC skips
 * the row because it needs a non-null `embedding`. `--undo` moves them back.
 *
 *   withheld  The Mongo page's English is withheld (`translation_withheld.reason` set, no live translation text),
 *             but the row still serves the withheld English as its snippet and vector. The withhold happened after
 *             the embed, and removing `translation` makes the page's source timestamp fall back to the OCR's, which
 *             is older than the watermark, so `--restale` never sees it. Every book (withheld text is not served
 *             anywhere). Only rows with a NON-EMPTY snippet: an empty snippet is the worker's own OCR re-embed.
 *             Reason stamped: `withheld-<mongo reason>-6221`.
 *   no-text   A served row in a live book whose page the worker would write NO row for (`workerEmbeddingInput`
 *             null: a stub OCR and no usable translation). A re-embed cannot fix it, and its vector is of text the
 *             page no longer holds (Agrippa 1550 p. 623 served p. 622's translation). Candidates come from a fresh
 *             enumerator run (`--from DIR` → unlisted.jsonl, class no-text, live); each is re-checked against
 *             current Mongo before it moves. Reason stamped: `no-text-6221`.
 *
 * Writes one `sweep_log` row per book (sweep `park-withheld-vectors-6221`). Default is a dry run with counts.
 *
 * What acts on this next: nothing pays. The embed worker writes a row only when a page's source timestamp moves
 * past the watermark; it then upserts a fresh vector from the page's CURRENT text (OCR, empty snippet), which is
 * the intended end state.
 *
 * Usage (needs SUPABASE_DB_URL, the direct-postgres URL):
 *   node --env-file=.env.production.local scripts/maintenance/park-withheld-vectors-6221.mjs --from DIR [--apply]
 *   node --env-file=.env.production.local scripts/maintenance/park-withheld-vectors-6221.mjs --undo [--apply]
 *   [--class withheld|no-text] [--book ID]
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { workerEmbeddingInput } from '../lib/page-embedding-text.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const flag = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const FROM = flag('--from');
const ONLY_CLASS = flag('--class');
const ONLY_BOOK = flag('--book');
const SWEEP = 'park-withheld-vectors-6221';
const BATCH = 500;
if (!process.env.SUPABASE_DB_URL) { console.error('Missing SUPABASE_DB_URL'); process.exit(2); }
if (!UNDO && !FROM && ONLY_CLASS !== 'withheld') { console.error('--from DIR (a fresh enumerate-reembed-6221 run) is required for the no-text class'); process.exit(2); }

const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const t = {};
const bump = (k, n = 1) => { t[k] = (t[k] || 0) + n; };

if (UNDO) {
  const like = ONLY_CLASS === 'no-text' ? 'no-text-6221' : ONLY_CLASS === 'withheld' ? 'withheld-%-6221' : '%-6221';
  const where = `withheld_reason LIKE $1 ${ONLY_BOOK ? 'AND book_id = $2' : ''}`;
  const args = ONLY_BOOK ? [like, ONLY_BOOK] : [like];
  const n = (await pgc.query(`SELECT withheld_reason, count(*)::int n FROM page_translations WHERE ${where} GROUP BY 1`, args)).rows;
  console.log('rows parked by this sweep:', n);
  if (APPLY) {
    const r = await pgc.query(
      `UPDATE page_translations
          SET translation = COALESCE(translation_withheld, translation), embedding = COALESCE(embedding_withheld, embedding),
              translation_withheld = NULL, embedding_withheld = NULL, withheld_at = NULL, withheld_reason = NULL
        WHERE ${where}`, args);
    console.log(`restored ${r.rowCount} rows`);
  } else console.log('dry run — pass --apply to restore');
  await pgc.end(); await mongo.close(); process.exit(0);
}

/** pageId -> { book_id, reason } */
const targets = new Map();

if (!ONLY_CLASS || ONLY_CLASS === 'withheld') {
  const cur = db.collection('pages').find(
    { 'translation_withheld.reason': { $exists: true }, ...(ONLY_BOOK ? { book_id: ONLY_BOOK } : {}) },
    { projection: { _id: 0, id: 1, book_id: 1, 'translation_withheld.reason': 1, translation: 1 } });
  const ids = new Map();
  for await (const p of cur) {
    const live = typeof p.translation === 'string' ? p.translation : p.translation?.data;
    if (typeof live === 'string' && live.trim()) { bump('withheldButRetranslated'); continue; }
    ids.set(String(p.id), { book_id: String(p.book_id), reason: `withheld-${String(p.translation_withheld.reason).replace(/[^a-z0-9_]/gi, '_')}-6221` });
  }
  t.mongoWithheldPages = ids.size;
  const list = [...ids.keys()];
  for (let i = 0; i < list.length; i += 5000) {
    const { rows } = await pgc.query(
      `SELECT page_id, withheld_at IS NOT NULL AS parked, embedding IS NOT NULL AS served
         FROM page_translations WHERE page_id = ANY($1::text[]) AND COALESCE(translation,'') <> ''`, [list.slice(i, i + 5000)]);
    for (const r of rows) {
      // A parked row that holds a snippet again: a COALESCE move would keep the older parked text and drop this
      // one. Not seen when this was written; counted, never moved.
      if (r.parked) { bump('withheldSnippetOnParkedRow'); continue; }
      targets.set(r.page_id, ids.get(r.page_id));
      bump(`withheld:${ids.get(r.page_id).reason}`);
      if (!r.served) bump('withheldSnippetNoVector');
    }
  }
}

if (!ONLY_CLASS || ONLY_CLASS === 'no-text') {
  const cand = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(FROM, 'unlisted.jsonl')) });
  for await (const line of rl) {
    const [pageId, bookId, cls, live] = JSON.parse(line);
    if (cls !== 'no-text' || !live || (ONLY_BOOK && bookId !== ONLY_BOOK) || targets.has(pageId)) continue;
    cand.set(pageId, bookId);
  }
  t.noTextCandidates = cand.size;
  const live = new Set((await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1 } }).toArray()).map(b => String(b.id)));
  const list = [...cand.keys()];
  for (let i = 0; i < list.length; i += 500) {
    const slice = list.slice(i, i + 500);
    const docs = await db.collection('pages').find({ id: { $in: slice } },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1 } }).toArray();
    const rows = new Map((await pgc.query(
      `SELECT page_id FROM page_translations WHERE page_id = ANY($1::text[]) AND embedding IS NOT NULL AND withheld_at IS NULL`, [slice])).rows.map(r => [r.page_id, true]));
    const byId = new Map(docs.map(d => [String(d.id), d]));
    for (const id of slice) {
      const p = byId.get(id);
      // Re-check today's state: page still there, not archived, book still live, row still served, and the worker
      // would still write nothing. Anything that changed since the enumerator ran is left alone.
      if (!p || !(p.page_number > 0) || !live.has(String(p.book_id)) || !rows.has(id)) { bump('noTextChangedSinceEnum'); continue; }
      if (workerEmbeddingInput(p)) { bump('noTextNowHasText'); continue; }
      targets.set(id, { book_id: String(p.book_id), reason: 'no-text-6221' });
      bump('noText:no-text-6221');
    }
  }
}

t.toPark = targets.size;
console.log(JSON.stringify(t, null, 2));

if (APPLY && targets.size) {
  const byReason = new Map();
  for (const [id, v] of targets) { if (!byReason.has(v.reason)) byReason.set(v.reason, []); byReason.get(v.reason).push(id); }
  let moved = 0;
  for (const [reason, ids] of byReason) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await pgc.query(
        `UPDATE page_translations
            SET translation_withheld = translation, embedding_withheld = embedding,
                translation = '', embedding = NULL, withheld_at = now(), withheld_reason = $2
          WHERE page_id = ANY($1::text[]) AND withheld_at IS NULL
            AND (embedding IS NOT NULL OR COALESCE(translation,'') <> '')`, [ids.slice(i, i + BATCH), reason]);
      moved += r.rowCount;
      if ((i / BATCH) % 20 === 0) process.stdout.write(`  ${reason} ${Math.min(i + BATCH, ids.length)}/${ids.length}\r`);
    }
  }
  console.log(`\nmoved ${moved} rows`);
  const perBook = new Map();
  for (const [, v] of targets) {
    const k = `${v.book_id}\t${v.reason}`;
    perBook.set(k, (perBook.get(k) || 0) + 1);
  }
  await recordSweepActions(db, [...perBook].map(([k, n]) => {
    const [book_id, reason] = k.split('\t');
    return { sweep: SWEEP, book_id, action: 'parked-page-vectors', detail: { reason, rows: n, issue: 6221 } };
  }));
  const all = [...targets.keys()];
  let still = 0;
  for (let i = 0; i < all.length; i += 5000) {
    still += (await pgc.query(`SELECT count(*)::int n FROM page_translations WHERE page_id = ANY($1::text[]) AND embedding IS NOT NULL`, [all.slice(i, i + 5000)])).rows[0].n;
  }
  console.log(`read back: ${still} of ${all.length} target rows still serve a vector; ${perBook.size} sweep_log rows`);
} else if (!APPLY) console.log('dry run — pass --apply to move');

await pgc.end();
await mongo.close();
