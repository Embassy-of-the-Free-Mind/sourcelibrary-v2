// PRIOR ART: scripts/lib/page-alignment.mjs checkAlignment — the dHash comparison this calls; it is a verdict for audits
//   and repairs (bulk-archive-alignment.mjs, repair-bulk-jp2-offset.mjs) and no reader asks it before reading.
// scripts/lib/pipeline-hold.mjs unsplitReadRefusal — the same shape of gate (a sentence, or null) for unsplit spreads;
//   it reads two book flags and cannot see an image set that sits off its source.
// scripts/workers/lib/erara-pdf-leaves.mjs — stops NEW e-rara PDF archives being written one leaf off; the 12,908 live
//   books archived before it (v3#466, 2026-11-17) carry no mark that says which are shifted.
/**
 * The image-set gate (v3#466): before a book's pages are read, are its stored page images the leaves their page rows
 * name?
 *
 * Two archive writers have stored a book's images one leaf off their page rows: the Internet Archive bulk JP2 archiver
 * (#3368) and the e-rara PDF archiver (#5803, e-rara's cover sheet stored as page 1). Text read from such a set agrees
 * with the image a reader sees today, and that is the trap: the first page is a scanner sheet read as the title page,
 * the page's source link and printed-page mapping name another leaf, and when the images are later put right every
 * page read meanwhile is left beside the wrong leaf (45 e-rara books, 2026-08-30 to 2026-10-01; the paid re-read of
 * #5309). No stored field tells a shifted set from a good one (measured on 40 books opened by eye, v3#466), so the
 * images are compared: `checkAlignment` over the pages each shift-prone writer wrote.
 *
 * Verdicts:
 *   not_applicable  no page of the book was written by a shift-prone writer (or too few to sample)
 *   aligned         at least one sampled page matched its own source leaf and none matched the next one
 *   shifted         at least one sampled page matched the NEXT archived image and none matched its own  → not read
 *   mixed           both kinds of match in one book: two mappings, a seam somewhere                      → not read
 *   unknown         no sampled page could be decided (source unreachable, uniform layout). Read, and recorded as
 *                   unverified: a gate that stopped on every unreachable source would stop the lane with the provider.
 *
 * The vote rule is repair-bulk-jp2-offset.mjs's ("some samples say shifted and none say aligned"), not checkAlignment's
 * unanimous verdict: dHash abstains on pages of one uniform layout, and one abstention must not turn a good book away.
 */
import { checkAlignment, hashBuffer } from './page-alignment.mjs';

/**
 * The writers that have stored images off their rows, and how each page's own source leaf is addressed at a small
 * size. The same two schemes as SOURCES in scripts/maintenance/repair-bulk-jp2-offset.mjs (which also holds the
 * full-size forms a repair needs); tests/unit/image-set-gate.test.ts ties the two together.
 */
export const SHIFT_PRONE_WRITERS = Object.freeze({
  bulk_jp2: Object.freeze({ re: /\/page\/n\d+/, small: (u) => String(u).replace(/\/full\/pct:\d+\//, '/full/pct:12/') }),
  erara_pdf: Object.freeze({ re: /e-rara\.ch\/i3f\/v21\/\d+\/full\//, small: (u) => String(u).replace(/\/full\/[^/]+\/0\//, '/full/400,/0/') }),
});

export const IMAGE_SET_SAMPLES = 5;
/** A writer needs this many unverified pages in the book before it is sampled (checkAlignment needs two interior pages). */
export const MIN_WRITER_PAGES = 3;

/** The Mongo projection `imageSetVerdict` needs of every page of the book. */
export const IMAGE_SET_PAGE_PROJECTION = Object.freeze({ page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, 'archive_metadata.source': 1, 'archive_metadata.pdf_leaf_offset': 1 });
/** …and of the book. */
export const IMAGE_SET_BOOK_PROJECTION = Object.freeze({ id: 1, 'archive_metadata.jp2_offset_repaired': 1, 'archive_metadata.jp2_offset_post_verdict': 1 });

/** Pure: a page whose image mapping is already established by its writer (the e-rara archiver's count check, #5803). */
export const hasVerifiedMapping = (page) => Number.isInteger(page?.archive_metadata?.pdf_leaf_offset);

/** Pure: the verdict of one writer's votes. */
export function verdictOfVotes(votes) {
  const { aligned = 0, shift = 0 } = votes ?? {};
  if (aligned > 0 && shift > 0) return 'mixed';
  if (shift > 0) return 'shifted';
  if (aligned > 0) return 'aligned';
  return 'unknown';
}

/** Pure: the book's verdict from its writers' verdicts. The worst one decides. */
export function combineVerdicts(verdicts) {
  for (const v of ['shifted', 'mixed', 'unknown', 'aligned']) if (verdicts.includes(v)) return v;
  return 'not_applicable';
}

// 20 s a fetch: a sample whose source does not answer is dropped (checkAlignment), so a provider that hangs costs a book
// at most samples × 20 s before it is read as `unknown`, not the lane's hour.
const defaultHashUrl = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'sourcelibrary-image-set-gate' } });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return hashBuffer(Buffer.from(await r.arrayBuffer()));
};

/**
 * The verdict for one book. `pages`: every page of the book (IMAGE_SET_PAGE_PROJECTION), any order. `book`:
 * IMAGE_SET_BOOK_PROJECTION, or null. Makes at most 3 × `samples` image fetches a writer, each URL once.
 * @returns {Promise<{ verdict: string, writers: Record<string, { verdict: string, pages: number, votes: object }>, method: string, checked_at: string }>}
 */
export async function imageSetVerdict(pages, book = null, { hashUrl = defaultHashUrl, samples = IMAGE_SET_SAMPLES, now = () => new Date() } = {}) {
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
  const cache = new Map();
  const hashOnce = (url) => { if (!cache.has(url)) cache.set(url, hashUrl(url)); return cache.get(url); };
  const repaired = imageSetRepaired(book);
  const writers = {};
  for (const [name, w] of Object.entries(SHIFT_PRONE_WRITERS)) {
    const mine = sorted.filter((p) => p.archive_metadata?.source === name && !hasVerifiedMapping(p));
    if (mine.length < MIN_WRITER_PAGES) continue;
    if (repaired) { writers[name] = { verdict: 'aligned', pages: mine.length, votes: null, by: 'jp2_offset_repaired' }; continue; }
    const a = await checkAlignment(sorted, {
      hashUrl: hashOnce,
      sourceUrlFor: (p) => w.small(p.photo_original || p.photo),
      isUsableSource: (p) => w.re.test(String(p.photo_original || p.photo)),
      candidates: mine,
      samples,
    });
    writers[name] = { verdict: verdictOfVotes(a.votes), pages: mine.length, votes: a.votes };
  }
  return { verdict: combineVerdicts(Object.values(writers).map((x) => x.verdict)), writers, method: `dhash-vs-source/${samples}`, checked_at: now().toISOString() };
}

/**
 * The verdict for a book by id, read from Mongo, memoised in `cache` (a Map, or a plain object a caller persists
 * beside its reads so a resumed run does not fetch the images again).
 */
export async function bookImageSet(db, bookId, cache = new Map(), opts = {}) {
  const get = (k) => (cache instanceof Map ? cache.get(k) : cache[k]);
  const set = (k, v) => (cache instanceof Map ? cache.set(k, v) : (cache[k] = v));
  if (get(bookId)) return get(bookId);
  const book = await db.collection('books').findOne({ id: bookId }, { projection: IMAGE_SET_BOOK_PROJECTION });
  const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: 0 } }, { projection: { _id: 0, ...IMAGE_SET_PAGE_PROJECTION } }).toArray();
  const v = await imageSetVerdict(pages, book, opts);
  set(bookId, v);
  return v;
}

/** Why a book with this verdict may not be read (a sentence), or null. */
export function imageSetReadRefusal(v) {
  if (v?.verdict === 'shifted') return 'the stored page images sit one leaf off their page rows (image-set gate, v3#466): re-archive the book from its source before it is read';
  if (v?.verdict === 'mixed') return 'the stored page images follow two mappings in one book (image-set gate, v3#466): re-archive the book from its source before it is read';
  return null;
}

/** Pure: the book carries the repair stamp `imageSetVerdict` trusts without sampling. */
export const imageSetRepaired = (book) => book?.archive_metadata?.jp2_offset_repaired === true && book.archive_metadata.jp2_offset_post_verdict === 'aligned';

/*
 * THE LANE SIDE (v3#466, 2026-11-18). The gate above refuses inside the reader, after a lane has drawn the book, charged
 * its pages to the run's page budget and, when the reader comes back with nothing, written them into its "tried, never
 * tried again" ledger. The Latin first-read lane drew the same 26 to 40 shifted e-rara books first every hour, spent
 * its whole budget on refusals for 21 runs on two pools, and wrote off about 42,000 pages of books that will be
 * readable once their images are re-cut. So a lane asks before it draws: `imageSetLaneStep` says read, wait or check,
 * the lane keeps each verdict in one file beside its ledger, and a refused book costs neither budget nor ledger rows.
 */

/** A recorded refusal is honoured this long, then the book is sampled again. A repair stamps the book, which lifts it at once. */
export const IMAGE_SET_RECHECK_DAYS = 7;

/**
 * The Mongo match of the books the gate would sample, among `bookIds`: one of rows 2 to 4 written by a shift-prone
 * writer with no count-checked mapping (`hasVerifiedMapping`). Three early rows stand for the book, so the query stays
 * on pages_book_pagenum_idx; a book it misses is still refused by the reader, as before.
 */
export const shiftPronePageMatch = (bookIds) => ({
  book_id: { $in: bookIds }, page_number: { $in: [2, 3, 4] },
  'archive_metadata.source': { $in: Object.keys(SHIFT_PRONE_WRITERS) }, 'archive_metadata.pdf_leaf_offset': null,
});

/** Pure: a verdict that decides for IMAGE_SET_RECHECK_DAYS. `unknown` is kept too, but only for a day (imageSetLaneStep). */
export const isSettledVerdict = (verdict) => ['shifted', 'mixed', 'aligned', 'not_applicable'].includes(verdict);

/**
 * Pure: what a lane does with a book before it draws it.
 *   read   the gate has nothing to sample, the book is repaired, or a recent check found it aligned
 *   wait   a recent check refused it: not drawn, nothing fetched, nothing charged
 *   check  ask the gate now (`checksLeft` > 0)
 *   later  the run has made its checks: the book waits for a later run, unread and unledgered
 * `known`: the last kept verdict `{ verdict, at }`, or null. The cap on checks is what keeps a lane with ten thousand
 * unchecked books from fetching fifteen sample images for each of them from the source in one hour.
 */
export function imageSetLaneStep({ shiftProne, book = null, known = null, checksLeft = 0, now = Date.now(), days = IMAGE_SET_RECHECK_DAYS }) {
  if (!shiftProne || imageSetRepaired(book)) return 'read';
  const age = known?.at ? now - Date.parse(known.at) : Infinity;
  if (age < days * 86_400_000 && imageSetReadRefusal(known)) return 'wait';
  if (age < days * 86_400_000 && isSettledVerdict(known.verdict)) return 'read';
  // `unknown` (source unreachable, or pages too alike to tell): the reader reads the book as unverified, as it always
  // has. Asked again after a day, not every run, or forty such books at the head of the order would take every check.
  if (age < 86_400_000 && known.verdict === 'unknown') return 'read';
  return checksLeft > 0 ? 'check' : 'later';
}

/**
 * Pure: the ledger rows a refusal wrote off, to be released. `ledgerText`: a lane ledger (jsonl; rows carry page_id,
 * book_id, outcome, why). `refusedBooks`: a Set of book ids the gate refused. A page counts when its LAST row is
 * `failed` / `not_read` (the reader returned nothing for it) and its book is in the set: a later `written`, another
 * failure or an earlier release leaves it alone. Returns one `{ page_id, book_id, page_number }` a page.
 */
export function gateWriteOffs(ledgerText, refusedBooks) {
  const last = new Map();
  for (const line of String(ledgerText).split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.page_id) last.set(r.page_id, r);
  }
  return [...last.values()]
    .filter((r) => r.outcome === 'failed' && r.why === 'not_read' && refusedBooks.has(r.book_id))
    .map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number ?? null }));
}

/** What a page's read records about the gate (engine.input.image_set): small, and enough to audit. */
export function imageSetRecord(v) {
  if (!v || v.verdict === 'not_applicable') return null;
  return { verdict: v.verdict === 'unknown' ? 'unverified' : v.verdict, method: v.method, checked_at: v.checked_at, writers: Object.fromEntries(Object.entries(v.writers).map(([k, x]) => [k, x.votes ?? x.by])) };
}
