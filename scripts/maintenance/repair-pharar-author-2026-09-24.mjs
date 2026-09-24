#!/usr/bin/env node
/**
 * One book, adjudicated BY HAND from its own title page: the 1627 Amsterdam
 * *Declaração das 613 encomendanças* is catalogued under "Isaac Pharar", but
 * its title page (page 3) reads "Por industria, e despeza, de Abraham Pharar,
 * Judeu do desterro de Portugal". A reader (Yaacov Amar Rothstein, BGU)
 * reported it through the footer widget (Feedback-ID 6aad068c9f2dfd8edd8fc07c).
 *
 * PRIOR ART: scripts/maintenance/repair-hand-adjudicated-authors-2026-08-18.mjs
 * — same shape (book-keyed hand repair, backup, provenance, sweep_log), but it
 * writes `books.author` only and matches on the old string. Here the thesaurus
 * doc itself names the wrong person, so the book must move to a new doc and the
 * old doc must forward its URL.
 *
 * Writes:
 *   books            author, display_title, author_id  (keyed on book id AND the old author)
 *   authors          mint `abraham-pharar` (additive); tombstone `isaac-pharar`
 *                    with `merged_into` so /author/isaac-pharar follows it.
 *                    `isaac-pharar` is kept, never deleted, and "Isaac Pharar"
 *                    is NOT added to the new doc's `variants` — variants are a
 *                    match surface and would pull in any genuine Isaac Pharar.
 *   books_catalog    (Supabase) author mirror
 *   field_provenance + sweep_log rows
 * The book slug (`isaac-pharar-…`) is left alone: changing it breaks links.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-pharar-author-2026-09-24.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-pharar-author-2026-09-24.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/repair-pharar-author-2026-09-24.mjs --revert --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(HERE, 'backups', 'repair-pharar-author-2026-09-24.json');
const RUN = 'repair-pharar-author-2026-09-24';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const BOOK_ID = '69b4cd33d5b6c3815e1a4dc4';
const FROM = { author: 'Isaac Pharar', author_id: 'isaac-pharar' };
const TO = { author: 'Abraham Pharar', author_id: 'abraham-pharar' };
const WHY = 'title page (p. 3) reads "Por industria, e despeza, de Abraham Pharar"; reader report 6aad068c9f2dfd8edd8fc07c';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function supabaseSet(id, author) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'no creds' };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ author, updated_at: new Date().toISOString() }),
  });
  const b = await res.json().catch(() => null);
  return { ok: res.ok, rows: Array.isArray(b) ? b.length : 0 };
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

if (REVERT) {
  if (!existsSync(BACKUP)) { console.error('no backup'); process.exit(1); }
  const { before } = JSON.parse(readFileSync(BACKUP, 'utf8'));
  if (!APPLY) { console.log('would revert book + tombstone (add --apply)'); await mc.close(); process.exit(0); }
  const r = await books.updateOne({ id: BOOK_ID, author: TO.author },
    { $set: { author: before.author, author_id: before.author_id, display_title: before.display_title, updated_at: new Date() } });
  await authors.updateOne({ _id: FROM.author_id }, { $unset: { merged_into: '' } });
  await supabaseSet(BOOK_ID, before.author);
  console.log(`reverted book: ${r.modifiedCount} (the minted abraham-pharar doc is left in place; it is inert without books)`);
  await mc.close(); process.exit(0);
}

// Derived lane (derived-metadata-lane.md): the summaries, index and titles were
// generated from the wrong byline and repeat it to readers. Rewrite the SERVED
// fields; leave translation_verification and summary_candidate.replaced alone —
// they are provenance of what was believed at the time.
const DERIVED = ['english_title', 'work_title', 'summary.data', 'summary_candidate.brief', 'summary_candidate.abstract',
  'reading_summary.overview', 'index.bookSummary.brief'];
async function repairDerived() {
  const doc = await books.findOne({ id: BOOK_ID });
  const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const set = {};
  for (const f of DERIVED) {
    const v = get(doc, f);
    if (typeof v === 'string' && v.includes(FROM.author)) set[f] = v.replaceAll(FROM.author, TO.author);
  }
  (doc.index?.keywords || []).forEach((k, i) => { if (k?.term === FROM.author) set[`index.keywords.${i}.term`] = TO.author; });
  console.log(`derived  ${Object.keys(set).length ? Object.keys(set).join(', ') : '(none still carry the old name)'}`);
  if (APPLY && Object.keys(set).length) {
    const r = await books.updateOne({ id: BOOK_ID }, { $set: { ...set, updated_at: new Date() } });
    console.log(`derived fields modified: ${r.modifiedCount}`);
  }
  // The heavy index (bookSummary, people, keywords) lives in `book_indexes` and
  // is merged over books.index on read — the book page renders its summary
  // from there. Rewrite every string leaf that carries the old name.
  const idx = await db.collection('book_indexes').findOne({ book_id: BOOK_ID });
  const idxSet = {};
  (function walk(o, p) {
    if (typeof o === 'string') { if (o.includes(FROM.author)) idxSet[p] = o.replaceAll(FROM.author, TO.author); return; }
    if (o && typeof o === 'object' && !(o instanceof Date) && !o._bsontype) for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
  })(idx ? { ...idx, _id: undefined } : null, '');
  console.log(`book_indexes ${Object.keys(idxSet).length} string field(s)`);
  if (APPLY && Object.keys(idxSet).length) {
    const r = await db.collection('book_indexes').updateOne({ book_id: BOOK_ID }, { $set: idxSet });
    console.log(`book_indexes modified: ${r.modifiedCount}`);
  }
  // The book page's "About this book" and title are served from the Supabase
  // mirror (display_title, summary_text), not Mongo — repair those too.
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  const [row] = await (await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${BOOK_ID}&select=display_title,summary_text`, { headers: H })).json();
  const patch = {};
  for (const [k, v] of Object.entries(row || {})) if (typeof v === 'string' && v.includes(FROM.author)) patch[k] = v.replaceAll(FROM.author, TO.author);
  console.log(`supabase ${Object.keys(patch).join(', ') || '(clean)'}`);
  if (!APPLY || !Object.keys(patch).length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/books_catalog?id=eq.${BOOK_ID}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  console.log(`supabase derived: ${res.status}`);
}

const book = await books.findOne({ id: BOOK_ID, author: FROM.author }, { projection: { id: 1, author: 1, author_id: 1, display_title: 1 } });
if (!book) {
  console.log('book no longer carries "Isaac Pharar" as author');
  await repairDerived();
  await mc.close(); process.exit(0);
}
const others = await books.countDocuments({ author_id: FROM.author_id, id: { $ne: BOOK_ID } });
if (others) { console.error(`!! ${others} other book(s) link isaac-pharar — refusing to tombstone; adjudicate them first`); process.exit(1); }

const newTitle = String(book.display_title).replace(/^Isaac Pharar —/, 'Abraham Pharar —');
console.log(`book     ${book.display_title}\n      -> ${newTitle}`);
console.log(`author   ${book.author} (${book.author_id}) -> ${TO.author} (${TO.author_id})`);
console.log(`authors  mint ${TO.author_id}; tombstone ${FROM.author_id} merged_into ${TO.author_id}`);
if (!APPLY) { console.log('\n-- dry run (add --apply) --'); await mc.close(); process.exit(0); }

mkdirSync(dirname(BACKUP), { recursive: true });
if (!existsSync(BACKUP)) writeFileSync(BACKUP, JSON.stringify({ run: RUN, book_id: BOOK_ID, before: book, at: new Date().toISOString() }, null, 1));

const now = new Date();
const minted = await authors.updateOne({ _id: TO.author_id }, {
  $setOnInsert: {
    canonical_name: TO.author, slug: TO.author_id,
    variants: [TO.author], variant_slugs: [TO.author_id, FROM.author_id],
    viaf_id: null, wikidata_id: null, entity_ids: [],
    source: 'hand-adjudicated', built_at: now.toISOString(),
    note: WHY,
  },
}, { upsert: true });
const tomb = await authors.updateOne({ _id: FROM.author_id, merged_into: { $exists: false } }, { $set: { merged_into: TO.author_id } });
const r = await books.updateOne({ id: BOOK_ID, author: FROM.author },
  { $set: { author: TO.author, author_id: TO.author_id, display_title: newTitle, updated_at: now } });
console.log(`authors minted: ${minted.upsertedCount}  tombstoned: ${tomb.modifiedCount}  book modified: ${r.modifiedCount}`);
if (r.modifiedCount !== 1) { console.error('!! book not modified'); process.exit(1); }

const s = await supabaseSet(BOOK_ID, TO.author);
console.log(`supabase: ${JSON.stringify(s)}`);
await db.collection('field_provenance').insertOne({
  book_id: BOOK_ID, field: 'author', value: TO.author, source: 'hand-adjudicated', run: RUN,
  previous_value: FROM.author,
  evidence: { rationale: WHY, adjudicated_by: 'title page read against a reader report, no model verdict used' },
  created_at: now.toISOString(),
});
await recordSweepAction(db, {
  sweep: 'hand-adjudicated-authors-2026-09', book_id: BOOK_ID,
  action: 'author-string-repaired-by-hand', detail: { from: FROM, to: TO, why: WHY },
});
console.log('provenance + sweep_log written');
await repairDerived();
await mc.close();
