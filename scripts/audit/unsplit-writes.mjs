#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/spread-screen.mjs (#6114) finds books that ARE unsplit spreads; it does not look at what
 * was WRITTEN to them. scripts/audit/pipeline-hold-drift.mjs reconciles hold markers, not text. Neither can catch a
 * writer that reads a spread whole, which is the failure here.
 *
 * unsplit-writes — has any OCR or translation been written onto an unsplit spread book? (#7605)
 *
 * WHY. The rule is split before read: a book with `needs_splitting` and no `split_completed` serves two leaves (or a
 * pecha frame of several) per page image, and no lane may read it. The guard sits at dispatch in the lanes we know
 * (pipeline-hold.mjs UNSPLIT_SPREAD / unsplitReadRefusal), but 26 code paths write page text and a guard only
 * protects the ones it is in. This is the read-side check: it does not care which writer did it.
 * Measured 2026-10-28, before the guard: 4,837 OCR pages and 177 translations in 14 days, from five writers.
 *
 * WHAT IT COUNTS. Pages of unsplit spread books whose `ocr.updated_at` or `translation.updated_at` falls in the
 * window, minus pages that are already leaves (cut from a spread, or cropped). Grouped by field, model and call site.
 *
 * Usage (read-only):
 *   node --env-file=.env.production.local scripts/audit/unsplit-writes.mjs [--hours 26] [--ntfy]
 * Exit 0 = no writes in the window, 1 = writes found (listed), 2 = the check could not run.
 * --ntfy pages the phone channel when writes are found. POSITIVE CONTROL: --hours 336 on 2026-10-28 reported
 * the 4,837 + 177 above; a window that reaches before the guard must report non-zero.
 */
import { withMongo } from '../lib/mongo.mjs';
import { UNSPLIT_SPREAD } from '../lib/pipeline-hold.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';
import { NTFY_TOPIC } from '../lib/quality-gate.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const HOURS = Number(arg('--hours', 26)); // a daily cron with two hours of overlap
const since = new Date(Date.now() - HOURS * 3600e3);
const LEAF = { split_from_spread: { $exists: false }, split_from_pecha: { $exists: false }, cropped_photo: { $in: [null, ''] }, crop: { $exists: false } };

let found;
try {
  await withMongo(async (db) => { // withMongo returns nothing: the result is assigned inside
    const books = await db.collection('books').find(UNSPLIT_SPREAD, { projection: { id: 1, title: 1 } }).toArray();
    const ids = books.map((b) => b.id);
    const titles = new Map(books.map((b) => [b.id, b.title]));
    const out = { books: ids.length, rows: [] };
    for (const f of ['ocr', 'translation']) {
      const rows = await db.collection('pages').aggregate([
        { $match: { book_id: { $in: ids }, [`${f}.updated_at`]: { $gte: since }, ...LEAF } },
        { $group: { _id: { model: `$${f}.model`, call_site: { $ifNull: [`$${f}.provenance.engine.call_site`, `$${f}.source`] } }, pages: { $sum: 1 }, books: { $addToSet: '$book_id' } } },
        { $sort: { pages: -1 } },
      ], { maxTimeMS: 120000 }).toArray();
      for (const r of rows) out.rows.push({ field: f, model: r._id.model ?? null, call_site: r._id.call_site ?? null, pages: r.pages, books: r.books.length, sample: r.books.slice(0, 3).map((id) => `${id} ${String(titles.get(id) || '').slice(0, 40)}`) });
    }
    found = out;
  }, { timeoutMs: 300000 });
  if (!found) throw new Error('no result');
} catch (e) {
  console.error(`unsplit-writes: could not run: ${e.message}`);
  process.exit(2);
}

const total = found.rows.reduce((s, r) => s + r.pages, 0);
console.log(`unsplit spread books: ${found.books}; window ${HOURS} h since ${since.toISOString()}`);
if (!total) { console.log('CLEAR: no OCR or translation written onto an unsplit spread book in the window'); process.exit(0); }
for (const r of found.rows) console.log(`  ${r.field.padEnd(11)} ${String(r.pages).padStart(6)} pages ${String(r.books).padStart(4)} books  ${r.model} | ${r.call_site}  e.g. ${r.sample[0]}`);
if (args.includes('--ntfy')) {
  const lines = found.rows.slice(0, 6).map((r) => `${r.field} ${r.pages}p/${r.books}b ${r.model} (${r.call_site})`).join('\n');
  await ntfyPost(NTFY_TOPIC, { headers: { Title: `Unsplit spreads were read: ${total} pages in ${HOURS} h (#7605)`, Priority: 'default', Tags: 'warning' }, body: `${lines}\nRule: split before OCR/translation. Run scripts/audit/unsplit-writes.mjs for the list.` }).catch(() => {});
}
process.exit(1);
