#!/usr/bin/env node
// PRIOR ART: scripts/eval/g4-reread-pilot-6769/plan.mjs (the pilot's per-book plan: counts, trust gate, gap-fill
// eligibility; read-only, for the whole shelf). This is the driver's per-book step helper: the page list a re-read
// starts from and the check that decides whether the hold may be released. scripts/lib/page-counts.mjs `recountBook`
// is the one counter writer; scripts/lib/translate-core.mjs `isTranslatablePage` is what every translate lane asks.
/**
 * #6769 phase B helper, one book at a time (driver.sh calls it).
 *
 *   node --env-file=… book.mjs pages  --book=ID --out=FILE
 *        Writes the page ids to re-read, in page order: every page with a usable image, except fitted open-edition text
 *        (never overwritten) and human-edited pages. Prints a JSON line of counts. Reads only.
 *
 *   node --env-file=… book.mjs verify --book=ID --written=APPLY_SUMMARY.json --out=FILE
 *        Recounts the book (recountBook, the one counter writer), then checks every rewritten page: a page the
 *        translate lanes would translate must carry English written AFTER its new OCR and no stale marker. Exit 0 when
 *        every such page is fresh (the hold may be released), 1 when not. Also reports the hold, the status it restores,
 *        and whether gap-fill would select the book once released.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { fittedTextReason } from '../../lib/reread-lane-gate.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { recountBook } from '../../lib/page-counts.mjs';

const STAGE = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const BOOK = arg('book'), OUT = arg('out');
if (!['pages', 'verify'].includes(STAGE) || !BOOK || !OUT) { console.error('usage: book.mjs pages|verify --book=ID --out=FILE (see header)'); process.exit(2); }
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const GAP_FILL_STATUSES = ['translate_partial', 'translate_complete', 'chapters_complete', 'complete'];

if (STAGE === 'pages') {
  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.text_source': 1, 'ocr.text_edition': 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const c = { book_id: BOOK, pages: pages.length, fitted: 0, human_edited: 0, no_image: 0, with_text: 0, empty: 0, to_read: 0 };
  const ids = [];
  for (const p of pages) {
    if (fittedTextReason(p.ocr)) { c.fitted++; continue; }
    if (p.ocr?.edited_by || p.ocr?.source === 'manual') { c.human_edited++; continue; }
    if (!getPageSource(p)) { c.no_image++; continue; }
    p.ocr?.data?.trim() ? c.with_text++ : c.empty++;
    ids.push(p.id);
  }
  c.to_read = ids.length;
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { pipeline_auto: 1, title: 1 } });
  Object.assign(c, { status: book?.pipeline_auto?.status ?? null, hold_reason: book?.pipeline_auto?.hold?.reason ?? null });
  fs.writeFileSync(OUT, JSON.stringify(ids));
  console.log(JSON.stringify(c));
} else {
  const summary = JSON.parse(fs.readFileSync(arg('written'), 'utf8'));
  const ids = summary.written_page_ids || [];
  await recountBook(db, BOOK, { reason: 'g4-reread-6769' });
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, page_number: 1, page_type: 1, ocr: 1, 'translation.updated_at': 1, 'translation.data': 1, translation_stale: 1, translation_withheld: 1 } }).toArray();
  const r = { book_id: BOOK, written: ids.length, found: pages.length, fresh: 0, not_translatable: 0, not_translatable_with_old_english: [], stale: [] };
  for (const p of pages.sort((a, b) => a.page_number - b.page_number)) {
    const t = isTranslatablePage(p);
    if (!t.ok) {
      r.not_translatable++;
      // A bracketed placeholder ("[Blank page — no translatable content]") is not English made from the old text.
      const placeholder = /^\[[^\]]{0,120}\]$/.test(String(p.translation?.data || '').trim());
      if (p.translation?.data && !placeholder && new Date(p.translation.updated_at) < new Date(p.ocr?.updated_at)) r.not_translatable_with_old_english.push(p.page_number);
      continue;
    }
    const fresh = p.translation?.data && new Date(p.translation.updated_at) > new Date(p.ocr.updated_at) && !p.translation_stale;
    if (fresh) r.fresh++; else { r.stale.push(p.page_number); (r.stale_ids ??= []).push(p.id); }
  }
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { pipeline_auto: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_count: 1 } });
  const h = book?.pipeline_auto?.hold;
  const restore = h?.held_from_status ?? null;
  const bar = 0.9 * ((book?.pages_ocr ?? 0) - (book?.pages_blank ?? 0));
  Object.assign(r, {
    counts: { pages: book?.pages_count, ocr: book?.pages_ocr, translated: book?.pages_translated, blank: book?.pages_blank },
    status: book?.pipeline_auto?.status ?? null, hold_reason: h?.reason ?? null, restores_to: restore,
    gap_fill_after_release: GAP_FILL_STATUSES.includes(restore) && (book?.pages_translated ?? 0) < bar,
  });
  r.release_ok = r.found === r.written && r.stale.length === 0 && r.not_translatable_with_old_english.length === 0;
  fs.writeFileSync(OUT, JSON.stringify(r, null, 1));
  console.log(JSON.stringify({ ...r, stale: r.stale.length, not_translatable_with_old_english: r.not_translatable_with_old_english.length }));
  await client.close();
  process.exit(r.release_ok ? 0 : 1);
}
await client.close();
