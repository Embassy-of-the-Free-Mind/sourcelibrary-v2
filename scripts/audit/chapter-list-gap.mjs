#!/usr/bin/env node
/**
 * Standing detector: chapter lists that are demonstrably incomplete (#4982).
 *
 * `books.chapters` (enrich-worker Phase 7) feeds the reader's contents panel and
 * the scholarly deposit PDF's contents page. Fuchs, De Historia Stirpium
 * (69a5d8114d84314297c08924) was stored with 24 entries — "Chapter 1, 2, 3, 4,
 * 31, 37, 50 … 343" — for a herbal of 343 chapters, and nothing on the page says
 * it is a sample.
 *
 * No ground truth needed: many chapter titles state their own number, so the
 * highest stated number is a lower bound on how many chapters exist. A book is
 * flagged when `stated > 1.25 × listed` and the gap is at least 5.
 *
 * The rate this prints is the rate WITHIN THE SLICE THE DETECTOR CAN SEE (books
 * whose titles state numbers), not a corpus rate: for every other book it is
 * silent, and silence is not a pass. It also over-reads books whose titles quote
 * a citation ("Codicil, chapter 53"), and single volumes of a multi-volume work
 * (vol. 39 of the Dream of the Red Chamber holds chapters 116–120, so "Chapter
 * 118" is honest). Read a flagged book before re-extracting it.
 *
 * Exit 0 = nothing flagged, 1 = at least one book flagged, 2 = Mongo unreachable.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/chapter-list-gap.mjs
 *   ... --all        every live book with a chapter list, not only deposit-eligible
 *                    (default scope: visible && pages_count > 0 && is_fully_translated)
 *   ... --top N      rows to print (default 25)
 *   ... --json       machine-readable report on stdout
 *
 * PRIOR ART: none — searched scripts/audit, scripts/maintenance, scripts/eval for
 * "chapter"; the measurement in #4982 was a throwaway (scripts/output/_chapgap.mjs
 * on the #4981 branch, never committed). scripts/workers/enrichment-snapshot.mjs
 * counts books WITH chapters, not whether the list is complete.
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const ALL = args.includes('--all');
const topIdx = args.indexOf('--top');
const TOP = topIdx >= 0 ? Number(args[topIdx + 1]) : 25;

const RATIO = 1.25;
const MIN_GAP = 5;
// Numbers above this are years or folio counts, not chapter numbers.
const MAX_PLAUSIBLE = 2000;

const CHAPTER_WORD = String.raw`(?:chapter|chap\.?|caput|capitulum|cap\.?|capitolo|cap[ií]tulo|chapitre|kapitel|hoofdstuk|rozdział)`;
const STATED = new RegExp(String.raw`\b${CHAPTER_WORD}\s+([0-9]{1,4}|[ivxlcdm]{1,10})\b\.?`, 'gi');

const VALID_ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
// Valid numerals that are also words or scribal abbreviations after the chapter word:
// "capitolo di …", "Chapitre dix-septième" (would read 509), "Cap m sedm" (1000).
const ROMAN_LOOKALIKES = new Set(['m', 'd', 'c', 'l', 'di', 'mi', 'dix', 'dim', 'did', 'mid', 'lid', 'mix', 'cd', 'dc', 'cv', 'mc', 'ml']);
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
export function romanToInt(s) {
  const t = s.toLowerCase();
  if (!VALID_ROMAN.test(t) || ROMAN_LOOKALIKES.has(t)) return null;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN[t[i]], next = ROMAN[t[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total > 0 ? total : null;
}

/** Highest chapter number a title states about itself, or 0. */
export function statedNumber(title) {
  if (!title) return 0;
  let max = 0;
  // Past ~160 chars a "title" is body text that leaked into the list; its
  // "chapter 100" is a citation, not a self-statement.
  for (const m of String(title).slice(0, 160).matchAll(STATED)) {
    const raw = m[1];
    const n = /^\d+$/.test(raw) ? Number(raw) : romanToInt(raw);
    if (n && n <= MAX_PLAUSIBLE && n > max) max = n;
  }
  return max;
}

/** { listed, stated, flagged } for one chapter list. */
export function chapterGap(chapters) {
  const listed = chapters.length;
  let stated = 0;
  for (const ch of chapters) {
    stated = Math.max(stated, statedNumber(ch.titleEn), statedNumber(ch.title));
  }
  const flagged = stated > RATIO * listed && stated - listed >= MIN_GAP;
  return { listed, stated, flagged };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
  } catch (e) {
    console.error(`Mongo unreachable: ${e.message}`);
    process.exit(2);
  }
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const filter = { visible: true, pages_count: { $gt: 0 }, 'chapters.0': { $exists: true } };
  if (!ALL) filter.is_fully_translated = true;
  const cursor = db.collection('books').find(filter, {
    projection: { _id: 0, id: 1, title: 1, pages_count: 1, chapters_extracted_at: 1, 'chapters.title': 1, 'chapters.titleEn': 1 },
  }).batchSize(1000);

  let withList = 0, measurable = 0;
  const flagged = [];
  for await (const b of cursor) {
    withList++;
    const g = chapterGap(b.chapters || []);
    if (!g.stated) continue;
    measurable++;
    if (g.flagged) {
      flagged.push({
        id: b.id, title: b.title, pages_count: b.pages_count,
        listed: g.listed, stated: g.stated, gap: g.stated - g.listed,
        chapters_extracted_at: b.chapters_extracted_at || null,
      });
    }
  }
  await client.close();
  flagged.sort((a, b) => b.gap - a.gap);

  const report = {
    measured_at: new Date().toISOString(),
    scope: ALL ? 'visible && pages_count > 0' : 'visible && pages_count > 0 && is_fully_translated',
    books_with_chapter_list: withList,
    measurable,
    flagged: flagged.length,
    rate_within_measurable: measurable ? flagged.length / measurable : null,
    books: flagged,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Chapter-list gap (#4982) — scope: ${report.scope}`);
    console.log(`  books with a chapter list:              ${withList}`);
    console.log(`  …whose titles state chapter numbers:    ${measurable}  (the detector is silent on the rest)`);
    const pct = measurable ? ((100 * flagged.length) / measurable).toFixed(0) : '—';
    console.log(`  …demonstrably incomplete:               ${flagged.length} (${pct}% of the measurable slice)`);
    console.log(`\nWorst by gap (top ${Math.min(TOP, flagged.length)}):`);
    for (const f of flagged.slice(0, TOP)) {
      console.log(`  ${String(f.listed).padStart(4)} listed / ${String(f.stated).padStart(4)}+ stated  ${String(f.pages_count).padStart(5)}pp  ${(f.title || '').slice(0, 45).padEnd(45)}  ${f.id}`);
    }
  }
  process.exit(flagged.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
