#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/restore-withheld-translation.mjs — restores a
 * translation from page_revisions, but for the #4523 withhold (source
 * `withhold-stale-translation-4523`, marker `translation_withheld`), not for a
 * health-gate refusal. The write itself goes through writePageTranslation
 * (scripts/lib/translate-core.mjs), the shared door with the human-edit guard.
 *
 * Puts back translations the health gate refused only because of #5105.
 *
 * `bodyLen` stripped `<[^>]+>` before the `->|<-` centring markers, so a page
 * opening with a centred heading measured a fraction of its length and was
 * refused as `collapsed`. The refused text is kept in page_revisions
 * (source `health-gate-refused`, #3826). It is the production model's own
 * output, so restoring it costs nothing and loses nothing a retranslation
 * would give.
 *
 * A page is restored only when ALL hold:
 *   - its newest `collapsed` refusal passes the FIXED health gate (full
 *     assessTranslationHealth, so a runaway is still refused);
 *   - the refusal was not truncated;
 *   - the page still has no translation and is stamped `health_blocked: collapsed`;
 *   - its OCR has not changed since the refusal (else the text translates an
 *     older transcription);
 *   - the book is not pipeline-held.
 *
 * The write clears `health_blocked` (the translation object is replaced
 * whole), records `restored_from_revision` on the translation, pushes the
 * page to Supabase, and recomputes the book's counters.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/restore-refused-translations-5105.mjs          # dry run
 *   node --env-file=.env.production.local scripts/maintenance/restore-refused-translations-5105.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { assessTranslationHealth, writePageTranslation, syncBookTranslationCounters } from '../lib/translate-core.mjs';
import { isHeld } from '../lib/pipeline-hold.mjs';
import { syncPageUpdate } from '../workers/lib/supabase-page-writer.mjs';

const APPLY = process.argv.includes('--apply');
const NOTE = 'restore-refused-5105';

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

const refusals = await db.collection('page_revisions')
  .find({ source: 'health-gate-refused', reason: 'collapsed' })
  .sort({ created_at: -1 })
  .toArray();
const newest = new Map();
for (const r of refusals) if (!newest.has(r.page_id)) newest.set(r.page_id, r);

const pages = await db.collection('pages')
  .find({ id: { $in: [...newest.keys()] } })
  .project({ id: 1, book_id: 1, page_number: 1, ocr: 1, 'translation.data': 1, 'translation.health_blocked': 1 })
  .toArray();
const bookIds = [...new Set(pages.map((p) => p.book_id))];
const books = new Map((await db.collection('books')
  .find({ id: { $in: bookIds } })
  .project({ id: 1, title: 1, pipeline_auto: 1, language: 1 })
  .toArray()).map((b) => [b.id, b]));

const tally = { still_fails: 0, truncated: 0, has_translation: 0, not_stamped: 0, ocr_changed: 0, held: 0, no_book: 0, eligible: 0, written: 0, protected: 0 };
const touchedBooks = new Set();
for (const page of pages) {
  const r = newest.get(page.id);
  if (r.truncated) { tally.truncated++; continue; }
  if (!assessTranslationHealth(page.ocr?.data, r.data).healthy) { tally.still_fails++; continue; }
  if ((page.translation?.data || '').trim()) { tally.has_translation++; continue; }
  if (page.translation?.health_blocked !== 'collapsed') { tally.not_stamped++; continue; }
  const ocrAt = page.ocr?.updated_at ? new Date(page.ocr.updated_at) : null;
  if (!ocrAt || ocrAt > new Date(r.created_at)) { tally.ocr_changed++; continue; }
  const book = books.get(page.book_id);
  if (!book) { tally.no_book++; continue; }
  if (isHeld(book)) { tally.held++; continue; }
  tally.eligible++;

  const label = `${page.book_id} p${page.page_number} (${(book.title || '').slice(0, 40)})`;
  if (!APPLY) { console.log(`would restore ${label}: ${JSON.stringify(r.data.slice(0, 60))}`); continue; }

  const res = await writePageTranslation(db, { page, book, text: r.data, model: r.model, jobId: r.job_id, note: NOTE, refuseUnhealthy: true });
  if (res.protected) { tally.protected++; continue; }
  if (!res.written) { console.log(`refused on write ${label}: ${res.reason}`); continue; }
  await db.collection('pages').updateOne({ id: page.id }, { $set: { 'translation.restored_from_revision': r.id, 'translation.restored_by': NOTE } });
  const fresh = await db.collection('pages').findOne({ id: page.id }, { projection: { translation: 1, updated_at: 1 } });
  syncPageUpdate(page.id, { translation: fresh.translation, updated_at: fresh.updated_at });
  touchedBooks.add(page.book_id);
  tally.written++;
  console.log(`restored ${label}`);
}

for (const bookId of touchedBooks) await syncBookTranslationCounters(db, bookId);

console.log(`\nrefusals ${refusals.length}, pages ${pages.length}`);
console.log(JSON.stringify(tally));
console.log(APPLY ? `books recounted: ${touchedBooks.size}` : 'dry run: pass --apply to write');
// syncPageUpdate is fire-and-forget; give it a moment before closing.
if (APPLY) await new Promise((res) => setTimeout(res, 5000));
await mongo.close();
