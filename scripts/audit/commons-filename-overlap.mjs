#!/usr/bin/env node
/**
 * Audit: text-bearing books whose page images come from Wikimedia Commons, where no Commons
 * FILENAME shares a word with the work's title or author (#4411, follow-up to #4405).
 *
 * PRIOR ART: scripts/audit/scan-title-mismatch.mjs — title vs OCR text, never reads image URLs.
 * scripts/audit/artwork-image-integrity.mjs — dHashes ARTWORK records against their Commons
 * file page; it does not look at text editions' page images. The matcher lives in
 * scripts/lib/commons-filename-match.mjs so an importer can run it before writing a page.
 *
 * WHY: the April 2026 corpus importer paired five text editions with flatly wrong Commons
 * images (a Cézanne on Merikare, Chinese woodblock prints on the Shipwrecked Sailor) by
 * matching museum names and stray keywords. None of the five filenames shares a word with its
 * work. All five were fixed by hand in #4405; this finds the next ones.
 *
 * WHAT A FLAG MEANS: "a human should look at this image next to this text." It is NOT a
 * mismatch verdict. Measured on #4405's fifteen pairings, true witnesses are often named by
 * shelfmark ("Papyrus Sallier II" for the Hymn to the Nile, "Papyrus Berlin 3022" for Sinuhe)
 * and get flagged too; and a keyword-matched WRONG file can share a word ("By Nile and Tigris")
 * and pass. Findings go to a human queue, never to a write (measurement-instruments.md).
 *
 * SCOPE
 *   - text-bearing books only (pages_ocr > 0 or pages_translated > 0). Commons-native artwork
 *     records take their title FROM the file, so the check is a tautology there.
 *   - a page counts when its `photo` or `photo_original` is a Commons URL (upload.wikimedia.org
 *     or a commons.wikimedia.org File:/Special:FilePath link).
 *   - PROBE, then read: neither image field is indexed and `pages` is ~29M docs / 77 GB, so a
 *     regex scan never finishes (measured: still running at 20 min, 2026-10-12). Instead each
 *     text-bearing book's FIRST and LAST page are fetched through the {book_id, page_number}
 *     index (~130K docs); a book where either probe is a Commons URL then has every page read.
 *     BLIND SPOT: a book whose Commons images sit only on interior pages. `--book <id>` reads
 *     every page of one book.
 *   - visible and hidden books both; the report carries `visible`.
 *
 * READ-ONLY. Writes nothing to any store. Usage:
 *   node --env-file=.env.production.local scripts/audit/commons-filename-overlap.mjs [--out FILE] [--book ID] [--all]
 *     --all   also print books whose filenames DO overlap (default prints only the flags)
 */
import { MongoClient, ObjectId } from 'mongodb';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { commonsFilename, commonsOverlap } from '../lib/commons-filename-match.mjs';

const args = process.argv.slice(2);
const argVal = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
const OUT = argVal('--out', 'scripts/output/commons-filename-overlap.json');
const ONE_BOOK = argVal('--book', null);
const SHOW_ALL = args.includes('--all');

const COMMONS_RE = /^https?:\/\/(upload\.wikimedia\.org\/|commons\.wikimedia\.org\/)/i;
const IMAGE_FIELDS = ['photo', 'photo_original'];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const t0 = Date.now();

const isCommonsPage = (p) => IMAGE_FIELDS.some((f) => typeof p[f] === 'string' && COMMONS_RE.test(p[f]));
const PAGE_PROJ = { projection: { book_id: 1, page_number: 1, photo: 1, photo_original: 1 } };
const BATCH = 400;

try {
  // 1. Which books to read in full: one named book, or every text-bearing book whose first or
  //    last page is a Commons image.
  let candidates;
  let probed = 0;
  if (ONE_BOOK) {
    candidates = [ONE_BOOK];
  } else {
    const textBooks = await db.collection('books').find(
      { $or: [{ pages_ocr: { $gt: 0 } }, { pages_translated: { $gt: 0 } }] },
      { projection: { id: 1, pages_count: 1 } },
    ).toArray();
    const hit = new Set();
    for (let i = 0; i < textBooks.length; i += BATCH) {
      const pairs = [];
      for (const b of textBooks.slice(i, i + BATCH)) {
        const bid = b.id || String(b._id);
        pairs.push({ book_id: bid, page_number: 1 });
        if ((b.pages_count || 0) > 1) pairs.push({ book_id: bid, page_number: b.pages_count });
      }
      const pages = await db.collection('pages').find({ $or: pairs }, PAGE_PROJ).toArray();
      probed += pages.length;
      for (const p of pages) if (isCommonsPage(p)) hit.add(p.book_id);
      if ((i / BATCH) % 25 === 0) console.error(`  probed ${i + BATCH}/${textBooks.length} books, ${hit.size} with Commons images`);
    }
    candidates = [...hit];
    console.error(`text-bearing books: ${textBooks.length}; probe pages read: ${probed}; candidates: ${candidates.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  // 2. Commons filenames per candidate book, from every page's image fields.
  const byBook = new Map(); // book_id -> { files: Map(name -> Set(page)), pages: Set }
  const cursor = db.collection('pages')
    .find({ book_id: { $in: candidates } }, PAGE_PROJ)
    .batchSize(2000);
  let scanned = 0;
  for await (const p of cursor) {
    scanned++;
    for (const f of IMAGE_FIELDS) {
      const url = p[f];
      if (typeof url !== 'string' || !COMMONS_RE.test(url)) continue;
      const name = commonsFilename(url);
      if (!name) continue;
      if (!byBook.has(p.book_id)) byBook.set(p.book_id, { files: new Map(), pages: new Set() });
      const b = byBook.get(p.book_id);
      if (!b.files.has(name)) b.files.set(name, new Set());
      b.files.get(name).add(p.page_number);
      b.pages.add(p.page_number);
    }
  }
  console.error(`candidate pages read: ${scanned}; books with Commons page images: ${byBook.size} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  // 2. Load the books (by `id` OR `_id` — book-deletion-and-identity.md).
  const ids = [...byBook.keys()].filter(Boolean).map(String);
  const oids = ids.filter((s) => ObjectId.isValid(s) && s.length === 24).map((s) => new ObjectId(s));
  const books = await db.collection('books').find(
    { $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] },
    { projection: {
      id: 1, title: 1, display_title: 1, original_title: 1, title_original: 1, subtitle: 1,
      author: 1, display_author: 1, alternate_titles: 1, visible: 1, pages_count: 1,
      pages_ocr: 1, pages_translated: 1, 'image_source.provider': 1,
    } },
  ).toArray();
  const bookFor = new Map();
  for (const b of books) { bookFor.set(String(b._id), b); if (b.id) bookFor.set(String(b.id), b); }

  // 3. Judge.
  const rows = [];
  const counts = { 'zero-overlap': 0, overlap: 0, unjudgeable: 0, 'not-text-bearing': 0, 'book-missing': 0, 'overlap-with-stray-files': 0 };
  for (const [bookId, info] of byBook) {
    const book = bookFor.get(String(bookId));
    if (!book) { counts['book-missing']++; continue; }
    const textBearing = (book.pages_ocr || 0) > 0 || (book.pages_translated || 0) > 0;
    if (!textBearing) { counts['not-text-bearing']++; continue; }
    const res = commonsOverlap(book, [...info.files.keys()]);
    counts[res.verdict]++;
    // A matching book can still carry one odd file (shown per file below); informational only.
    if (res.verdict === 'overlap' && res.zero_overlap_files.length) counts['overlap-with-stray-files']++;
    rows.push({
      book_id: book.id || String(book._id),
      title: book.title,
      author: book.author ?? null,
      visible: book.visible === true,
      provider: book.image_source?.provider ?? null,
      commons_pages: info.pages.size,
      pages_count: book.pages_count ?? null,
      verdict: res.verdict,
      work_tokens: res.work_tokens,
      files: res.files.map((f) => ({
        name: f.name, shared: f.shared,
        pages: [...info.files.get(f.name)].sort((a, b) => a - b).slice(0, 20),
      })),
      zero_overlap_files: res.zero_overlap_files,
    });
  }
  const order = { 'zero-overlap': 0, unjudgeable: 1, overlap: 2 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || Number(b.visible) - Number(a.visible));

  const report = {
    generated_at: new Date().toISOString(),
    issue: '#4411',
    scope: ONE_BOOK ? { book: ONE_BOOK } : 'text-bearing books whose first or last page is a Commons image; every page of those read',
    probe_pages_read: probed,
    candidate_pages_read: scanned,
    books_with_commons_pages: byBook.size,
    counts,
    note: 'zero-overlap = a reason to look, not a mismatch verdict; shelfmark-named true witnesses also flag.',
    rows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\nCommons filename ↔ work overlap (#4411) — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`books with Commons page images: ${byBook.size}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(25)} ${v}`);
  const shown = SHOW_ALL ? rows : rows.filter((r) => r.verdict === 'zero-overlap');
  if (shown.length) console.log('');
  for (const r of shown) {
    console.log(`[${r.verdict}] ${r.visible ? 'visible' : 'hidden '} ${r.book_id}  ${r.title}${r.author ? ` — ${r.author}` : ''}`);
    for (const f of r.files.slice(0, 6)) {
      console.log(`    ${f.shared.length ? `≈ ${f.shared.join(',')}` : '∅'}  "${f.name}"  (pp. ${f.pages.join(',')})`);
    }
    if (r.files.length > 6) console.log(`    … ${r.files.length - 6} more files`);
  }
  console.log(`\nreport: ${OUT}`);
} finally {
  await client.close();
}
