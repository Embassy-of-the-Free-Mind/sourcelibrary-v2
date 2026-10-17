#!/usr/bin/env node
/**
 * set-blank-leaves-by-eye — mark named pages of ONE book as blank leaves, after a reader of the page image has seen
 * that the leaf is blank and the stored OCR is invented (e.g. the blank backs of plates, #6783). This is the REPAIR
 * that follows containment (`.claude/docs/invariants/containment-on-finding.md`): the book is held and the
 * translations already withheld; this replaces the invented OCR with the pipeline's own blank-page shape.
 *
 * Writes, per page: `page_type: 'blank'`; `ocr` = { data: "<language>…</language>\n<page-type>blank</page-type>\n<meta>…</meta>",
 * source: 'ai', model (who judged the image), prompt_version: 'by-eye-blank-leaf', evidence, issue, content_hash,
 * updated_at }; `translation` = the pipeline's system blank ("[Blank page — no translatable content]", source 'system').
 * Before writing: `page_revisions` snapshots of `ocr` (keepMeta) and `translation`, and a `sweep_log` row per page.
 * Refuses a page whose OCR or translation was written by a person (`edited_by` set, or source 'manual').
 * Afterwards: the book's page counters resync (same pipeline as recount-page-stats.mjs) and the Supabase pages mirror
 * is re-synced. Undo: restore the page from its `page_revisions` rows.
 *
 * PRIOR ART: scripts/maintenance/withhold-stale-translations.mjs — the containment step (snapshot, sweep_log, counter
 * and mirror resync are copied from it); it withholds a translation and leaves the OCR, which is the invented half here.
 * scripts/maintenance/fix-blank-featured-images.mjs is about featured images, not page text.
 *
 *   node --env-file=.env.production.local scripts/maintenance/set-blank-leaves-by-eye.mjs --book=<id> --pages=49,75 \
 *        --evidence="what the image shows and how it was viewed" --issue=N --model=<who judged> [--apply]
 */
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';

const ARG = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const APPLY = process.argv.includes('--apply');
const BOOK = ARG('--book'), EVIDENCE = ARG('--evidence'), ISSUE = Number(ARG('--issue', '0')) || null, MODEL = ARG('--model');
const PAGES = (ARG('--pages', '') || '').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
if (!BOOK || !PAGES.length || !EVIDENCE || !ISSUE || !MODEL) {
  console.error('needs --book, --pages=1,2,3, --evidence="…", --issue=N and --model=<who judged the image>'); process.exit(2);
}
const SWEEP = `set-blank-leaves-by-eye-${ISSUE}`;
const BLANK_TRANSLATION = '[Blank page — no translatable content]';

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const book = await db.collection('books').findOne({ $or: [{ id: BOOK }, { _id: BOOK }] }, { projection: { id: 1, language: 1, pipeline_hold: 1, held: 1 } });
if (!book) { console.error(`book ${BOOK} not found`); process.exit(1); }
const bookId = book.id || String(book._id);
const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $in: PAGES } },
  { projection: { id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } }).toArray();

const T = { book: bookId, asked: PAGES.length, found: pages.length, refused_human: [], to_write: [], written: 0, apply: APPLY };
for (const p of pages) {
  const human = (o) => o && (o.edited_by || o.source === 'manual');
  if (human(p.ocr) || human(p.translation)) { T.refused_human.push(p.page_number); continue; }
  T.to_write.push(p);
}
const missing = PAGES.filter((n) => !pages.some((p) => p.page_number === n));
console.log(JSON.stringify({ ...T, to_write: T.to_write.map((p) => p.page_number), missing }));
if (!APPLY) { console.log('dry run — nothing written; add --apply'); await client.close(); process.exit(0); }

const lang = book.language || 'Unknown';
const ids = T.to_write.map((p) => p.id);
await saveRevisionsBeforeOverwrite(db, ids, 'ocr', { reason: SWEEP, keepMeta: true });
await saveRevisionsBeforeOverwrite(db, ids, 'translation', { reason: SWEEP, keepMeta: true });
const now = new Date();
for (const p of T.to_write) {
  const data = `<language>${lang}</language>\n<page-type>blank</page-type>\n<meta>Blank leaf: ${EVIDENCE} (#${ISSUE}).</meta>`;
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'set-blank-leaf',
    detail: { page: p.page_number, previous_page_type: p.page_type ?? null, previous_ocr_chars: (p.ocr?.data || '').length, previous_ocr_model: p.ocr?.model ?? null, evidence: EVIDENCE, issue: ISSUE } });
  const res = await db.collection('pages').updateOne({ id: p.id, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, { $set: {
    page_type: 'blank',
    ocr: { data, language: lang, source: 'ai', model: MODEL, prompt_version: 'by-eye-blank-leaf', evidence: EVIDENCE, issue: ISSUE, content_hash: contentHash(data), updated_at: now },
    translation: { data: BLANK_TRANSLATION, language: 'English', source: 'system', content_hash: contentHash(BLANK_TRANSLATION), updated_at: now },
    updated_at: now,
  } });
  T.written += res.modifiedCount;
}
// one definition of the counters (recount-page-stats.mjs uses the same pipeline)
const [counts] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
if (counts) await db.collection('books').updateOne({ $or: [{ id: bookId }, { _id: bookId }] }, { $set: {
  pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation, pages_translatable: counts.translatable, updated_at: now } });
await client.close();
try { execFileSync(process.execPath, ['scripts/workers/sync-pages-content.mjs', `--book=${bookId}`], { stdio: 'pipe', timeout: 300000, env: process.env }); T.mirror = 'synced'; }
catch (e) { T.mirror = 'FAILED: ' + String(e.message).slice(0, 160); }
console.log(JSON.stringify({ written: T.written, of: T.to_write.length, refused_human: T.refused_human, missing, mirror: T.mirror, counts }));
