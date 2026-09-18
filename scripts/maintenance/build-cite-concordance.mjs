#!/usr/bin/env node
/**
 * Build the Egyptological citation concordances in `src/data/cite/<edition>.json`.
 *
 * PRIOR ART: src/lib/locus.ts (extractAnchors) — reads `<page-num>` for Bekker /
 * Stephanus loci and keys work identity on running heads; it addresses a
 * canonical page+column, not an edition's own pagination or Breasted's §
 * sections, and its anchors live in Mongo (`locus_anchors`) behind a request-
 * path query. This writes a static per-edition file the route reads with no DB.
 * src/lib/page-number-resolve.ts resolves `pages.page_number`, which is the
 * scan sequence, not the printed number. scripts/lib/page-counts.mjs only counts.
 *
 * ## What a concordance is
 *
 * printed page (or Breasted §) → reader page number (`pages.page_number`), built
 * by READING the printed number off each leaf's OCR (`<page-num>`), never by
 * assuming a constant offset: plates, unnumbered leaves and front matter shift
 * the offset within a volume (Sethe p.120 is reader 132; Breasted §335 is
 * reader 203 in this copy). Every entry in `pages` was printed on that leaf.
 * `frame` holds leaves whose own number was misread or missing but which sit
 * between two printed neighbours agreeing on the offset — kept separate, as
 * `canonical-loci.md` requires.
 *
 * ## Checks
 *
 * Every 20th reader page is sampled and the printed numbers must be strictly
 * increasing; the result is recorded in `checks` and asserted by
 * tests/unit/cite-egypt.test.ts.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/build-cite-concordance.mjs [edition ...]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'src/data/cite');

/**
 * The held editions. `book_id` is the catalogue id; `sections` turns on the
 * Breasted § reader. Add a volume here only once it is held and OCR'd.
 */
const EDITIONS = [
  {
    edition: 'urk-i',
    label: 'Sethe, Urkunden des Alten Reiches (Urk. I), 2nd ed. 1933',
    book_id: '6a9afa09441bca6a13ac2510',
    sections: false,
  },
  {
    edition: 'are-i',
    label: 'Breasted, Ancient Records of Egypt, vol. I (1906)',
    book_id: '6a989f98ba191f96aa9bab9c',
    sections: true,
  },
];

const SAMPLE_EVERY = 20;

/** First arabic `<page-num>` on the leaf, or null. Roman numerals (front matter) are ignored. */
function readPrintedPage(ocr) {
  const m = /<page-num>\s*([^<]*?)\s*<\/page-num>/.exec(ocr);
  if (!m) return null;
  const n = /^(\d{1,4})$/.exec(m[1].trim());
  return n ? Number(n[1]) : null;
}

/**
 * Section numbers that START on this leaf, read from the body: Breasted opens
 * every section with its number and a full stop (`**335.** His majesty…`,
 * `337. Idu, or Seneni…`). Footnote lines (`ª…`), line numbers inside the
 * text (`¹¹I went forth`) and years never take that shape at line start.
 */
function readSectionStarts(ocr) {
  const body = ocr.replace(/<[^>]+>[^<]*<\/[^>]+>/g, '');
  const out = [];
  const re = /^\s*\*{0,2}(\d{1,4})\.\*{0,2}\s+(?=\S)/gm;
  let m;
  while ((m = re.exec(body))) out.push(Number(m[1]));
  return out;
}

/**
 * Keep the printed numbers a reader could believe: the longest strictly
 * increasing run through the leaves (a page number never goes backwards), then
 * drop any survivor whose scan→printed offset matches neither neighbour.
 *
 * Both passes are needed. Sethe's opening leaves carry line numbers `(12) (13)`
 * that the OCR took for page numbers on reader 12–17, and they agree with each
 * other, so a neighbour-agreement test alone accepted them at offset 0 against
 * the true offset 10; the increasing-run pass prefers the longer true sequence.
 * A lone `2` on reader 19 (a misread `9`) survives the monotone pass — it is
 * still increasing — and the offset pass removes it.
 */
function acceptPrinted(pairs) {
  const n = pairs.length;
  if (!n) return [];
  // Longest strictly increasing subsequence on `printed`, in reader order.
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (pairs[j].printed < pairs[i].printed && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
  const run = [];
  for (let i = best; i >= 0; i = prev[i]) run.push(pairs[i]);
  run.reverse();

  const accepted = [];
  for (let i = 0; i < run.length; i++) {
    const { reader, printed } = run[i];
    const off = reader - printed;
    const p = run[i - 1];
    const q = run[i + 1];
    const agreesPrev = p && p.reader - p.printed === off;
    const agreesNext = q && q.reader - q.printed === off;
    if (agreesPrev || agreesNext) accepted.push({ reader, printed });
  }
  return accepted;
}

/** Where the scan→printed offset changes: each entry is a plate, an unnumbered leaf, or a misread worth a look. */
function offsetSegments(accepted) {
  const segs = [];
  for (const { reader, printed } of accepted) {
    const off = reader - printed;
    const last = segs[segs.length - 1];
    if (last && last.offset === off) {
      last.to_reader = reader;
      last.to_printed = printed;
      last.leaves++;
    } else {
      segs.push({ offset: off, from_reader: reader, from_printed: printed, to_reader: reader, to_printed: printed, leaves: 1 });
    }
  }
  return segs;
}

/** Leaves between two accepted anchors that share an offset and bracket the gap exactly. */
function frameFill(accepted, maxReader) {
  const frame = {};
  for (let i = 0; i + 1 < accepted.length; i++) {
    const a = accepted[i];
    const b = accepted[i + 1];
    if (b.reader - a.reader < 2) continue;
    if (a.reader - a.printed !== b.reader - b.printed) continue;
    for (let r = a.reader + 1; r < b.reader && r <= maxReader; r++) {
      frame[String(r - (a.reader - a.printed))] = r;
    }
  }
  return frame;
}

function sampleCheck(pages, byReader, sampleEvery) {
  const anomalies = [];
  let last = null;
  const sampled = [];
  for (let r = sampleEvery; r <= pages; r += sampleEvery) {
    const printed = byReader.get(r);
    if (printed == null) continue;
    sampled.push([r, printed]);
    if (last && printed <= last.printed) {
      anomalies.push({ reader: r, printed, previous: last });
    }
    last = { reader: r, printed };
  }
  return { sampled_every: sampleEvery, sampled: sampled.length, monotonic: anomalies.length === 0, anomalies };
}

async function buildEdition(db, ed) {
  const book = await db.collection('books').findOne(
    { $or: [{ id: ed.book_id }, { _id: ed.book_id }] },
    { projection: { id: 1, slug: 1, title: 1, author: 1, published: 1, pages_count: 1 } },
  );
  if (!book) throw new Error(`${ed.edition}: book ${ed.book_id} not found`);
  const bookId = book.id || String(book._id);

  const cursor = db
    .collection('pages')
    .find({ book_id: bookId }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 });

  const pairs = [];
  const rawSections = []; // [reader, [section starts on that leaf]]
  let maxReader = 0;
  let leaves = 0;
  let withOcr = 0;
  for await (const p of cursor) {
    leaves++;
    maxReader = Math.max(maxReader, p.page_number);
    const ocr = p.ocr && typeof p.ocr.data === 'string' ? p.ocr.data : '';
    if (!ocr) continue;
    withOcr++;
    const printed = readPrintedPage(ocr);
    if (printed != null) pairs.push({ reader: p.page_number, printed });
    if (ed.sections) rawSections.push([p.page_number, readSectionStarts(ocr)]);
  }

  const accepted = acceptPrinted(pairs);
  const pages = {};
  const byReader = new Map();
  for (const { reader, printed } of accepted) {
    // A printed number read on two leaves (a misread that happened to agree with
    // a neighbour) keeps the first; the second is a duplicate, not a page.
    if (pages[String(printed)] == null) {
      pages[String(printed)] = reader;
      byReader.set(reader, printed);
    }
  }
  const frame = frameFill(accepted, maxReader);
  for (const [printed, reader] of Object.entries(frame)) {
    if (pages[printed] != null) delete frame[printed];
    else byReader.set(reader, Number(printed));
  }

  // Sections: keep the monotone subsequence. A number that steps backwards is a
  // line number or a year that happened to open a paragraph, not a section.
  // Only leaves in the arabic pagination carry sections: the preface and the
  // table of contents (roman numerals) open paragraphs with numbers too.
  const sectionStarts = new Map(); // section → reader page (first sighting)
  for (const [reader, starts] of rawSections) {
    if (!byReader.has(reader)) continue;
    for (const s of starts) if (!sectionStarts.has(s)) sectionStarts.set(s, reader);
  }
  let sections = null;
  if (ed.sections) {
    sections = {};
    let lastSec = 0;
    let lastReader = 0;
    const ordered = [...sectionStarts.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [s, reader] of ordered) {
      if (s > lastSec && reader >= lastReader && s - lastSec <= 25) {
        sections[String(s)] = reader;
        lastSec = s;
        lastReader = reader;
      } else if (lastSec === 0 && s === 1) {
        sections['1'] = reader;
        lastSec = 1;
        lastReader = reader;
      }
    }
  }

  const printedKeys = Object.keys(pages).map(Number);
  const checks = sampleCheck(maxReader, byReader, SAMPLE_EVERY);

  const out = {
    edition: ed.edition,
    label: ed.label,
    book_id: bookId,
    slug: book.slug || null,
    title: book.title,
    author: book.author,
    published: book.published,
    built: new Date().toISOString(),
    source: 'pages.ocr.data <page-num> (printed), bracketed neighbours (frame), body section starts (sections)',
    leaves,
    leaves_with_ocr: withOcr,
    page_range: printedKeys.length ? [Math.min(...printedKeys), Math.max(...printedKeys)] : null,
    counts: {
      printed_read: pairs.length,
      printed_accepted: accepted.length,
      printed_dropped: pairs.length - accepted.length,
      pages: printedKeys.length,
      frame: Object.keys(frame).length,
      sections: sections ? Object.keys(sections).length : 0,
    },
    checks,
    offset_segments: offsetSegments(accepted),
    pages,
    frame,
    ...(sections ? { sections } : {}),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${ed.edition}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  console.log(
    `${ed.edition}: leaves=${leaves} ocr=${withOcr} printed read=${pairs.length} accepted=${accepted.length} ` +
      `pages=${printedKeys.length} frame=${Object.keys(frame).length} sections=${out.counts.sections} ` +
      `range=${JSON.stringify(out.page_range)} monotonic=${checks.monotonic} (${checks.sampled} samples)` +
      (checks.anomalies.length ? ` ANOMALIES=${JSON.stringify(checks.anomalies)}` : ''),
  );
  for (const seg of out.offset_segments) {
    console.log(`  offset ${String(seg.offset).padStart(3)}: reader ${seg.from_reader}–${seg.to_reader} = printed ${seg.from_printed}–${seg.to_printed} (${seg.leaves} leaves)`);
  }
  return out;
}

const wanted = process.argv.slice(2);
const targets = wanted.length ? EDITIONS.filter((e) => wanted.includes(e.edition)) : EDITIONS;
if (!targets.length) {
  console.error(`no such edition; known: ${EDITIONS.map((e) => e.edition).join(', ')}`);
  process.exit(1);
}

await withMongo(async (db) => {
  for (const ed of targets) await buildEdition(db, ed);
});
