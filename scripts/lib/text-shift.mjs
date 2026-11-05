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
import { stripMarkupTags } from './strip-markup-tags.mjs';

/**
 * The fields that travel with a page's text. Mirrors
 * repair-erara-text-shift.mjs exactly: the two text payloads, their
 * derivatives, and the layout metadata OCR produces alongside them.
 */
// translation_withheld, translation_es and translations belong to the text too (#7949): the
// segment repair moved the text without them, leaving three contained pages' markers on the
// wrong slots and their OCR looking untranslated, i.e. queued for a paid re-translation.
export const SHIFT_FIELDS = ['ocr', 'translation', 'translation_summary', 'translation_keywords', 'page_type', 'columns', 'translation_withheld', 'translation_es', 'translations'];

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

/**
 * Moves for a book whose text sits a DIFFERENT number of leaves off in different
 * stretches (#7949: e-rara's PDF had a cover sheet in front and one leaf photographed
 * twice, so the text is one leaf late up to that leaf and three late after it).
 *
 * `segments` say, for each stretch of TARGET slots, which slot holds its text:
 * slot t in [from, to] takes the text now on slot t + delta. A target whose source
 * slot does not exist is cleared (its leaf was never read). Slots outside every
 * segment are not touched. Sources are read from the pre-move state, so moves never
 * chain. Segments must not overlap.
 *
 * @param {Array<object>} pages
 * @param {Array<{from:number, to:number, delta:number}>} segments
 * @returns {Array<{page_number:number, src_page_number:number|null, cleared:boolean, set:object, unset:string[]}>}
 */
export function computeSegmentMoves(pages, segments) {
  const sortedSeg = [...segments].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sortedSeg.length; i++) {
    const s = sortedSeg[i];
    if (!Number.isInteger(s.from) || !Number.isInteger(s.to) || !Number.isInteger(s.delta) || s.from > s.to) throw new Error(`bad segment ${JSON.stringify(s)}`);
    if (i && sortedSeg[i - 1].to >= s.from) throw new Error('segments overlap');
  }
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const moves = [];
  for (const seg of sortedSeg) {
    for (let t = seg.from; t <= seg.to; t++) {
      if (!byNum.has(t)) continue;
      const src = byNum.get(t + seg.delta);
      const set = {};
      const unset = [];
      for (const f of SHIFT_FIELDS) {
        if (src && src[f] !== undefined) set[f] = src[f];
        else unset.push(f);
      }
      moves.push({ page_number: t, src_page_number: src ? src.page_number : null, cleared: !src, set, unset });
    }
  }
  return moves;
}

/** Parse "1-79:+1,80-4162:+3" into segments. */
export function parseSegments(spec) {
  return String(spec).split(',').map((part) => {
    const m = part.trim().match(/^(\d+)-(\d+):([+-]?\d+)$/);
    if (!m) throw new Error(`bad segment "${part}" (want FROM-TO:+DELTA)`);
    return { from: Number(m[1]), to: Number(m[2]), delta: Number(m[3]) };
  });
}

/**
 * Re-point `books.chapters` after a segment move (#5803). A chapter derived while the text sat
 * on the wrong slot points where its heading USED to be: after `t ← t+delta`, a chapter that
 * started on n = t+delta now has its heading on t. A chapter moves only when the heading is on
 * the new slot and NOT on the old one (`headingOn(pageNumber, title)` decides, over the CURRENT
 * text); the rest are returned untouched. `endPage` follows its successor's start.
 *
 * @param {Array<{title:string, pageNumber:number, pageId?:string, endPage?:number}>} chapters
 * @param {Array<{from:number, to:number, delta:number}>} segments
 * @param {(pageNumber:number, title:string) => boolean} headingOn
 * @param {(pageNumber:number) => string|undefined} idOf page id at a page number
 */
export function repointChapters(chapters, segments, headingOn, idOf) {
  const moved = [];
  const out = chapters.map((c) => ({ ...c }));
  for (const c of out) {
    const seg = segments.find((s) => c.pageNumber - s.delta >= s.from && c.pageNumber - s.delta <= s.to);
    if (!seg) continue;
    const to = c.pageNumber - seg.delta;
    if (!headingOn(to, c.title) || headingOn(c.pageNumber, c.title)) continue;
    moved.push({ title: c.title, from: c.pageNumber, to });
    c.pageNumber = to;
    const id = idOf(to);
    if (id && c.pageId !== undefined) c.pageId = id;
  }
  const starts = new Map(moved.map((m) => [m.from, m.to]));
  for (const c of out) if (Number.isInteger(c.endPage) && starts.has(c.endPage + 1)) c.endPage = starts.get(c.endPage + 1) - 1;
  return { chapters: out, moved };
}

/** Heading test for repointChapters: the title's first four long words all occur in the text. */
export function headingInText(title, text) {
  const norm = (s) => stripMarkupTags(String(s || '')).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ');
  const words = norm(title).split(' ').filter((w) => w.length > 3).slice(0, 4);
  const t = norm(text);
  return words.length > 0 && words.every((w) => t.includes(w));
}
