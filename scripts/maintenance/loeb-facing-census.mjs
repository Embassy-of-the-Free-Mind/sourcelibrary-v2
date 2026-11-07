#!/usr/bin/env node
/**
 * Census of facing-page Loeb editions, and the writer of their book-level flag (#8321).
 *
 * PRIOR ART: scripts/maintenance/relabel-bilingual-edition.mjs — reads the
 * per-leaf language of ONE book to relabel `books.language`; it neither pairs
 * leaves nor reads printed page numbers. scripts/audit/english-served-divergence.mjs
 * — measures how far a served English text drifts from the OCR on English-original
 * books, not which books are facing-page editions. Neither enumerates Loebs.
 *
 * A Loeb prints the Greek or Latin on the left and the published English on the
 * right. We hold both as separate leaves, and on a book catalogued Greek or
 * Latin the English leaf carries a stored AI REWORDING of the Loeb's English
 * that every door served as "the translation" (#2784 comment 2026-11-07:
 * Herodotus IV.95, "a meanly-living and simple-witted folk" served as "a people
 * who lived quite simply and were somewhat naive"). A corpus-wide "English leaf
 * → serve the OCR" rule is unsafe (most English leaves of non-English books are
 * library stamps), so the serving rule keys off a book-level flag this script
 * writes: `books.facing_translation`.
 *
 * Per candidate book (title / publisher / catalogue publisher or description
 * matching /loeb|heinemann/i):
 *   - classify every leaf with leafRole (scripts/lib/facing-translation.mjs,
 *     built on isEnglishOriginalPage): original / translation / neither;
 *   - count facing pairs: an original leaf whose next leaf is English and whose
 *     printed page number is one less (FACING_PAIRING_RULE);
 *   - flag when ≥ MIN_LEAVES originals, ≥ MIN_LEAVES English leaves, and the
 *     ≥ MIN_LEAVES pairs cover ≥ MIN_PAIR_SHARE of the smaller side ("mostly alternate");
 *   - only books published MIN_YEAR..MAX_YEAR (US public domain) are eligible;
 *   - frame shape: a book whose frames are landscape (image_width > image_height)
 *     or whose transcriptions carry two printed page numbers is stored as
 *     two-leaf SPREADS, not leaves. It is never flagged or paired: it is listed
 *     as needing the split lane first (#7605), and a flag this detector wrote
 *     earlier on it is removed by --apply.
 *
 * DRY RUN BY DEFAULT: writes the per-book census to --out (jsonl) and prints
 * counts. `--apply` $sets `facing_translation` on the eligible flagged books
 * (only where it is absent or was written by this detector), logs one
 * `sweep_log` row per book, and prints the modifiedCount. Reversible: unset the
 * field. Never touches visibility, text or translations.
 *
 *   node --env-file=.env.production.local scripts/maintenance/loeb-facing-census.mjs [--out=PATH] [--book=<id>]
 *   node --env-file=.env.production.local scripts/maintenance/loeb-facing-census.mjs --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { leafRole, printedNumber, isFacingPair, FACING_PAIRING_RULE } from '../lib/facing-translation.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const ONE_BOOK = arg('book');
const OUT = arg('out') || path.join('scripts', 'maintenance', 'output', 'loeb-facing-census.jsonl');
const DETECTOR = 'loeb-facing-census/v1';
const MIN_LEAVES = 20;
const MIN_PAIR_SHARE = 0.6;
const MAX_YEAR = 1930;
/**
 * The series began in 1912. A catalogued year before it (Seneca's Epistulae
 * "1512", Plato's Theaetetus "1869") is a wrong year, not an early Loeb, and
 * the real one may be after 1930 — so such a book is reported, never flagged.
 */
const MIN_YEAR = 1912;
const RE = /loeb|heinemann/i;
/** Share of measured frames that must be landscape / two-numbered to call a book spreads. */
const SPREAD_SHARE = 0.3;

/** The distinct arabic numbers in a transcription's `<page-num>` tags. */
function pageNumsInOcr(ocrData) {
  const nums = new Set();
  for (const m of String(ocrData || '').matchAll(/<page-num>\s*(\d+)\s*<\/page-num>/gi)) nums.add(Number(m[1]));
  return nums;
}

/** The year the edition was published: `year`, else the first 4-digit run in `published`. */
function publicationYear(book) {
  const y = Number(book.year);
  if (Number.isInteger(y) && y > 1400 && y < 2100) return y;
  const m = String(book.published ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/** The translator, from the verified prior-translation record when there is one. */
function translatorOf(book) {
  const t = book.prior_translation?.translators;
  if (Array.isArray(t) && t.length && typeof t[0] === 'string') return t.join(', ');
  return typeof book.translator === 'string' && book.translator.trim() ? book.translator.trim() : null;
}

function matchedOn(book) {
  const fields = {
    title: book.title, publisher: book.publisher,
    'catalog_metadata.publisher': book.catalog_metadata?.publisher,
    'catalog_metadata.description': book.catalog_metadata?.description,
    'dublin_core.dc_publisher': book.dublin_core?.dc_publisher,
  };
  return Object.entries(fields).filter(([, v]) => RE.test(String(v ?? ''))).map(([k]) => k);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const filter = ONE_BOOK ? { id: ONE_BOOK } : {
  $or: [
    { title: RE }, { publisher: RE }, { series: RE },
    { 'catalog_metadata.publisher': RE }, { 'catalog_metadata.description': RE },
    { 'dublin_core.dc_publisher': RE },
  ],
};
const books = await db.collection('books').find(filter, {
  projection: {
    _id: 1, id: 1, title: 1, author: 1, year: 1, published: 1, publisher: 1, language: 1,
    visible: 1, pages_count: 1, translator: 1, 'prior_translation.translators': 1,
    'translation_state.english_original': 1, 'catalog_metadata.publisher': 1,
    'catalog_metadata.description': 1, 'dublin_core.dc_publisher': 1, facing_translation: 1,
  },
}).toArray();
console.error(`${books.length} candidate books`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT);
const rows = [];
let n = 0;
for (const book of books) {
  n++;
  const pages = await db.collection('pages').find(
    { book_id: book.id, page_number: { $gte: 0 } },
    { projection: { page_number: 1, 'ocr.data': 1, printed_page: 1, image_width: 1, image_height: 1 } },
  ).sort({ page_number: 1 }).toArray();
  let original = 0, translation = 0, pairs = 0, pairsOnVerso = 0, reversePairs = 0;
  let measured = 0, landscape = 0, twoNumbered = 0, numbered = 0;
  for (const p of pages) {
    const w = Number(p.image_width), h = Number(p.image_height);
    if (w > 0 && h > 0) { measured++; if (w > h) landscape++; }
    const nums = pageNumsInOcr(p.ocr?.data);
    if (nums.size) numbered++;
    if (nums.size >= 2) twoNumbered++;
  }
  const landscapeShare = measured ? landscape / measured : 0;
  const twoNumberShare = numbered ? twoNumbered / numbered : 0;
  const spreads = landscapeShare >= SPREAD_SHARE || twoNumberShare >= SPREAD_SHARE;
  const roles = pages.map((p) => leafRole(p.ocr?.data));
  for (let i = 0; i < pages.length; i++) {
    if (roles[i] === 'original') original++;
    if (roles[i] === 'translation') translation++;
    if (i + 1 < pages.length) {
      if (isFacingPair(pages[i], pages[i + 1])) {
        pairs++;
        if (printedNumber(pages[i]) % 2 === 0) pairsOnVerso++;
      }
      // English-first editions would pair the other way; measured, never flagged.
      else if (roles[i] === 'translation' && roles[i + 1] === 'original'
        && pages[i + 1].page_number === pages[i].page_number + 1) {
        const a = printedNumber(pages[i]); const b = printedNumber(pages[i + 1]);
        if (a !== null && b === a + 1) reversePairs++;
      }
    }
  }
  const pairShare = Math.min(original, translation) ? pairs / Math.min(original, translation) : 0;
  const facing = !spreads && original >= MIN_LEAVES && translation >= MIN_LEAVES && pairs >= MIN_LEAVES
    && pairShare >= MIN_PAIR_SHARE;
  const year = publicationYear(book);
  const row = {
    book_id: book.id, title: book.title, author: book.author ?? null, language: book.language ?? null,
    year, visible: book.visible === true, pages: pages.length,
    english_original: book.translation_state?.english_original ?? null,
    translator: translatorOf(book), matched_on: matchedOn(book),
    original_leaves: original, english_leaves: translation, pairs, pairs_on_verso: pairsOnVerso, reverse_pairs: reversePairs,
    pair_share: Math.round(pairShare * 100) / 100,
    frames_measured: measured, landscape_share: Math.round(landscapeShare * 100) / 100,
    two_number_share: Math.round(twoNumberShare * 100) / 100, spreads,
    facing, eligible: facing && year !== null && year >= MIN_YEAR && year <= MAX_YEAR,
    already_flagged: !!book.facing_translation,
  };
  rows.push(row);
  out.write(JSON.stringify(row) + '\n');
  if (n % 25 === 0) console.error(`  ${n}/${books.length}`);
}
await new Promise((r) => out.end(r));

const count = (f) => rows.filter(f).length;
console.log(JSON.stringify({
  candidates: rows.length,
  facing: count((r) => r.facing),
  facing_le_1930: count((r) => r.eligible),
  facing_le_1930_visible: count((r) => r.eligible && r.visible),
  facing_no_year: count((r) => r.facing && r.year === null),
  facing_year_before_series: count((r) => r.facing && r.year !== null && r.year < MIN_YEAR),
  facing_after_1930: count((r) => r.facing && r.year !== null && r.year > MAX_YEAR),
  spreads_need_split: count((r) => r.spreads),
  out: OUT,
}, null, 1));

if (APPLY) {
  const now = new Date();
  const eligible = rows.filter((r) => r.eligible);
  let modified = 0;
  const logged = [];
  for (const r of eligible) {
    const value = {
      source: 'published', series: 'loeb',
      ...(r.translator ? { translator: r.translator } : {}),
      year: r.year, pairing: FACING_PAIRING_RULE, detected_at: now, detector: DETECTOR,
      pairs: r.pairs,
    };
    // Only where absent or our own: a hand-set flag is never overwritten.
    const res = await db.collection('books').updateOne(
      { id: r.book_id, $or: [{ facing_translation: { $exists: false } }, { 'facing_translation.detector': DETECTOR }] },
      { $set: { facing_translation: value } },
    );
    modified += res.modifiedCount;
    if (res.modifiedCount) {
      logged.push({ sweep: 'loeb-facing-census-8321', book_id: r.book_id, action: 'set-facing-translation', detail: value });
    }
  }
  // A book this detector flagged that is no longer eligible (e.g. now seen to be spreads) loses the flag.
  const dropped = rows.filter((r) => !r.eligible && r.already_flagged);
  let unset = 0;
  for (const r of dropped) {
    const res = await db.collection('books').updateOne(
      { id: r.book_id, 'facing_translation.detector': DETECTOR },
      { $unset: { facing_translation: '' } },
    );
    unset += res.modifiedCount;
    if (res.modifiedCount) {
      logged.push({ sweep: 'loeb-facing-census-8321', book_id: r.book_id, action: 'unset-facing-translation',
        detail: { spreads: r.spreads, landscape_share: r.landscape_share, two_number_share: r.two_number_share } });
    }
  }
  if (logged.length) await recordSweepActions(db, logged);
  console.log(JSON.stringify({ eligible: eligible.length, modifiedCount: modified, unsetCount: unset, sweep_log_rows: logged.length }));
}
await client.close();
