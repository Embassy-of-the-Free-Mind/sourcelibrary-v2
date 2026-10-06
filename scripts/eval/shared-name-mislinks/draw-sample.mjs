#!/usr/bin/env node
// PRIOR ART: scripts/audit/person-entity-name-collisions.mjs — counts person records whose NAMES
// collide; it never opens a page. scripts/maintenance/repair-entity-page-attribution.mjs — checks
// that a page prints the name, not WHICH bearer of the name it means. scripts/eval/search-recall/
// — search results, not entity attribution. None draws mentions of a shared surname to be read.
/**
 * READ-ONLY: draw the by-eye sample for "which person is this mention?" (#5950).
 *
 * For each surname in SURNAMES, takes the bare-surname `entities` person record ("Bacon"),
 * and draws N books from its `books[]` (seeded shuffle), one page per book. Only entries with
 * verified page precision in a live book (visible, pages_count > 0) are in the frame: an entry
 * with section precision names no page to read. For each drawn page it writes the passages
 * around the printed name (translation and OCR) so a reader can say who is meant.
 *
 * Writes sample.jsonl (one row per drawn mention) and frame.json (frame sizes and the other
 * person records of each surname, by Wikidata id). No model calls, no writes to Mongo.
 *
 * Usage: node --env-file=.env.production.local scripts/eval/shared-name-mislinks/draw-sample.mjs [--n 10] [--seed 5950]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : dflt; };
const N = Number(arg('--n', 10));
const SEED = Number(arg('--seed', 5950));
const CONTEXT = 450;

/**
 * Bare-surname records to sample. `needles` are the letters a page prints for the name (folded:
 * lowercase, no diacritics) — the surname's stem plus the Latin or vernacular forms that do not
 * share it. Selection rule: experiment file, "Design".
 */
export const SURNAMES = [
  { name: 'Bacon', needles: ['bacon', 'verulam'] },
  { name: 'Scaliger', needles: ['scalig'] },
  { name: 'Valentinus', needles: ['valentin'] },
  { name: 'Agrippa', needles: ['agripp'] },
  { name: 'Huygens', needles: ['huygen', 'hugen', 'huyghen', 'zulichem', 'zuylichem'] },
  { name: 'Bauhin', needles: ['bauhin'] },
  { name: 'Bruno', needles: ['brun'] },
  { name: 'Fabricius', needles: ['fabrici', 'fabriz'] },
  { name: 'Scotus', needles: ['scot'] },
  { name: 'Agricola', needles: ['agricol'] },
  { name: 'Montanus', needles: ['montan'] },
  { name: 'Gesner', needles: ['gesner', 'gessner'] },
  { name: 'Helmont', needles: ['helmont'] },
  { name: 'Vossius', needles: ['vossi', 'voss'] },
  { name: 'Hartmann', needles: ['hartman'] },
  { name: 'Philalethes', needles: ['philalet'] },
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Fold one character at a time so an index in the folded text is an index in the original.
const foldChar = (ch) => {
  const f = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  return f.length === 1 ? f : ch.length === 1 ? (f[0] ?? ' ') : ch;
};
const fold = (s) => Array.from(s, foldChar).join('');

/** Up to `max` passages around the name, merged when they overlap. */
export function passages(text, needles, max = 3) {
  if (!text) return [];
  const folded = fold(text);
  const hits = [];
  for (const n of needles) {
    for (let i = folded.indexOf(n); i !== -1; i = folded.indexOf(n, i + n.length)) hits.push(i);
  }
  hits.sort((a, b) => a - b);
  const spans = [];
  for (const h of hits) {
    const s = Math.max(0, h - CONTEXT), e = Math.min(text.length, h + CONTEXT);
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = e; else spans.push([s, e]);
  }
  return spans.slice(0, max).map(([s, e]) => text.slice(s, e).replace(/\s+/g, ' ').trim());
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, readPreference: 'secondaryPreferred' });
  const rows = [];
  const frame = { drawn_at: new Date().toISOString(), seed: SEED, n_per_surname: N, surnames: [] };
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const entities = db.collection('entities');
    for (const [si, s] of SURNAMES.entries()) {
      const rnd = mulberry32(SEED + si);
      // name_1_type_1; a name can have more than one person record — take the largest.
      const recs = await entities.find({ name: s.name, type: 'person' }).toArray();
      const rec = recs.filter(r => !r.merged_into).sort((a, b) => (b.books?.length ?? 0) - (a.books?.length ?? 0))[0];
      if (!rec) { console.error(`no person record named ${s.name}`); continue; }

      // The surname's other person records, grouped by Wikidata id (Atlas `entities_search`).
      const others = await entities.aggregate([
        { $search: { index: 'entities_search', text: { query: s.name, path: ['name', 'aliases'] } } },
        { $match: { type: 'person' } },
        { $limit: 200 },
        { $project: { name: 1, wikidata_id: 1, book_count: 1, wikidata_birth_date: 1, wikidata_death_date: 1 } },
      ]).toArray();
      const byQid = new Map();
      for (const o of others) {
        if (String(o._id) === String(rec._id) || !o.wikidata_id) continue;
        const g = byQid.get(o.wikidata_id) ?? { wikidata_id: o.wikidata_id, names: [], books: 0, born: o.wikidata_birth_date ?? null, died: o.wikidata_death_date ?? null };
        g.names.push(o.name); g.books += o.book_count ?? 0;
        byQid.set(o.wikidata_id, g);
      }

      const byBook = new Map();
      for (const b of rec.books || []) if (b?.book_id && !byBook.has(b.book_id)) byBook.set(b.book_id, b);
      const paged = [...byBook.values()].filter(b => b.page_precision === 'page' && Array.isArray(b.pages) && b.pages.length > 0);
      const books = await db.collection('books')
        .find({ id: { $in: paged.map(b => b.book_id) } }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, visible: 1, pages_count: 1, slug: 1 } })
        .toArray();
      const live = new Map(books.filter(b => b.visible === true && (b.pages_count ?? 0) > 0).map(b => [b.id, b]));
      const frameEntries = paged.filter(b => live.has(b.book_id)).sort((a, b) => a.book_id.localeCompare(b.book_id));

      let taken = 0, noText = 0;
      for (const entry of shuffle(frameEntries, rnd)) {
        if (taken >= N) break;
        const pageNumber = entry.pages[Math.floor(rnd() * entry.pages.length)];
        const page = await db.collection('pages').findOne(
          { book_id: entry.book_id, page_number: pageNumber },
          { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, photo: 1, archived_photo: 1 } });
        const tr = passages(page?.translation?.data, s.needles);
        const ocr = passages(page?.ocr?.data, s.needles);
        if (tr.length === 0 && ocr.length === 0) { noText++; continue; } // name not found by these needles: redraw, counted
        const book = live.get(entry.book_id);
        taken++;
        rows.push({
          key: `${s.name}-${String(taken).padStart(2, '0')}`,
          surname: s.name, record_id: String(rec._id), record_wikidata_id: rec.wikidata_id ?? null,
          book_id: book.id, book_title: book.display_title || book.title, book_author: book.author ?? null,
          book_year: book.year ?? book.published ?? null, book_language: book.language ?? null,
          page_number: pageNumber, page_id: page.id, pages_claimed_in_book: entry.pages.length,
          url: `https://sourcelibrary.org/book/${book.slug || book.id}/page/${page.id}`,
          image: page.archived_photo || page.photo || null,
          translation: tr, ocr,
        });
      }
      frame.surnames.push({
        surname: s.name, record_id: String(rec._id), record_wikidata_id: rec.wikidata_id ?? null,
        record_description: rec.description ?? null, record_aliases: rec.aliases ?? [],
        record_born: rec.wikidata_birth_date ?? null, record_died: rec.wikidata_death_date ?? null,
        books_distinct: byBook.size, books_with_verified_page: paged.length, frame_live_books: frameEntries.length,
        drawn: taken, redrawn_name_not_found: noText,
        other_records_by_wikidata_id: [...byQid.values()].sort((a, b) => b.books - a.books).slice(0, 8),
      });
      console.log(`${s.name.padEnd(12)} books ${String(byBook.size).padStart(4)}  verified-page ${String(paged.length).padStart(4)}  live frame ${String(frameEntries.length).padStart(4)}  drawn ${taken}  redrawn ${noText}`);
    }
  } finally {
    await client.close();
  }
  fs.writeFileSync(path.join(HERE, 'sample.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(HERE, 'frame.json'), JSON.stringify(frame, null, 2) + '\n');
  console.log(`\n${rows.length} mentions → sample.jsonl`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
