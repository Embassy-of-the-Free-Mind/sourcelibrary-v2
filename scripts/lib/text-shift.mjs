/**
 * Pure transform for the p(N+1) -> p(N) text-shift repair.
 *
 * Two incidents produced a book whose stored TEXT runs one leaf behind the true
 * page sequence: the e-rara cover-sheet offset (#3186, repaired by
 * scripts/maintenance/repair-erara-text-shift.mjs) and the bulk-JP2 zip-ordinal
 * offset (#3368) for pages whose OCR was transcribed FROM the shifted archive.
 * In both cases the correct text for page N currently sits on page N+1, so the
 * repair moves the text fields one page left and clears the last page of each
 * affected run (its text was never produced).
 *
 * This module is the deterministic core of that repair, extracted so it can be
 * unit-tested without a database: given the page docs, produce the list of
 * moves. All I/O — snapshots to page_revisions, bulk writes, book_events —
 * stays in the calling script.
 *
 * IMPORTANT: deciding WHETHER a book should be shifted is not this module's
 * job. The caller must establish (via the dHash alignment check in
 * scripts/lib/page-alignment.mjs) that the book really is shift+1, and passes
 * that verdict in. Anything other than 'shift+1' produces zero moves — fail
 * closed, so a miswired caller cannot shift an aligned book.
 */

/**
 * The fields that travel with a page's text. Mirrors
 * repair-erara-text-shift.mjs exactly: the two text payloads, their
 * derivatives, and the layout metadata OCR produces alongside them.
 */
export const SHIFT_FIELDS = ['ocr', 'translation', 'translation_summary', 'translation_keywords', 'page_type', 'columns'];

/**
 * Compute the moves for a p(N+1) -> p(N) text shift.
 *
 * Unlike the e-rara repair (whole-book shift — every page came from the same
 * offset PDF), a bulk-JP2 book is often archived by several paths: only the
 * pages the bulk archiver wrote are shifted, and pages archived per-page from
 * IIIF are aligned and must not move. So the shift operates on the TARGET
 * subset only, and a target page may pull text from its successor only when
 * that successor is itself a target — a non-target successor holds the text of
 * its own (correct) leaf, not the leaf the target page needs. Target pages
 * whose successor is missing or non-target are CLEARED: the text they need was
 * never transcribed anywhere (`cleared: true`; the caller flags them for
 * re-OCR).
 *
 * @param {Array<object>} pages  ALL page docs of the book (any order; sorted
 *                               internally by page_number). Non-target pages
 *                               are needed to resolve run boundaries.
 * @param {object}  opts
 * @param {string}  opts.verdict   alignment verdict from checkAlignment();
 *                                 anything but 'shift+1' -> zero moves.
 * @param {(p:object)=>boolean} [opts.isTarget]  which pages the defective
 *                                 writer produced; defaults to
 *                                 archive_metadata.source === 'bulk_jp2'.
 * @returns {Array<{page_number:number, src_page_number:number|null, cleared:boolean, set:object, unset:string[]}>}
 *   One move per target page. `set` holds the field values to write (taken
 *   from the successor), `unset` the fields to remove (successor lacks them,
 *   or the page is cleared). Field-wise, exactly like the e-rara repair: a
 *   field the successor doesn't carry is unset rather than left stale.
 */
export function computeTextShiftMoves(pages, { verdict, isTarget } = {}) {
  if (verdict !== 'shift+1') return [];
  const target = isTarget ?? (p => p?.archive_metadata?.source === 'bulk_jp2');
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
  const byNum = new Map(sorted.map(p => [p.page_number, p]));

  const moves = [];
  for (const p of sorted) {
    if (!target(p)) continue;
    const src = byNum.get(p.page_number + 1);
    const srcUsable = Boolean(src && target(src));
    const set = {};
    const unset = [];
    for (const f of SHIFT_FIELDS) {
      if (srcUsable && src[f] !== undefined) set[f] = src[f];
      else unset.push(f);
    }
    moves.push({
      page_number: p.page_number,
      src_page_number: srcUsable ? src.page_number : null,
      cleared: !srcUsable,
      set,
      unset,
    });
  }
  return moves;
}
