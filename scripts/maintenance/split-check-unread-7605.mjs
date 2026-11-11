#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/flag-spread-books-7605.mjs — sets needs_splitting from the agy census on books the AR
// screen picked as spread-shaped; it never sets split_checked. scripts/maintenance/backfill-split-check.mjs — sets
// split_checked from a 5-page AR check, for books past archive_complete only (these are held, never reach it), with no
// look at the image and no revert. Pipeline Phase 1.25 is the same check for books the pipeline owns; it never runs on
// a held book. Nothing marked held, published-as-scans books as looked at.
/**
 * Mark held, unread German/French books as split-checked after a by-eye screen, or flag the spreads among them (#7605).
 *
 * WHY. The agy first-read lane (scripts/batch/cli-ocr-lane.mjs, cohort visible-unread) skips a book whose unread
 * pages carry no crop data while `pipeline_auto.split_checked` is unset (spreadReason(), #523): it may be a book of
 * two-page spreads, and the lane reads with the plain one-page prompt. Phase 1.25 sets that flag, but only on books
 * the pipeline owns; these books are held (published as scans), so it never ran. On 2026-10-30, 2,833 of the lane's
 * 4,042 deu/fra books waited on it, nearly all e-rara and MDZ/BSB scans of one page per image.
 *
 * THE SCREEN (job split-unread-7605, scratch on gex45). One contact-sheet row per book: pages at 25/50/75% and the
 * book's widest page when any is wider than 1.2 (Phase 1.25's threshold; from the stored image_width/height, or 12
 * thumbnails when they are missing). Ten books a sheet, Opus one sheet per call, asked per image: one page, or two
 * facing pages. Control (10 books from the 2026-10-29 census): it agreed with a by-eye reading on every row.
 * The verdict files are DIR/index.json (sheet → rows → book_id, pages shown) and DIR/screen-NNN.verdict.json
 * ({"B1": {"two_page": [p…], "unclear": [p…]}, …}).
 *
 *   node --env-file=.env.production.local scripts/maintenance/split-check-unread-7605.mjs --screen DIR [--apply]
 *        Rows where every shown image is one page → pipeline_auto.split_checked: true.
 *   ... --screen DIR --flag-two-page [--apply]
 *        Rows with a two-page image → needs_splitting: true, only while the book has no OCR on any page, so the
 *        split-before-read guard holds it and split-spreads-agy.mjs (propose --sheets → judge → apply) can split it.
 *   ... --revert [--apply]
 *        Undoes both, for exactly the books this sweep changed and only while they are still unsplit.
 *
 * Dry run unless --apply. Each change writes a sweep_log row (sweep 'split-check-unread-7605').
 * ACTUATION: split_checked lets the hourly first-read cron read the book at its next run (agy subscription quota, no
 * paid API). needs_splitting removes it from every OCR/translation lane until it is split. Nothing is deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const FLAG = args.includes('--flag-two-page');
const SCREEN = arg('--screen', null);
const SWEEP = 'split-check-unread-7605';
const CROPPED = { $or: [{ crop: { $exists: true, $ne: null } }, { cropped_photo: { $exists: true, $nin: [null, ''] } }, { split_from_spread: { $exists: true } }] };

/** The judge's answer for one sheet: {B1: {two_page, unclear}, …}, or null when it is not JSON. */
export function parseVerdict(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** One row's screen result: 'single' (every shown image one page), 'two-page', or 'unread' (no clean answer). */
export function rowResult(row, v) {
  if (!v || row.error || !row.shown?.length || row.shown.length < Math.min(3, row.pages || 0)) return 'unread';
  if (!Array.isArray(v.two_page) || !Array.isArray(v.unclear)) return 'unread';
  if (v.two_page.length) return 'two-page';
  return v.unclear.length ? 'unread' : 'single';
}

/** Every screened book with its result, from DIR/index.json and the sheets' verdict files. */
export function readScreen(dir) {
  const out = [];
  for (const s of JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))) {
    const f = path.join(dir, s.sheet.replace(/\.jpg$/, '.verdict.json'));
    const v = fs.existsSync(f) ? parseVerdict(fs.readFileSync(f, 'utf8')) : null;
    for (const r of s.rows) out.push({ ...r, sheet: s.sheet, verdict: v?.[r.tag] ?? null, result: rowResult(r, v?.[r.tag]) });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await withMongo(async (db) => {
    if (REVERT) {
      const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: { $in: ['split-checked', 'flagged-needs-splitting'] } }).toArray();
      const checked = [...new Set(rows.filter((r) => r.action === 'split-checked').map((r) => r.book_id))];
      const flagged = [...new Set(rows.filter((r) => r.action === 'flagged-needs-splitting').map((r) => r.book_id))];
      console.log(`${checked.length} split_checked and ${flagged.length} needs_splitting to undo${APPLY ? '' : ' (dry run)'}`);
      if (!APPLY) return;
      const split = new Set(await db.collection('pages').distinct('book_id', { book_id: { $in: [...checked, ...flagged] }, ...CROPPED }));
      const a = await db.collection('books').updateMany({ id: { $in: checked.filter((id) => !split.has(id)) } }, { $unset: { 'pipeline_auto.split_checked': '' } });
      const b = await db.collection('books').updateMany({ id: { $in: flagged.filter((id) => !split.has(id)) }, split_completed: { $ne: true } }, { $set: { needs_splitting: false } });
      await recordSweepActions(db, [...checked, ...flagged].filter((id) => !split.has(id)).map((book_id) => ({ sweep: SWEEP, book_id, action: 'reverted' })));
      console.log(`unset split_checked on ${a.modifiedCount}, cleared needs_splitting on ${b.modifiedCount}; ${split.size} already split: left`);
      return;
    }
    if (!SCREEN) { console.error('--screen DIR is required'); process.exit(2); }
    const rows = readScreen(SCREEN);
    const t = {}; for (const r of rows) t[r.result] = (t[r.result] || 0) + 1;
    console.log(`screen: ${rows.length} books ${JSON.stringify(t)}`);
    const want = FLAG ? 'two-page' : 'single';
    const ids = rows.filter((r) => r.result === want).map((r) => r.book_id);
    // The filter re-asserts the state the screen saw: unflagged, unsplit, not split_checked, no crop data on any page.
    const split = new Set(await db.collection('pages').distinct('book_id', { book_id: { $in: ids }, ...CROPPED }));
    const withOcr = FLAG ? new Set(await db.collection('pages').distinct('book_id', { book_id: { $in: ids }, 'ocr.data': { $type: 'string', $ne: '' } })) : new Set();
    const go = ids.filter((id) => !split.has(id) && !withOcr.has(id));
    const sel = { id: { $in: go }, needs_splitting: { $ne: true }, split_completed: { $ne: true }, 'pipeline_auto.split_checked': { $ne: true } };
    const before = (await db.collection('books').find(sel, { projection: { id: 1 } }).toArray()).map((b) => b.id);
    console.log(`${want}: ${ids.length} books; ${split.size} carry crop data, ${withOcr.size} have OCR: skipped; ${before.length} to write${APPLY ? '' : ' (dry run)'}`);
    if (!APPLY) return;
    const r = await db.collection('books').updateMany({ ...sel, id: { $in: before } }, { $set: FLAG ? { needs_splitting: true } : { 'pipeline_auto.split_checked': true } });
    const byId = new Map(rows.map((x) => [x.book_id, x]));
    await recordSweepActions(db, before.map((book_id) => ({ sweep: SWEEP, book_id, action: FLAG ? 'flagged-needs-splitting' : 'split-checked', detail: { sheet: byId.get(book_id).sheet, shown: byId.get(book_id).shown, verdict: byId.get(book_id).verdict, judge: byId.get(book_id).verdict?.by_eye ?? 'claude-opus-5-5, one sheet per call' } })));
    console.log(`wrote ${r.modifiedCount}; ${before.length} sweep_log rows`);
  });
}
