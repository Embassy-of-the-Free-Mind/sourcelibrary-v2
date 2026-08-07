#!/usr/bin/env node
/**
 * Build `locus_anchors`: canonical reference → (book, scan page).
 *
 * Phase 1 of #3661. Reads the number the printer put on the page and records
 * where it sits. No fitting, no interpolation — every row here is a number
 * somebody printed, on a page we can show you.
 *
 *   node scripts/maintenance/extract-locus-anchors.mjs            # dry run
 *   node scripts/maintenance/extract-locus-anchors.mjs --apply
 *   node scripts/maintenance/extract-locus-anchors.mjs --survey   # find candidates
 *
 * ## The monotonicity check is the guard, not decoration
 *
 * OCR misreads numbers. A stray "1004" in a run of 1104s would, unchecked,
 * publish a citation pointing 100 Bekker pages away — and it would look
 * completely ordinary in the data, because a wrong number is the same shape as
 * a right one. So anchors must not decrease as scan pages advance. Violations
 * are DROPPED and COUNTED, never smoothed: the residual is reported so a reader
 * can judge the source, which is what #3661's guards ask for.
 *
 * A book is refused entirely if too many of its anchors violate, because at
 * that point the sequence is not a misread digit here and there — it is
 * evidence the book is not what the registry claims.
 *
 * ## --survey
 *
 * Reports books NOT in the registry whose <page-num> values parse as loci at a
 * high rate. This is a shortlist for a human to read, never an auto-promotion:
 * a book's own pagination parses just as happily as a marginal canonical ref,
 * and telling them apart is the one thing the numbers cannot do for you.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { parseLocusRefs, formatLocus } from '../lib/locus-parse.mjs';
import { LOCUS_EDITIONS } from '../lib/locus-editions.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Source .env.production.local first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const survey = args.includes('--survey');

/** Above this share of out-of-order anchors, disbelieve the book, not the digits. */
const MAX_VIOLATION_RATE = 0.15;

const client = new MongoClient(MONGODB_URI);

function pageNumPayloads(text) {
  return [...String(text || '').matchAll(/<page-num>([^<]*)<\/page-num>/g)].map((m) => m[1]);
}

/**
 * A locus is only PARTIALLY ordered, and treating it as totally ordered is
 * wrong in a way that looks exactly like bad OCR.
 *
 * `488` and `488a` are not two positions. The first is the second with the
 * column unread — the printer set one number, and the scan caught the column on
 * one leaf and not the next. A naive key of `page * 10 + section` ranks bare
 * `488` BELOW `488a`, so an ordinary run reads as a backward step. That single
 * mistake produced 101 false violations in Historia Animalium and refused a
 * book #3661 names as one of the best sources in the corpus.
 *
 * So: compare pages first, and compare sections only when BOTH anchors have
 * one. An underspecified anchor is never evidence of disorder.
 */
function isBackward(prev, next) {
  if (next.page !== prev.page) return next.page < prev.page;
  if (!prev.section || !next.section) return false; // one side underspecified
  return next.section < prev.section;
}

/**
 * A large backward jump is EITHER a new work starting OR a misread digit, and
 * size alone cannot tell them apart.
 *
 * A collected-works volume restarts canonical numbering at each work: Burnet's
 * 1902 OCT runs the Republic to Stephanus 621 and then begins the Timaeus at
 * 17. But a single OCR error — 1104 read as 302 — jumps backward just as far.
 *
 * Accepting every large jump as a restart looked fine and was wrong: the Bekker
 * root came out as three segments (792–804, 302–858, 603–1462) when the volume
 * is one continuous run of 792–1462, and Burnet 1902 came out as eleven when
 * the Republic, Timaeus and Critias make three. Each spurious "restart" admits
 * the bad anchor as the start of a legitimate run — the wrong number ends up in
 * the published data wearing a clean shirt.
 *
 * The distinguishing signal is what comes AFTER. A real restart is followed by
 * a sustained ascending run at the new level; a misread is a single blip and
 * the sequence resumes where it left off. So a reset must be CONFIRMED by
 * look-ahead, and an unconfirmed jump is dropped as noise.
 */
const SEGMENT_RESET_PAGES = 20;
const RESET_CONFIRM_ANCHORS = 3;

/**
 * Does a backward jump at `i` look like a genuine work restart?
 *
 * True only when the next few anchors continue ASCENDING from the new, lower
 * level and stay below where the previous run had reached. A blip fails both
 * halves: the sequence jumps straight back up past the old ceiling.
 */
function isConfirmedReset(raw, i, prev) {
  const here = raw[i].ref;
  let seen = 0;
  let last = here;
  for (let j = i + 1; j < raw.length && seen < RESET_CONFIRM_ANCHORS; j++) {
    const next = raw[j].ref;
    if (next.page >= prev.page) return false; // snapped back to the old run
    if (next.page < last.page) return false; // not ascending from the new level
    last = next;
    seen++;
  }
  return seen === RESET_CONFIRM_ANCHORS;
}

/**
 * Anchors for one book, in scan order, with out-of-order rows removed.
 *
 * Returns the kept anchors AND the dropped ones — the caller reports both. A
 * function that returned only the good rows would make the source look cleaner
 * than it is.
 *
 * `segment` counts work-restarts within the volume, so a caller can see that
 * two anchors with the same number belong to different works.
 */
function anchorsForBook(pages, system) {
  const raw = [];
  for (const p of pages) {
    const text = p.ocr?.data || '';
    for (const payload of pageNumPayloads(text)) {
      for (const ref of parseLocusRefs(payload, system)) {
        raw.push({ page: p.page_number, ref });
      }
    }
  }

  const kept = [];
  const dropped = [];
  let prev = null;
  let segment = 0;
  let resets = 0;

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (prev && isBackward(prev, a.ref)) {
      const bigEnough = prev.page - a.ref.page >= SEGMENT_RESET_PAGES;
      if (bigEnough && isConfirmedReset(raw, i, prev)) {
        segment++;
        resets++;
      } else {
        dropped.push(a);
        continue;
      }
    }
    prev = a.ref;
    kept.push({ ...a, segment });
  }
  return { kept, dropped, resets, total: raw.length };
}

async function loadPages(db, bookId) {
  return db
    .collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1 } },
    )
    .sort({ page_number: 1 })
    .toArray();
}

async function runSurvey(db) {
  console.log('Surveying Aristotle and Plato books not already in the registry.\n');
  const known = new Set(LOCUS_EDITIONS.map((e) => e.book_id));
  const books = await db
    .collection('books')
    .find(
      { visible: true, pages_count: { $gt: 50 }, author: { $regex: /aristotle|plato/i } },
      { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, pages_count: 1 } },
    )
    .toArray();

  const rows = [];
  for (const b of books) {
    if (known.has(b.id)) continue;
    const system = /plato/i.test(b.author || '') ? 'stephanus' : 'bekker';
    const pages = await loadPages(db, b.id);
    if (pages.length < 50) continue;

    let withPayload = 0;
    let parsed = 0;
    for (const p of pages) {
      const payloads = pageNumPayloads(p.ocr?.data);
      if (!payloads.length) continue;
      withPayload++;
      if (payloads.some((x) => parseLocusRefs(x, system).length)) parsed++;
    }
    if (withPayload < 30) continue;
    const rate = parsed / withPayload;
    if (rate < 0.6) continue;

    const { kept, dropped, total } = anchorsForBook(pages, system);
    rows.push({
      id: b.id,
      title: (b.title || '').slice(0, 52),
      lang: b.language,
      year: b.published,
      system,
      parseRate: rate,
      anchors: kept.length,
      violationRate: total ? dropped.length / total : 0,
    });
  }

  rows.sort((a, b) => b.anchors - a.anchors);
  console.log(`${rows.length} candidates (parse rate >= 0.60, >= 30 pages with a page-num):\n`);
  for (const r of rows.slice(0, 40)) {
    console.log(
      `  ${r.id}  ${r.system.padEnd(9)} ${String(r.year).padEnd(6)} ${r.lang.padEnd(8)} ` +
        `parse ${(r.parseRate * 100).toFixed(0).padStart(3)}%  anchors ${String(r.anchors).padStart(4)}  ` +
        `out-of-order ${(r.violationRate * 100).toFixed(0).padStart(3)}%  ${r.title}`,
    );
  }
  console.log(
    '\nThese are NOT confirmed. A book\'s own pagination parses exactly as well as a\n' +
      'marginal canonical reference. Read a few pages before adding a row to\n' +
      'scripts/lib/locus-editions.mjs, and record which mechanism you saw.',
  );
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  if (survey) {
    await runSurvey(db);
    return;
  }

  const docs = [];
  const report = [];

  for (const ed of LOCUS_EDITIONS) {
    const book = await db
      .collection('books')
      .findOne({ _id: new ObjectId(ed.book_id) }, { projection: { id: 1, title: 1, author: 1, published: 1, language: 1, visible: 1 } });
    if (!book) {
      report.push({ ...ed, status: 'BOOK NOT FOUND', anchors: 0 });
      continue;
    }

    const pages = await loadPages(db, book.id);
    const { kept, dropped, resets, total } = anchorsForBook(pages, ed.system);
    const violationRate = total ? dropped.length / total : 0;

    if (violationRate > MAX_VIOLATION_RATE) {
      report.push({
        ...ed,
        status: `REFUSED — ${(violationRate * 100).toFixed(0)}% out of order`,
        anchors: 0,
        dropped: dropped.length,
        total,
      });
      continue;
    }

    for (const a of kept) {
      docs.push({
        system: ed.system,
        page: a.ref.page,
        section: a.ref.section,
        locus: formatLocus(a.ref.page, a.ref.section),
        ...(a.ref.range_end
          ? { range_end_locus: formatLocus(a.ref.range_end.page, a.ref.range_end.section) }
          : {}),
        book_id: book.id,
        scan_page: a.page,
        book_title: book.title,
        author: book.author,
        published: book.published,
        language: book.language,
        edition_kind: ed.kind,
        extracted_at: new Date(),
      });
    }

    // Report a range PER SEGMENT. A single first-to-last span is nonsense on a
    // collected-works volume: Burnet 1902 runs the Republic to 621 and then
    // restarts at Timaeus 17, so its "span" printed as 406–220.
    const segments = [];
    for (const a of kept) {
      const s = (segments[a.segment] ||= { from: a.ref, to: a.ref, n: 0 });
      s.to = a.ref;
      s.n++;
    }

    report.push({
      ...ed,
      status: 'ok',
      anchors: kept.length,
      dropped: dropped.length,
      resets,
      total,
      segments: segments
        .filter(Boolean)
        .map((s) => `${formatLocus(s.from.page, s.from.section)}–${formatLocus(s.to.page, s.to.section)}`),
    });
  }

  console.log(apply ? 'APPLYING\n' : 'DRY RUN — nothing written\n');
  for (const r of report) {
    console.log(`  ${r.system.padEnd(9)} ${r.kind.padEnd(10)} ${r.title.slice(0, 48)}`);
    console.log(
      `      ${r.status}  anchors ${r.anchors}` +
        (r.total ? `  dropped ${r.dropped}/${r.total} (${((r.dropped / r.total) * 100).toFixed(1)}%)` : '') +
        (r.resets ? `  work-restarts ${r.resets}` : ''),
    );
    if (r.segments?.length) console.log(`      ranges: ${r.segments.join('  |  ')}`);
  }

  const bySystem = docs.reduce((acc, d) => ((acc[d.system] = (acc[d.system] || 0) + 1), acc), {});
  console.log(`\n  total anchors: ${docs.length} ${JSON.stringify(bySystem)}`);

  if (apply) {
    const col = db.collection('locus_anchors');
    // Rebuild wholesale: anchors are derived, so a partial update would leave
    // rows from a previous parser version alongside the current ones with no
    // way to tell which is which.
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs);
    await col.createIndex({ system: 1, page: 1, section: 1 });
    await col.createIndex({ book_id: 1, scan_page: 1 });
    console.log(`  wrote ${docs.length} anchors to locus_anchors`);
  } else {
    console.log('\n  Re-run with --apply to write.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.close());
