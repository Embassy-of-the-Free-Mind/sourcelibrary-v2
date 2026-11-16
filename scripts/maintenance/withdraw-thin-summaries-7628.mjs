#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/remove-straggler-summaries.mjs — clears the summary but stashes the old
// value in a new `summary_removed` COLUMN on books (field-sprawl.md) and leaves index and chapters; this
// one keeps the undo out of the row (revert file + book_revisions + sweep_log) and withdraws all three.
// scripts/maintenance/repair-6660-stale-summaries.mjs — repairs stale text, does not withdraw.
/**
 * Withdraw the book summary, index and chapters from visible books whose published summary rests on
 * less than 90% of the book (v2#7628, decision row "3,455 published book summaries", 2026-11-13).
 *
 * WHO READS THIS: a reader on /book/<id> sees "About this book", the index and the chapter list as a
 * description of the whole book. On these books it was written from a fraction of it (a 431-page book
 * summarised from one English page). PR #7934 stopped the lane writing more; this removes what it wrote.
 * The fixed lane (gapFilter → READABLE_ENOUGH_TO_ENRICH) re-derives each one when its book reaches
 * `readable`, because a withdrawn book again has `summary: null` / `index.generatedAt: null`.
 *
 * SELECTION (the issue's own rule): visible, `translation_state.english_original` not true,
 * `translation_state.rung` below `readable` (no_pages, no_text, transcribing, transcribed, translating),
 * and a published summary (`summary.data` non-empty). Buckets by translated / translatable.
 *
 * WHAT A WITHDRAWAL WRITES, per book:
 *   books:        $unset summary, reading_summary, index, chapters, chapters_extracted_at
 *                 — skipped for chapters whose provenance is not AI (a human or a TOC import), see keepChapters()
 *   book_indexes: the book's doc is removed (it is the derived index; the full doc is in the revert file)
 *   book_revisions: a snapshot of summary / reading_summary / index / chapters (the lane's own undo)
 *   sweep_log:    one row per book, sweep `withdraw-thin-summaries-7628`
 * Before any write, the full before-values are appended to the revert file (jsonl, fsynced per line).
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 *
 * Usage (from a checkout, with prod env):
 *   node --env-file=.env.production.local scripts/maintenance/withdraw-thin-summaries-7628.mjs
 *       dry run: counts by rung and by share, and a diff file (--diff=<path.jsonl>)
 *   … --only=zero|lt5|p5_25|p25_90   restrict to one share bucket (the alternative: --only=lt5 plus zero)
 *   … --limit=N                      first N books (pilot)
 *   … --apply --revert-file=<path.jsonl>   withdraw, then evict the books' cached pages
 *   … --revert=<path.jsonl> [--apply]      put every field back exactly as it was (dry run without --apply)
 */
import { MongoClient } from 'mongodb';
import { openSync, writeSync, fsyncSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createBookRevisions } from '../workers/lib/book-revisions.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { revalidateBookPages } from '../lib/revalidate.mjs';
import { EJSON } from 'bson';

const ARGS = process.argv.slice(2);
const arg = (n) => { const a = ARGS.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = ARGS.includes('--apply');
const REVERT = arg('revert');
const REVERT_FILE = arg('revert-file');
const DIFF = arg('diff');
const ONLY = arg('only') ? arg('only').split(',') : null;
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const SWEEP = 'withdraw-thin-summaries-7628';
const ISSUE = 'v2#7628';

const BELOW_READABLE = ['no_pages', 'no_text', 'transcribing', 'transcribed', 'translating'];
const BOOK_FIELDS = ['summary', 'reading_summary', 'index', 'chapters', 'chapters_extracted_at'];

export function shareBucket(ts = {}) {
  const tr = ts.translated || 0;
  const den = ts.translatable || ts.whole || 0;
  if (tr === 0) return 'zero';
  const s = den ? tr / den : 0;
  if (s < 0.05) return 'lt5';
  if (s < 0.25) return 'p5_25';
  if (s < 0.9) return 'p25_90';
  return 'ge90'; // translated share ≥ 90% but coverage (OCR) not met: the rung is still below readable
}

// Chapters typed in by a person, or imported from a printed table of contents, are not the lane's claim.
// Measured 2026-11-13 on the 3,056: 78 carry field_provenance.chapters (agy-enrich-7628); the other 2,631
// have none but every entry has the extractor's `confidence` key and the book has chapters_extracted_at.
// Anything else is kept.
function keepChapters(book) {
  if (!Array.isArray(book.chapters) || book.chapters.length === 0) return false;
  const src = book.field_provenance?.chapters?.source || book.field_provenance?.chapters?.by;
  if (src) return !/^(ai|agy|gemini|enrich|model)/i.test(String(src));
  const extractorShape = book.chapters_extracted_at && book.chapters.every((c) => c && 'confidence' in c);
  return !extractorShape;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const indexes = db.collection('book_indexes');

try {
  if (REVERT) await revert(REVERT);
  else await withdraw();
} finally {
  await client.close();
}

async function withdraw() {
  if (APPLY && !REVERT_FILE) throw new Error('--apply needs --revert-file=<path.jsonl>');
  if (APPLY && existsSync(REVERT_FILE)) throw new Error(`revert file ${REVERT_FILE} exists; refusing to append to an old run`);

  const rows = await books.find({
    visible: true,
    'summary.data': { $type: 'string', $ne: '' },
    'translation_state.english_original': { $ne: true },
    'translation_state.rung': { $in: BELOW_READABLE },
  }, { projection: { id: 1, slug: 1, title: 1, pages_count: 1, translation_state: 1, 'summary.data': 1, field_provenance: 1 } }).toArray();

  const byRung = {}; const byShare = {}; const selected = [];
  for (const r of rows) {
    const b = shareBucket(r.translation_state);
    byRung[r.translation_state.rung] = (byRung[r.translation_state.rung] || 0) + 1;
    byShare[b] = (byShare[b] || 0) + 1;
    if (ONLY && !ONLY.includes(b)) continue;
    if (selected.length < LIMIT) selected.push({ ...r, bucket: b });
  }
  console.log(`visible books with a published summary below readable (not English originals): ${rows.length}`);
  console.log(`by rung:  ${JSON.stringify(byRung)}`);
  console.log(`by share: ${JSON.stringify(byShare)}   (zero = 0 English pages; lt5 < 5%; p5_25; p25_90; ge90 = ≥90% translated, OCR coverage short)`);
  console.log(`selected: ${selected.length}${ONLY ? ` (--only=${ONLY.join(',')})` : ''}`);

  if (DIFF) {
    writeFileSync(DIFF, selected.map((r) => JSON.stringify({
      id: r.id, title: r.title, rung: r.translation_state.rung, bucket: r.bucket,
      translated: r.translation_state.translated, translatable: r.translation_state.translatable ?? r.translation_state.whole,
      before: { summary: String(r.summary?.data || '').slice(0, 120) }, after: 'summary, reading_summary, index, chapters withdrawn',
    })).join('\n') + '\n');
    console.log(`diff: ${DIFF}`);
  }
  if (!APPLY) { console.log('\nDRY RUN. Nothing written. Pass --apply --revert-file=<path.jsonl> to withdraw.'); return; }

  const fd = openSync(REVERT_FILE, 'a');
  let done = 0; let chaptersKept = 0;
  try {
    for (const r of selected) {
      const proj = Object.fromEntries([...BOOK_FIELDS, 'field_provenance', 'id'].map((f) => [f, 1]));
      const cur = await books.findOne({ id: r.id }, { projection: proj });
      if (!cur) { console.log(`  skip ${r.id}: book not found`); continue; }
      const idx = await indexes.findOne({ book_id: r.id });
      const keep = keepChapters(cur);
      const before = Object.fromEntries(BOOK_FIELDS.filter((f) => cur[f] !== undefined).map((f) => [f, cur[f]]));
      writeSync(fd, EJSON.stringify({ id: r.id, slug: r.slug ?? null, books: before, book_indexes: idx, chapters_kept: keep, at: new Date() }, { relaxed: false }) + '\n');
      fsyncSync(fd);

      await createBookRevisions(db, r.id, ['summary', 'reading_summary', 'index', ...(keep ? [] : ['chapters'])], SWEEP);
      const unset = Object.fromEntries(BOOK_FIELDS.filter((f) => !(keep && (f === 'chapters' || f === 'chapters_extracted_at'))).map((f) => [f, '']));
      await books.updateOne({ id: r.id }, { $unset: unset, $set: { updated_at: new Date() } });
      if (idx) await indexes.deleteOne({ _id: idx._id });
      await recordSweepAction(db, {
        sweep: SWEEP, book_id: r.id, action: 'withdrew-thin-summary',
        detail: { issue: ISSUE, rung: r.translation_state.rung, bucket: r.bucket, translated: r.translation_state.translated ?? 0, chapters_kept: keep, revert_file: REVERT_FILE },
      });
      if (keep) chaptersKept++;
      if (++done % 200 === 0) console.log(`  withdrew ${done}/${selected.length}`);
    }
  } finally { closeSync(fd); }

  const left = await books.countDocuments({ id: { $in: selected.map((r) => r.id) }, 'summary.data': { $type: 'string', $ne: '' } });
  console.log(`withdrew ${done}; chapters kept (not AI) on ${chaptersKept}; read back: ${left} of ${selected.length} still carry a summary`);
  console.log(`undo: node --env-file=.env.production.local scripts/maintenance/withdraw-thin-summaries-7628.mjs --revert=${REVERT_FILE} --apply`);
  const ev = await revalidateBookPages(selected.map((r) => ({ id: r.id, slug: r.slug })));
  console.log(`evicted: ${JSON.stringify(ev?.revalidated ?? ev)}`);
}

async function revert(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => EJSON.parse(l, { relaxed: false }));
  console.log(`revert file: ${lines.length} books`);
  if (!APPLY) { console.log('DRY RUN. Pass --apply to restore.'); return; }
  let n = 0;
  for (const l of lines) {
    if (Object.keys(l.books || {}).length) await books.updateOne({ id: l.id }, { $set: l.books });
    if (l.book_indexes) await indexes.replaceOne({ _id: l.book_indexes._id }, l.book_indexes, { upsert: true });
    await recordSweepAction(db, { sweep: SWEEP, book_id: l.id, action: 'restored-thin-summary', detail: { issue: ISSUE, revert_file: path } });
    n++;
  }
  const ev = await revalidateBookPages(lines.map((l) => ({ id: l.id, slug: l.slug })));
  console.log(`restored ${n}; evicted: ${JSON.stringify(ev?.revalidated ?? ev)}`);
}
