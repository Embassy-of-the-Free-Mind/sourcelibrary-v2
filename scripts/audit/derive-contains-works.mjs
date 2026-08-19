#!/usr/bin/env node
/**
 * What works does a volume actually contain, according to its own running heads?
 *
 * Read-only. Derives and prints; writes nothing. The corpus-wide sweep and the
 * decision to store this are deliberately separate — see the caveats below.
 *
 *   node scripts/audit/derive-contains-works.mjs <bookId> [bookId…]
 *   node scripts/audit/derive-contains-works.mjs --ground-truth
 *
 * `--ground-truth` re-runs the five books whose contents the MCP reporter
 * established by reading the scans (#3652 A), so the detector can be checked
 * against evidence nobody generated for it.
 */
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Dynamic import: a static `.ts` specifier from a `.mjs` module is not resolved
// by tsx's loader. Run this with `npx tsx scripts/audit/derive-contains-works.mjs`.
const { deriveContainedWorks } = await import(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'lib', 'contains-works.ts')
);

const GROUND_TRUTH = [
  ['69937973b0a84a5763964d43', 'genuine Bekker vol.2', 'Metaph, NE, MM, EE, Politics, Rhetoric, Poetics'],
  ['69ae633c5d11d232640c382c', 'catalogued as Bekker vol.2', 'actually the SCHOLIA — commentaries, every head begins ΕΙΣ ("on…")'],
  ['6956953e8c9559f6c2db0b6d', 'titled Rhetoric/Poetic/NE', 'actually only the Nicomachean Ethics'],
  ['69b220b356715b0e324732e1', 'titled Metaphysica (Aldine)', 'actually Ethics + Politics'],
  ['69b21bc3429e087c6f863493', 'titled Vol.5 Rhet/Poet/Pol', 'actually Problems, Mechanics, Metaphysics'],
];

const args = process.argv.slice(2);
const useTruth = args.includes('--ground-truth');
const ids = useTruth ? GROUND_TRUTH.map((g) => g[0]) : args.filter((a) => !a.startsWith('--'));
if (!ids.length) { console.error('give a bookId, or --ground-truth'); process.exit(1); }

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const c = new MongoClient(uri); await c.connect();
const db = c.db('bookstore');

for (const id of ids) {
  const book = await db.collection('books').findOne({ id }, { projection: { title: 1, author: 1, pages_count: 1, language: 1 } });
  const pages = await db.collection('pages')
    .find({ book_id: id }, { projection: { page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();

  const headers = [];
  for (const p of pages) {
    const h = p.ocr?.data?.match(/<header>\s*([^<]{0,80}?)\s*<\/header>/)?.[1];
    if (h) headers.push([p.page_number, h.trim()]);
  }

  const works = deriveContainedWorks(headers, { author: book?.author || '' });
  const truth = GROUND_TRUTH.find((g) => g[0] === id);

  console.log(`\n═══ ${(book?.title || id).slice(0, 60)}`);
  console.log(`    ${pages.length} pages, ${headers.length} with a running head (${Math.round((100 * headers.length) / (pages.length || 1))}%)`);
  if (truth) console.log(`    established by reading the scans: ${truth[2]}`);
  if (headers.length < pages.length * 0.3) {
    console.log('    TOO FEW HEADS to judge — this book cannot be assessed this way.');
    continue;
  }
  console.log(`    derived ${works.length} contained work(s):`);
  for (const w of works) {
    console.log(`      pp.${String(w.first_page).padStart(4)}-${String(w.last_page).padStart(4)}  ${String(w.page_count).padStart(4)}pp  density ${String(w.density).padEnd(5)}  ${w.header.slice(0, 46)}`);
  }
}

console.log(`
CAVEATS, so nothing here is over-read:
  • These are HEADS, not resolved works. "ΤΩΝ ΜΕΤΑ ΤΑ ΦΥΣΙΚΑ" is evidence a
    reader or a model can act on; mapping it to a canonical work id is the
    separate problem in #3661.
  • Low density means interleaved, not wrong — a head sharing its span with
    another usually means the two alternate across the opening.
  • A book whose scans carry no running heads cannot be judged this way at all,
    and silence here is not evidence of absence.`);
await c.close();
