#!/usr/bin/env node
/**
 * Re-seat a book's TEXT onto the right images by an explicit, checked-by-eye permutation map:
 * page N takes the text fields page `src` holds now (#5782).
 *
 * PRIOR ART: scripts/maintenance/repair-text-shift-run.mjs — the same write path (revisions
 *   first, conditional page writes, recount, book_events, resyncMirrors, embedding vectors moved
 *   with their text), but it can only move a run one page left or right, gated on a Clef offset
 *   map. The Rosenkreutzer Schutzschrift (6988a59f…) text is BLOCK-permuted (four blocks at
 *   offsets −169/+30/−70/+299 with local L/R swaps and duplicate photographs), so no ±1 run
 *   fits. scripts/lib/text-shift.mjs is the ±1 transform; a permutation needs no transform, the
 *   map is the move list.
 *
 * Map file (JSON): { book, issue, method, rows: [{ page, src, check, note? }] }
 *   - one row per page whose text changes; `src: null` clears the page (its own text was never
 *     produced; the caller flags it for OCR);
 *   - every row must carry `check` (how the pair was verified); a row without one is refused;
 *   - a `src` may appear twice when two leaves are photographs of the same printed page and
 *     only one transcription exists (the text is copied, not moved).
 * Sources are read from ONE pre-write snapshot, so a permutation (A↔B) is safe.
 *
 * Moves FIELDS: SHIFT_FIELDS (ocr, translation and their derivatives) plus `summary` and
 * `concept_abstract`, which are written from the page text and travel with it. Image-side
 * fields (photo, crop, split_detection, detected_images, page_frame) stay. `printed_page` is
 * fitted from the text tags, so it is refitted afterwards with
 * backfill-printed-page-4291.mjs --books=<id> --apply (not done here: one fitter, one writer).
 *
 * Guards: book with hidden_reason refused; human-edited ocr/translation on any touched page
 * refused; idempotent per (book, map hash) via book_events; each page write conditional on
 * the ocr.updated_at it was planned from (a concurrent re-OCR → skip, not clobber).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-text-permutation.mjs \
 *     --map scripts/eval/results/text-permutation-5782.json [--apply]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { SHIFT_FIELDS } from '../lib/text-shift.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { isHumanEditedTranslation, resyncMirrors } from '../lib/translation-text-repair.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const MAP = flag('map');
const APPLY = args.includes('--apply');
const BACKUP_DIR = flag('backup-dir', 'scripts/output/text-permutation-backups');
if (!MAP) { console.error('usage: --map <permutation.json> [--apply]'); process.exit(1); }

export const MOVE_FIELDS = [...SHIFT_FIELDS, 'summary', 'concept_abstract'];

const raw = fs.readFileSync(MAP, 'utf8');
const { book: BOOK, issue: ISSUE, rows } = JSON.parse(raw);
const MAP_HASH = createHash('sha256').update(raw).digest('hex').slice(0, 16);
const SOURCE = flag('source', `text-permutation-${ISSUE}`);
if (!BOOK || !ISSUE || !Array.isArray(rows) || !rows.length) { console.error('map needs book, issue, rows'); process.exit(1); }
const unchecked = rows.filter((r) => !r.check).map((r) => r.page);
if (unchecked.length) { console.log(`[REFUSE] rows without a check: ${unchecked}`); process.exit(2); }
const dupDst = rows.map((r) => r.page).filter((p, i, a) => a.indexOf(p) !== i);
if (dupDst.length) { console.log(`[REFUSE] page listed twice: ${dupDst}`); process.exit(2); }

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
try {
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, title: 1, hidden_reason: 1 } });
  if (!book) throw new Error('book not found');
  if (book.hidden_reason) { console.log(`[REFUSE] hidden_reason=${book.hidden_reason}`); process.exit(2); }
  const done = await db.collection('book_events').findOne({ book_id: BOOK, type: 'text_permutation_repair', 'details.map_hash': MAP_HASH });
  if (done) { console.log('[SKIP] this map is already applied (book_events)'); process.exit(0); }

  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: 1 } }).sort({ page_number: 1 }).toArray();
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const missing = rows.flatMap((r) => [r.page, r.src]).filter((n) => n != null && !byNum.has(n));
  if (missing.length) { console.log(`[REFUSE] map names pages the book does not have: ${missing}`); process.exit(2); }

  const touched = rows.map((r) => byNum.get(r.page));
  const sources = rows.filter((r) => r.src != null).map((r) => byNum.get(r.src));
  const human = [...touched, ...sources].filter((p) => isHumanEditedTranslation(p.translation) || p.ocr?.source === 'manual' || p.ocr?.edited_by);
  if (human.length) { console.log(`[REFUSE] human-edited text on pages ${[...new Set(human.map((p) => p.page_number))]}`); process.exit(2); }

  const moves = rows.filter((r) => r.src !== r.page).map((r) => {
    const src = r.src == null ? null : byNum.get(r.src);
    const set = {}, unset = [];
    for (const f of MOVE_FIELDS) { if (src && src[f] !== undefined) set[f] = src[f]; else unset.push(f); }
    return { page_number: r.page, src_page_number: r.src, cleared: r.src == null, set, unset };
  });
  const textOf = (p) => String(p?.ocr?.data || '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const counts = {}; for (const r of rows) if (r.src != null) counts[r.src] = (counts[r.src] || 0) + 1;
  console.log(`${book.title?.slice(0, 70)}\n  map ${MAP_HASH}: ${moves.length} moves, cleared [${moves.filter((m) => m.cleared).map((m) => m.page_number)}], copied sources [${Object.keys(counts).filter((k) => counts[k] > 1)}]`);
  for (const m of moves.filter((_, i) => i % 60 === 0)) console.log(`  p${m.page_number} ← p${m.src_page_number ?? '∅'}: "${textOf(byNum.get(m.src_page_number))}"`);
  if (!APPLY) { console.log('[DRY RUN] no writes — pass --apply'); process.exit(0); }

  // ── Backup + revisions FIRST ──
  const now = new Date();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `${BOOK}-${MAP_HASH}-${now.toISOString().replace(/[:.]/g, '')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(pages.map((p) => ({ _id: String(p._id), id: p.id, page_number: p.page_number, ...Object.fromEntries(MOVE_FIELDS.map((f) => [f, p[f]])) }))));
  const revisions = [];
  for (const m of moves) {
    const p = byNum.get(m.page_number);
    for (const f of ['ocr', 'translation']) {
      if (!p[f]?.data) continue;
      const { data, ...meta } = p[f];
      revisions.push({
        id: randomBytes(6).toString('hex'), page_id: p.id, book_id: BOOK, field: f, data,
        model: p[f].model ?? null, language: p[f].language ?? null, prompt_version: p[f].prompt_version ?? null,
        source: SOURCE, reason: m.cleared ? 'text permutation: this page\'s own text was never produced; cleared'
          : `text permutation: this page now takes the text that sat on p${m.src_page_number}, which transcribes its image`,
        issue: ISSUE, edited_by: null, job_id: null, original_date: p[f].updated_at ?? null, created_at: now, meta,
      });
    }
  }
  if (revisions.length) await db.collection('page_revisions').insertMany(revisions);

  // ── Pages, each conditional on the ocr it was planned from ──
  const ops = moves.map((m) => {
    const dst = byNum.get(m.page_number);
    const update = { $set: { ...m.set, updated_at: now, text_permutation_repaired_at: now } };
    if (m.unset.length) update.$unset = Object.fromEntries(m.unset.map((f) => [f, '']));
    return { updateOne: { filter: { _id: dst._id, 'ocr.updated_at': dst.ocr?.updated_at ?? null }, update } };
  });
  const res = await db.collection('pages').bulkWrite(ops, { ordered: true });
  console.log(`  pages written: ${res.modifiedCount}/${ops.length}; revisions ${revisions.length}; backup ${backupFile}`);
  if (res.modifiedCount !== ops.length) console.log('  [WARN] some pages changed under us — inspect before purging');

  await recountBook(db, BOOK, { reason: 'repair-text-permutation', now });
  await db.collection('book_events').insertOne({
    book_id: BOOK, type: 'text_permutation_repair', at: now, source: 'repair-text-permutation',
    details: { map: MAP, map_hash: MAP_HASH, pages: moves.length, cleared: moves.filter((m) => m.cleared).map((m) => m.page_number), revisions: revisions.length, revision_source: SOURCE, issue: ISSUE, backup: backupFile },
  });

  // ── Supabase: pages mirror + snippet (resyncMirrors), then move embedding vectors with their text ──
  const ids = moves.map((m) => byNum.get(m.page_number).id);
  console.log('  mirrors:', JSON.stringify(await resyncMirrors(db, ids)));
  if (process.env.SUPABASE_DB_URL) {
    const { default: pg } = await import('pg');
    const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await sb.connect();
    try {
      const allIds = pages.map((p) => p.id);
      const old = new Map((await sb.query('SELECT page_id, embedding FROM page_translations WHERE page_id = ANY($1)', [allIds])).rows.map((r) => [r.page_id, r]));
      let moved = 0, nulled = 0;
      for (const m of moves) {
        const dstId = byNum.get(m.page_number).id;
        if (!old.has(dstId)) continue;
        const src = m.src_page_number == null ? null : old.get(byNum.get(m.src_page_number).id);
        if (src) { await sb.query('UPDATE page_translations SET embedding = $1 WHERE page_id = $2', [src.embedding, dstId]); moved++; }
        else { await sb.query("UPDATE page_translations SET embedding = NULL, translation = '' WHERE page_id = $1", [dstId]); nulled++; }
      }
      console.log(`  page_translations embeddings: ${moved} moved, ${nulled} cleared (no source row)`);
    } finally { await sb.end(); }
  }
  console.log('[OK] applied — refit printed_page, eye 5 leaves, purge the book on Cloudflare');
} finally { await client.close(); }
