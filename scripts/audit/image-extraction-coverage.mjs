#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/scope-progress.mjs — reports the images phase per book
 * for ONE pipeline scope from `detected_images_count`, the rollup field whose
 * absence is the very hole this audit measures; scripts/audit/record-completeness.mjs
 * reads the same rollup. scripts/maintenance/reextract-missed-pages.mjs finds
 * missed PAGES inside already-extracted books and cannot see a book that was
 * never extracted. None of them gives a corpus denominator. Searched
 * scripts/audit and scripts/maintenance for image/gallery/coverage on 2026-10-12.
 *
 * Which live books have had their illustrations extracted, which have not, and
 * which of those are worth a backfill run (#4241).
 *
 * ## Why this exists
 *
 * "5,148 of 22,081 books have gallery images = 23% coverage" was the only number
 * available on 2026-08-27, and it is not a coverage number: its denominator holds
 * artwork records (which ARE images) and every text-only book in the library. A
 * reader went looking for a Fludd engraving and the book page rendered no gallery
 * at all, because *Utriusque Cosmi* vol. 2 had been OCR'd and translated and never
 * once offered to the vision model. Nothing could list the other books like it.
 *
 * ## What it reports — one status per live, non-artwork book
 *
 *   extracted        ≥1 `gallery_images` row. Done.
 *   unmaterialized   pages hold a gallery-grade detection (bbox, quality ≥ 0.5)
 *                    and there is no gallery row: extraction ran, the crop/sync
 *                    step did not. Repair is free:
 *                    `reextract-missed-pages.mjs --reconcile --book=<id> --apply`
 *   queue            extraction never ran (no `detected_images_count`, no
 *                    `images_done_at`) and the book has a page typed
 *                    illustration/diagram/map/frontispiece, or — with
 *                    `--markers` — a page carrying an OCR image marker. This is
 *                    the backfill work list.
 *   queue_weak       never ran, and the only candidate pages are typed
 *                    `title-page` or `mixed`. The worker would offer them, but
 *                    nearly every book has a title page: this is not evidence
 *                    of a plate, and it is kept out of the denominator.
 *   examined_empty   extraction ran over the book's candidate pages and nothing
 *                    reached the gallery. A measured zero, with one caveat the
 *                    table keeps visible: `strong_typed` counts its pages typed
 *                    illustration/diagram/map/frontispiece.
 *   no_candidates    the worker looked for candidate pages, found none, and
 *                    stamped `images_skipped_reason: no_candidates`. True of a
 *                    text-only book, and ALSO true of a book whose OCR vintage
 *                    left neither `page_type` nor markers (vol. 2 was this).
 *                    Not a measured zero. A book that has since gained typed
 *                    pages moves to `queue`.
 *   no_evidence      extraction never ran and no page is typed as a candidate.
 *                    Unknown until `--markers` reads the OCR. (A marker is the
 *                    worker's own candidate test, `<image-desc` or
 *                    `<detected-images>`; it then drops pages whose markers are
 *                    all trivial — stamps, ornaments — which this does not.)
 *   never_ocr        `pages_ocr` is 0. The worker's catch-up query requires OCR,
 *                    so these are invisible to it. Unknown.
 *
 * The headline is `extracted / (extracted + unmaterialized + queue)`: of the books
 * with positive evidence of illustration, how many have a gallery. The
 * unknown buckets (queue_weak, no_candidates, no_evidence, never_ocr) are printed
 * beside it and are NOT folded into either side —
 * an unexamined book is unjudged, not empty.
 *
 * ## Siblings: `work_id` alone overstates the queue
 *
 * The first Fludd shortlist was ~10 books; all but two turned out to be second
 * scans of works whose other copy already had hundreds of gallery images, filed
 * under a different `work_id`. So each queue row is checked against every
 * extracted book two ways: same `work_id`, and a shared byline name with
 * containing title tokens under the series guard of work-identity-util.mjs (which
 * is what keeps vol. 2 from matching vol. 1). A hit is reported in
 * `sibling_extracted` and the queue is counted both with and without them. It is
 * advisory — a second scan can still hold plates the first lacks. A book with no
 * byline, or a title that folds to fewer than two tokens (non-Latin scripts — the
 * tokenizer is ASCII — and one-word titles like "Works"), is reported as
 * `unjudged`, never as "no sibling".
 *
 * Read-only. Usage:
 *   node --env-file=.env.production.local scripts/audit/image-extraction-coverage.mjs
 *     [--out=FILE.tsv]   per-book rows for every status except `extracted`
 *     [--markers]        read OCR for image markers on `no_evidence` and
 *                        `queue_weak` books
 *                        (one bounded page query per book; minutes, not seconds)
 *     [--author=TEXT]    restrict to books whose `author` contains TEXT
 *     [--book=ID]        one book, printed in full
 *
 * Exits 2 if the database is unreachable — that is UNKNOWN, not clear.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { norm, sig, seriesKey } from '../lib/work-identity-util.mjs';

// Keep in step with IMAGE_CANDIDATE_PAGE_TYPES in scripts/workers/image-extract-worker.mjs.
export const CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];
// `mixed` and `title-page` are candidates to the worker but weak evidence of a plate.
export const STRONG_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece'];
// The gallery materializer's floor (materializeGalleryForBook / sync-gallery-images).
export const GALLERY_QUALITY_FLOOR = 0.5;

export const STATUSES = ['extracted', 'unmaterialized', 'queue', 'queue_weak', 'examined_empty', 'no_candidates', 'no_evidence', 'never_ocr'];

/** Mirror of isArtworkRecord() in src/lib/artwork-record.ts: an explicit non-artwork content_type wins. */
export function isArtworkRecord(b) {
  if (b.content_type && b.content_type !== 'artwork') return false;
  return b.content_type === 'artwork' || !!b.resource_type;
}

/**
 * One status per book. `ev` is the page-level evidence gathered for it:
 *   galleryRows, gradePages (pages with a gallery-grade detection),
 *   typedPages (candidate page_type), strongTyped (the subset that names a
 *   picture), markerPages (null = OCR not read).
 */
export function classify(book, ev) {
  if (ev.galleryRows > 0) return 'extracted';
  if (ev.gradePages > 0) return 'unmaterialized';
  const pa = book.pipeline_auto || {};
  const ran = book.detected_images_count != null || !!pa.images_done_at;
  if (ran) return 'examined_empty';
  if (!(book.pages_ocr > 0)) return 'never_ocr';
  if (ev.strongTyped > 0 || ev.markerPages > 0) return 'queue';
  if (ev.typedPages > 0) return 'queue_weak';
  if (pa.images_skipped_reason === 'no_candidates') return 'no_candidates';
  return 'no_evidence';
}

/**
 * Title tokens + series key + byline tokens. Either list is empty when its field
 * folds to nothing. Byline tokens are every name part of 4+ letters rather than
 * "the surname": the corpus writes one person as "Fludd, Robert", "Robert Fludd"
 * and "Fludd, R.", and a last-word surname reads those as three people.
 */
export function titleKey(book) {
  const title = book.display_title || book.title || '';
  return {
    tokens: sig(title),
    series: seriesKey(title),
    names: [...new Set(norm(book.author || '').split(' ').filter((t) => t.length >= 4))],
  };
}

/** Does every token of the shorter title appear in the longer one (≥2 shared), same series? */
export function sameWorkByTitle(a, b) {
  if (a.series !== b.series) return false;
  const [small, large] = a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  if (small.length < 2) return false;
  const set = new Set(large);
  return small.every((t) => set.has(t));
}

/**
 * For each queue book, the extracted book (if any) that looks like another copy of
 * the same work. Returns Map<bookId, { id, via: 'work_id'|'title' } | 'unjudged'>.
 */
export function findExtractedSiblings(queueBooks, extractedBooks) {
  const byWork = new Map();
  const byName = new Map();
  for (const b of extractedBooks) {
    if (b.work_id && !byWork.has(b.work_id)) byWork.set(b.work_id, b.id);
    const k = titleKey(b);
    if (k.tokens.length < 2) continue;
    for (const n of k.names) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push({ id: b.id, key: k });
    }
  }
  const out = new Map();
  for (const b of queueBooks) {
    if (b.work_id && byWork.has(b.work_id)) { out.set(b.id, { id: byWork.get(b.work_id), via: 'work_id' }); continue; }
    const k = titleKey(b);
    // The tokenizer is ASCII: a title or byline it cannot fold cannot be compared at all,
    // and one token is too little to call two books the same work.
    if (!k.names.length || k.tokens.length < 2) { out.set(b.id, 'unjudged'); continue; }
    const hit = k.names.flatMap((n) => byName.get(n) || []).find((c) => sameWorkByTitle(k, c.key));
    if (hit) out.set(b.id, { id: hit.id, via: 'title' });
  }
  return out;
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

async function main() {
  const args = process.argv.slice(2);
  const getArg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const OUT = getArg('out');
  const AUTHOR = getArg('author');
  const ONLY_BOOK = getArg('book');
  const MARKERS = args.includes('--markers');

  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(2); }
  let mc;
  try {
    mc = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 });
    await mc.connect();
  } catch (err) {
    console.error(`Cannot reach the database: ${err.message}`);
    process.exit(2);
  }
  const db = mc.db('bookstore');
  const t0 = Date.now();

  // Canonical "live" filter (visibility-and-stats.md). Artworks are removed after the
  // fetch, by isArtworkRecord, so they can be counted rather than silently dropped.
  const filter = { visible: true, pages_count: { $gt: 0 } };
  if (ONLY_BOOK) filter.id = ONLY_BOOK;
  if (AUTHOR) filter.author = { $regex: AUTHOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const live = await db.collection('books').find(filter, { projection: {
    id: 1, title: 1, display_title: 1, author: 1, work_id: 1, content_type: 1, resource_type: 1,
    pages_count: 1, pages_ocr: 1, detected_images_count: 1,
    'pipeline_auto.status': 1, 'pipeline_auto.images_done_at': 1, 'pipeline_auto.images_skipped_reason': 1,
  } }).toArray();
  const artworks = live.filter(isArtworkRecord).length;
  const books = live.filter((b) => !isArtworkRecord(b) && b.id);
  const noId = live.length - artworks - books.length;
  const ids = new Set(books.map((b) => b.id));
  // A filtered run asks the page collections about its own books only.
  const scoped = ONLY_BOOK || AUTHOR ? { book_id: { $in: [...ids] } } : {};

  const perBook = async (coll, match, extraGroup = {}) => {
    const m = new Map();
    const cur = db.collection(coll).aggregate(
      [{ $match: { ...scoped, ...match } }, { $group: { _id: '$book_id', n: { $sum: 1 }, ...extraGroup } }],
      { allowDiskUse: true },
    ).batchSize(1000);
    for await (const r of cur) if (ids.has(r._id)) m.set(r._id, r);
    return m;
  };

  const gallery = await perBook('gallery_images', {});
  console.error(`  gallery rows grouped (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  const grade = await perBook('pages', { detected_images: { $elemMatch: {
    bbox: { $exists: true }, detection_source: { $in: ['vision_model', 'manual', 'ocr_tag'] }, gallery_quality: { $gte: GALLERY_QUALITY_FLOOR },
  } } });
  console.error(`  gallery-grade detections grouped (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  const typed = await perBook('pages', { page_type: { $in: CANDIDATE_PAGE_TYPES }, page_number: { $gt: 0 } },
    { strong: { $sum: { $cond: [{ $in: ['$page_type', STRONG_PAGE_TYPES] }, 1, 0] } } });
  console.error(`  candidate page types grouped (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const evidence = (b) => ({
    galleryRows: gallery.get(b.id)?.n || 0,
    gradePages: grade.get(b.id)?.n || 0,
    typedPages: typed.get(b.id)?.n || 0,
    strongTyped: typed.get(b.id)?.strong || 0,
    markerPages: null,
  });
  const rows = books.map((b) => { const ev = evidence(b); return { book: b, ev, status: classify(b, ev) }; });

  if (MARKERS) {
    // The worker's own candidate regex, asked one book at a time on the book_id index.
    const targets = rows.filter((r) => r.status === 'no_evidence' || r.status === 'queue_weak');
    console.error(`  reading OCR markers for ${targets.length} no_evidence / queue_weak books…`);
    let done = 0;
    for (const r of targets) {
      r.ev.markerPages = await db.collection('pages').countDocuments({
        book_id: r.book.id, page_number: { $gt: 0 }, 'ocr.data': { $regex: '<detected-images>|<image-desc' },
      });
      r.status = classify(r.book, r.ev);
      if (++done % 500 === 0) console.error(`    ${done}/${targets.length}`);
    }
  }

  const queue = rows.filter((r) => r.status === 'queue');
  const siblings = findExtractedSiblings(queue.map((r) => r.book), rows.filter((r) => r.status === 'extracted').map((r) => r.book));
  for (const r of queue) r.sibling = siblings.get(r.book.id) || null;

  const count = Object.fromEntries(STATUSES.map((s) => [s, { books: 0, pages: 0 }]));
  for (const r of rows) { count[r.status].books++; count[r.status].pages += r.book.pages_count || 0; }
  const withSibling = queue.filter((r) => r.sibling && r.sibling !== 'unjudged');
  const unjudged = queue.filter((r) => r.sibling === 'unjudged');
  const evidenced = count.extracted.books + count.unmaterialized.books + count.queue.books;

  console.log(`\nImage-extraction coverage — ${new Date().toISOString().slice(0, 10)}${AUTHOR ? ` — author ~ "${AUTHOR}"` : ''}${ONLY_BOOK ? ` — book ${ONLY_BOOK}` : ''}`);
  console.log(`live records (visible, pages_count > 0): ${live.length}`);
  console.log(`  artwork records, excluded:             ${artworks}`);
  if (noId) console.log(`  records with no \`id\`, excluded:        ${noId}`);
  console.log(`  books audited:                         ${books.length}\n`);
  console.log('status           books    share    pages');
  for (const s of STATUSES) {
    console.log(`${s.padEnd(15)} ${String(count[s].books).padStart(6)}  ${pct(count[s].books, books.length).padStart(7)}  ${String(count[s].pages).padStart(8)}`);
  }
  console.log(`\nCoverage of books with evidence of illustration: ${count.extracted.books} / ${evidenced} = ${pct(count.extracted.books, evidenced)}`);
  console.log(`  (denominator = extracted + unmaterialized + queue; the unknown buckets below are on neither side)`);
  console.log(`Unknown — never judged: queue_weak ${count.queue_weak.books} (title-page/mixed pages only), no_candidates ${count.no_candidates.books}, no_evidence ${count.no_evidence.books}${MARKERS ? ' (after reading OCR markers)' : ' (OCR markers not read; --markers)'}, never_ocr ${count.never_ocr.books}`);
  console.log(`\nBackfill queue: ${queue.length} books, ${count.queue.pages} pages`);
  const typedQueue = queue.filter((r) => r.ev.strongTyped > 0).length;
  console.log(`  on a typed picture page: ${typedQueue}; on an OCR marker alone (may be a stamp or ornament): ${queue.length - typedQueue}`);
  console.log(`  another copy of the work is already extracted: ${withSibling.length} (${withSibling.filter((r) => r.sibling.via === 'work_id').length} by work_id, ${withSibling.filter((r) => r.sibling.via === 'title').length} by author + title)`);
  console.log(`  sibling check could not judge (no byline, or under two title tokens): ${unjudged.length}`);
  console.log(`  no extracted copy found: ${queue.length - withSibling.length - unjudged.length}`);
  const strongEmpty = rows.filter((r) => r.status === 'examined_empty' && r.ev.strongTyped > 0);
  console.log(`\nexamined_empty books holding pages typed ${STRONG_PAGE_TYPES.join('/')}: ${strongEmpty.length}`);
  console.log(`unmaterialized books are a free repair: reextract-missed-pages.mjs --reconcile --book=<id> --apply`);

  if (ONLY_BOOK) for (const r of rows) console.log(JSON.stringify({ status: r.status, ...r.ev, sibling: r.sibling, book: r.book }, null, 2));

  if (OUT) {
    const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').slice(0, 120);
    const order = (r) => STATUSES.indexOf(r.status);
    const lines = ['status\tbook_id\tpages_count\tpages_ocr\ttyped_pages\tstrong_typed\tmarker_pages\tgrade_pages\tdetected_images_count\tsibling_extracted\tsibling_via\twork_id\tauthor\ttitle'];
    for (const r of rows.filter((x) => x.status !== 'extracted').sort((a, b) => order(a) - order(b) || b.ev.strongTyped - a.ev.strongTyped || (b.book.pages_count || 0) - (a.book.pages_count || 0))) {
      const sib = r.sibling;
      lines.push([
        r.status, r.book.id, r.book.pages_count || 0, r.book.pages_ocr || 0, r.ev.typedPages, r.ev.strongTyped,
        r.ev.markerPages ?? '', r.ev.gradePages, r.book.detected_images_count ?? '',
        sib === 'unjudged' ? 'unjudged' : sib?.id || '', sib && sib !== 'unjudged' ? sib.via : '',
        clean(r.book.work_id), clean(r.book.author), clean(r.book.display_title || r.book.title),
      ].join('\t'));
    }
    writeFileSync(OUT, lines.join('\n') + '\n');
    console.log(`\nwrote ${lines.length - 1} rows → ${OUT}`);
  }
  console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await mc.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
