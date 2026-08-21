#!/usr/bin/env node
/**
 * Extract canonical loci (Bekker / Stephanus) from the editions that print them.
 *
 *   npx tsx scripts/locus/extract-locus-anchors.mjs                 # dry run, full report
 *   npx tsx scripts/locus/extract-locus-anchors.mjs --apply
 *   npx tsx scripts/locus/extract-locus-anchors.mjs --book=<id>      # one edition
 *   npx tsx scripts/locus/extract-locus-anchors.mjs --residuals      # print what was dropped
 *
 * ## What this is for (#3661)
 *
 * Scholarship addresses Aristotle by Bekker number and Plato by Stephanus number.
 * We addressed everything by scan page, which is a property of one copy and
 * shareable with nobody. An agent verifying attributed Aristotle quotes through
 * MCP had to rebuild the Bekker mapping by hand and then guess (#3653 item 2).
 *
 * ## The rule
 *
 * A locus is published only where a number was **printed on the leaf** and
 * continues its work's monotone run, or — in a root edition whose scan→printed
 * offset is constant and verified — where both neighbouring leaves bracket it
 * exactly. Everything else is reported as a residual and stored nowhere. See
 * `src/lib/locus.ts` for the acceptance rule and why it is deliberately local.
 *
 * ## Two mechanisms, never one number
 *
 * `printed` anchors from a root edition's own pagination and `printed` anchors
 * from a marginal reference are different evidence, and #3661 records that
 * summing them into one "% covered" scored the more valuable mechanism worst.
 * The report segments by edition and by basis and never totals across them.
 *
 * ## Staleness
 *
 * `locus_books.ocr_updated_max` records the source OCR's own timestamp, so a
 * re-OCR that moves the text under a stored anchor is detectable — the failure
 * mode `.claude/docs/invariants/derived-stores-and-schedules.md` was written
 * about. `scripts/audit/locus-anchor-staleness.mjs` is the detector.
 */
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { extractAnchors, refSortKey, formatRef } = await import(join(ROOT, 'src', 'lib', 'locus.ts'));
const { LOCUS_EDITIONS } = await import(join(ROOT, 'src', 'lib', 'locus-editions.ts'));

const EXTRACTOR_VERSION = 'locus-anchors/1';

const APPLY = process.argv.includes('--apply');
const SHOW_RESIDUALS = process.argv.includes('--residuals');
const ONLY = (process.argv.find((a) => a.startsWith('--book=')) || '').split('=')[1] || null;

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const NOW = new Date();

const tagOf = (text, tag) => {
  const m = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]{0,120}?)\\s*</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
};

const editions = LOCUS_EDITIONS.filter((e) => !ONLY || e.book_id === ONLY);
if (!editions.length) { console.error(`no registered edition matches ${ONLY}`); process.exit(1); }

const perBook = [];
const refused = [];

for (const ed of editions) {
  const book = await db.collection('books').findOne({ id: ed.book_id }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, visible: 1, pages_count: 1 } });
  if (!book) { refused.push([ed.book_id, 'book not found']); continue; }

  const pages = await db.collection('pages')
    .find({ book_id: ed.book_id }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.updated_at': 1 } })
    .sort({ page_number: 1 }).toArray();

  let ocrUpdatedMax = null;
  const inputs = [];
  for (const p of pages) {
    const text = p.ocr?.data || '';
    if (p.ocr?.updated_at && (!ocrUpdatedMax || p.ocr.updated_at > ocrUpdatedMax)) ocrUpdatedMax = p.ocr.updated_at;
    if (!text) continue;
    inputs.push({
      page_number: p.page_number,
      header: tagOf(text, 'header'),
      page_num: tagOf(text, 'page-num'),
    });
  }

  const { anchors, rejected, report } = extractAnchors(inputs, {
    author: book.author || '',
    frame: ed.frame,
    system: ed.system,
  });

  // Verify the reviewed pins. A book that fails one is REFUSED, not published
  // with a warning: a wrong frame re-addresses every citation it touches, and a
  // warning nobody reads is how that ships.
  const problems = [];
  const exp = ed.expect || {};
  if (exp.offset !== undefined && report.frame_offset !== exp.offset) {
    problems.push(`frame offset ${report.frame_offset} != reviewed ${exp.offset} (share ${report.frame_offset_share})`);
  }
  if (exp.min_anchors !== undefined && anchors.length < exp.min_anchors) {
    problems.push(`${anchors.length} anchors < reviewed floor ${exp.min_anchors}`);
  }
  if (exp.ref_range && anchors.length) {
    const lo = report.ref_min;
    const hi = report.ref_max;
    const [elo, ehi] = exp.ref_range;
    // A tighter range is drift too — it means anchors were lost.
    if (lo < elo || hi > ehi || lo > elo + 12 || hi < ehi - 12) {
      problems.push(`ref range ${lo}–${hi} outside reviewed ${elo}–${ehi}`);
    }
  }

  perBook.push({ ed, book, anchors, rejected, report, problems, ocrUpdatedMax });
}

// ── report ─────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(78)}\nCANONICAL LOCUS EXTRACTION — ${EXTRACTOR_VERSION}\n${'='.repeat(78)}`);

for (const r of perBook) {
  const { ed, book, report, anchors, problems } = r;
  console.log(`\n■ ${ed.label}`);
  console.log(`  ${ed.book_id}  ${book.pages_count} pages · ${report.candidate_pages} with a <page-num> that parsed`);
  console.log(`  system=${ed.system}  mechanism=${ed.frame ? 'A: own pagination is the standard' : 'B: reference printed in the margin'}`);
  console.log(`  anchors: ${report.printed} printed` + (ed.frame ? ` + ${report.frame} frame-filled` : '') + `   residual: ${report.rejected} dropped` + (report.off_frame ? ` (${report.off_frame} of them off-frame)` : ''));
  if (ed.frame) console.log(`  frame offset: ${report.frame_offset === null ? 'NO CONSTANT OFFSET — edition refused' : `${report.frame_offset} on ${(report.frame_offset_share * 100).toFixed(1)}% of printed anchors`}`);
  if (anchors.length) console.log(`  reference range: ${report.ref_min} … ${report.ref_max}`);
  console.log(`  works (derived from running heads, ranges derived from the anchors inside them):`);
  for (const s of report.segments) {
    console.log(`     ${String(s.anchors).padStart(4)} anchors  ref ${String(s.ref_min).padStart(4)}–${String(s.ref_max).padEnd(4)}  scan ${String(s.first_page).padStart(4)}–${String(s.last_page).padEnd(4)}  ${s.work_header ?? '(no running head)'}`);
  }
  if (problems.length) {
    console.log(`  ✗ REFUSED — reviewed expectations not met:`);
    for (const p of problems) console.log(`     ${p}`);
  }
  if (SHOW_RESIDUALS && r.rejected.length) {
    console.log(`  residuals (first 20):`);
    for (const x of r.rejected.slice(0, 20)) console.log(`     scan ${String(x.page_number).padStart(4)}  raw=${JSON.stringify((x.raw || '').slice(0, 40))}  ${x.reason}`);
  }
}

const publishable = perBook.filter((r) => !r.problems.length && r.anchors.length);
console.log(`\n${'-'.repeat(78)}`);
console.log(`${publishable.length}/${perBook.length} editions publishable`);
for (const [id, why] of refused) console.log(`  skipped ${id}: ${why}`);
// Deliberately no grand total of anchors across mechanisms — see the header.
console.log(`  mechanism A (own pagination): ${publishable.filter((r) => r.ed.frame).reduce((n, r) => n + r.anchors.length, 0)} anchors in ${publishable.filter((r) => r.ed.frame).length} editions`);
console.log(`  mechanism B (marginal refs) : ${publishable.filter((r) => !r.ed.frame).reduce((n, r) => n + r.anchors.length, 0)} anchors in ${publishable.filter((r) => !r.ed.frame).length} editions`);

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Pass --apply.`);
  await client.close();
  process.exit(0);
}

// ── write ──────────────────────────────────────────────────────────

const anchorsCol = db.collection('locus_anchors');
const booksCol = db.collection('locus_books');

await anchorsCol.createIndex({ system: 1, ref_page: 1, ref_section: 1 });
await anchorsCol.createIndex({ book_id: 1, page_number: 1 });
await anchorsCol.createIndex({ system: 1, work_header: 1, ref_sort: 1 });

let wrote = 0;
for (const r of publishable) {
  const { ed, book, anchors, report, ocrUpdatedMax } = r;
  // Replace this edition's rows wholesale. The extraction is a pure function of
  // the book's OCR, so a partial update would leave anchors from an older parse
  // interleaved with the new ones and nothing would say which was which.
  await anchorsCol.deleteMany({ book_id: ed.book_id });
  const docs = anchors.map((a) => ({
    book_id: ed.book_id,
    book_slug: book.slug || null,
    system: ed.system,
    ref_page: a.ref.page,
    ref_section: a.ref.section,
    ref_line: a.ref.line,
    ref_sort: refSortKey(a.ref),
    ref_label: formatRef(a.ref),
    page_number: a.page_number,
    basis: a.basis,
    work_header: a.work_header,
    work_header_alt: a.work_header_alt ?? null,
    raw: a.raw,
    extractor_version: EXTRACTOR_VERSION,
    extracted_at: NOW,
  }));
  for (let i = 0; i < docs.length; i += 500) await anchorsCol.insertMany(docs.slice(i, i + 500));
  wrote += docs.length;

  await booksCol.replaceOne({ book_id: ed.book_id }, {
    book_id: ed.book_id,
    book_slug: book.slug || null,
    title: book.title,
    author: book.author,
    year: book.year ?? null,
    language: book.language ?? null,
    system: ed.system,
    label: ed.label,
    mechanism: ed.frame ? 'pagination' : 'marginal',
    anchors_printed: report.printed,
    anchors_frame: report.frame,
    residual: report.rejected,
    frame_offset: report.frame_offset,
    frame_offset_share: report.frame_offset_share,
    ref_min: Math.min(...anchors.map((a) => a.ref.page)),
    ref_max: Math.max(...anchors.map((a) => a.ref.page)),
    segments: report.segments,
    // The SOURCE's timestamp, not ours — a re-OCR moves this and the staleness
    // detector diffs it. Storing our own write time instead would make the store
    // look fresh forever (derived-stores-and-schedules.md).
    ocr_updated_max: ocrUpdatedMax,
    extractor_version: EXTRACTOR_VERSION,
    extracted_at: NOW,
  }, { upsert: true });
}

console.log(`\nwrote ${wrote} anchors across ${publishable.length} editions`);
await client.close();
