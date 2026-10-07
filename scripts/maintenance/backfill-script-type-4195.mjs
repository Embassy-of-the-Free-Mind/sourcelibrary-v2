#!/usr/bin/env node
/**
 * Backfill `pages.script_type` from the `<script>` tag already in `ocr.data` (#4195 item 4).
 *
 * PRIOR ART: scripts/lib/ocr-result-parse.mjs — liftOcrTags/extractScriptType are the
 * parser this reuses; no backfill of a lifted OCR tag exists under scripts/maintenance
 * (looked for backfill-*page-type*, *script*, *tag*).
 *
 * Why: the OCR prompt has asked for `<script>printed|handwritten|mixed</script>` for
 * months, but only the realtime Lambda writer lifted it. Every Batch collector dropped
 * it, so the tag is in the stored text while the field is empty for most of the corpus.
 * The writers are fixed in the same PR (liftOcrTags); this fills the history.
 * No model calls — it re-parses text we already hold.
 *
 * What it writes, and what it deliberately does not:
 *   - `$set: { script_type }` on pages where the field is ABSENT and the tag parses.
 *     The filter repeats `script_type: { $exists: false }` at write time, so a page a
 *     live writer stamped meanwhile is never overwritten.
 *   - NOT `updated_at`. `sync-pages-content.mjs` re-upserts every page whose
 *     `updated_at` moved, so bumping it would re-sync the full content of every
 *     touched page to Supabase for one small field. Supabase's `script_type` column
 *     therefore stays as it was for backfilled rows; new writes sync normally.
 *   - One `sweep_log` row per book (field-sprawl.md: a sweep records a ROW).
 *
 * Walks `_id` in chunks with a checkpoint file, so an interrupted run resumes
 * (lesson: corpus walks need a checkpoint FIRST). Run it on Hetzner, not the laptop.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/backfill-script-type-4195.mjs            # dry run (default)
 *   node --env-file=.env.production.local scripts/maintenance/backfill-script-type-4195.mjs --apply
 *     [--limit=N]        stop after N matched pages (for a sample)
 *     [--checkpoint=F]   default scripts/output/backfill-script-type-4195.checkpoint.json
 *     [--reset]          ignore an existing checkpoint
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { extractScriptType } from '../lib/ocr-result-parse.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SWEEP = 'backfill-script-type-4195';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESET = args.includes('--reset');
const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 0);
const CHECKPOINT = args.find((a) => a.startsWith('--checkpoint='))?.split('=')[1]
  || path.join('scripts/output', `${SWEEP}${APPLY ? '' : '.dry'}.checkpoint.json`);
const CHUNK = 2000;

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set — run with --env-file=.env.production.local');

// `pages._id` is mixed: ~25.4M ObjectIds and ~133K strings (2026-10-02). BSON
// orders all strings before all ObjectIds and a `$gt` only compares within one
// type, so the walk runs one phase per type and keeps the checkpoint's native
// type — a first draft that coerced the checkpoint to ObjectId jumped from the
// string range straight to the newest pages and "finished" after 4,246.
const PHASES = ['string', 'objectId'];

function loadCheckpoint() {
  if (RESET || !fs.existsSync(CHECKPOINT)) {
    return { phase: 0, last_id: null, matched: 0, invalid: 0, by_value: {}, written: 0, raced: 0, books: {} };
  }
  return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
}
function saveCheckpoint(cp) {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, JSON.stringify(cp));
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const pages = db.collection('pages');
const cp = loadCheckpoint();
console.log(`${SWEEP} — ${APPLY ? 'APPLY' : 'DRY RUN'} — phase ${PHASES[cp.phase] ?? 'done'}, after ${cp.last_id ?? 'start'} (${cp.matched} matched so far)`);

const started = Date.now();
let scannedThisRun = 0;
try {
  while (cp.phase < PHASES.length) {
    const phase = PHASES[cp.phase];
    // The tag match runs server-side: only pages that carry a <script> tag cross the
    // wire, instead of the text of all 25M pages.
    const filter = { script_type: { $exists: false }, 'ocr.data': { $regex: '<script>', $options: 'i' } };
    filter._id = cp.last_id == null ? { $type: phase }
      : { $type: phase, $gt: phase === 'objectId' ? new ObjectId(cp.last_id) : cp.last_id };
    const docs = await pages.find(filter, { projection: { _id: 1, book_id: 1, 'ocr.data': 1 } })
      .sort({ _id: 1 }).limit(CHUNK).maxTimeMS(600000).toArray();
    if (docs.length === 0) { cp.phase++; cp.last_id = null; saveCheckpoint(cp); continue; }

    const ops = [];
    const bookCounts = {};
    for (const d of docs) {
      const text = d.ocr?.data;
      const value = extractScriptType(text);
      if (!value) { // a tag whose value is outside printed|handwritten|mixed — reported, never coerced
        cp.invalid++;
        const raw = (text.match(/<script>([\s\S]*?)<\/script>/i)?.[1] ?? '(unclosed)').trim().toLowerCase().slice(0, 40);
        cp.invalid_values = cp.invalid_values || {};
        if (Object.keys(cp.invalid_values).length < 50 || raw in cp.invalid_values) cp.invalid_values[raw] = (cp.invalid_values[raw] || 0) + 1;
        continue;
      }
      cp.by_value[value] = (cp.by_value[value] || 0) + 1;
      bookCounts[d.book_id] = (bookCounts[d.book_id] || 0) + 1;
      ops.push({ updateOne: { filter: { _id: d._id, script_type: { $exists: false } }, update: { $set: { script_type: value } } } });
    }

    if (APPLY && ops.length) {
      const res = await pages.bulkWrite(ops, { ordered: false });
      cp.written += res.modifiedCount;
      cp.raced += ops.length - res.matchedCount; // stamped by a live writer between read and write
      await recordSweepActions(db, Object.entries(bookCounts).map(([book_id, n]) => ({
        sweep: SWEEP, book_id, action: 'script-type-lifted-from-ocr-tag', detail: { pages: n, issue: 4195 },
      })));
    }
    for (const [b, n] of Object.entries(bookCounts)) cp.books[b] = (cp.books[b] || 0) + n;

    cp.matched += docs.length;
    scannedThisRun += docs.length;
    cp.last_id = String(docs[docs.length - 1]._id);
    saveCheckpoint(cp);
    if (scannedThisRun % 50000 < CHUNK) {
      const rate = Math.round(scannedThisRun / ((Date.now() - started) / 1000));
      console.log(`  [${phase}] matched ${cp.matched} (${rate}/s) · lift ${JSON.stringify(cp.by_value)} · invalid ${cp.invalid}${APPLY ? ` · written ${cp.written} · raced ${cp.raced}` : ''}`);
    }
    if (LIMIT && scannedThisRun >= LIMIT) break;
  }
} finally {
  await client.close();
}

const liftable = Object.values(cp.by_value).reduce((a, b) => a + b, 0);
console.log('\n=== summary ===');
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  complete: cp.phase >= PHASES.length,
  pages_with_tag_and_no_script_type: cp.matched,
  liftable, by_value: cp.by_value,
  invalid_tag_value: cp.invalid, invalid_values: cp.invalid_values,
  books: Object.keys(cp.books).length,
  ...(APPLY ? { written: cp.written, raced: cp.raced } : {}),
  checkpoint: CHECKPOINT,
}, null, 2));
