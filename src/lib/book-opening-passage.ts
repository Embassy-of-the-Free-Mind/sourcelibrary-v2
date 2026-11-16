/**
 * One short passage of a book's own words, in English, for the book's front page (#103).
 *
 * PRIOR ART: src/lib/quote-text.ts resolveQuoteText — decides WHICH text of a page is quotable and
 * takes the translator model's commentary out; this module calls it and adds the two things it does
 * not do: choose a page, and choose one prose paragraph on it. src/lib/page-json-ld.ts — the reader's
 * `text` excerpt is the first 500 characters of a page, headings and running heads included, which is
 * fine as structured data and wrong as a quotation set in front of a reader.
 *
 * WHY. A front page carried a summary, a guide and a contents list, all written ABOUT the book, and
 * not one sentence OF it (measured 2026-11-12 on five books: 0 bytes). A person who searched for what
 * an author said, and a crawler that fetches a couple of hundred of our pages a day without running
 * JavaScript, both met our description and never the source.
 *
 * WHAT MAY BE SHOWN. Only text a signed-out reader is already given at the page's own URL:
 *  - a page inside the free sample (src/lib/free-preview.ts), whether or not the meter is on, so the
 *    link under the passage never lands on a sign-in wall;
 *  - a page the reader lists (src/lib/reader-pages.ts);
 *  - the stored English translation as the quote door serves it (so a withheld translation, or an
 *    English leaf's machine rewording, yields nothing);
 *  - never a page marked unreadable, never a page a stored check has a warning on, never a book the
 *    pipeline holds (containment-on-finding.md) or one still served as unsplit spreads.
 * The passage is a paragraph taken whole from the page, cut only at a sentence end; nothing is
 * reworded, joined across paragraphs or pages, or modernised.
 *
 * A book that yields nothing shows nothing. That is the common, correct outcome for a book whose free
 * sample is front matter.
 */
import type { Db } from 'mongodb';
import type { Page } from '@/lib/types';
import { resolveQuoteText } from '@/lib/quote-text';
import { readerPageListFilter, isReaderListedPage } from '@/lib/reader-pages';
import { freeMaxPage, isPageFree } from '@/lib/free-preview';
import { englishFraction, isEnglishOriginalPage, ENGLISH_SOURCE_THRESHOLD } from '@/lib/english-page-language';
import { NEVER_TRANSLATED_PAGE_TYPES } from '@/lib/page-counts';

export interface OpeningPassage {
  /** The paragraph, verbatim from the page's translation, emphasis marks removed. */
  text: string;
  /** True when the paragraph ran on past `text` (cut at a sentence end). */
  truncated: boolean;
  pageId: string;
  pageNumber: number;
  /** The page it came from, for the provenance line (isUnreviewedMachineTranslation, textProducedAt). */
  page: Pick<Page, 'ocr' | 'translation' | 'split_from'>;
}

export interface OpeningPassageBook {
  id: string;
  pages_count?: number | null;
  pages_translated?: number | null;
  language?: unknown;
  needs_splitting?: boolean;
  split_completed?: boolean;
}

/** Pages a passage is never taken from: apparatus and front matter, where the first prose is not the work's. */
export const PASSAGE_SKIP_PAGE_TYPES: ReadonlySet<string> = new Set([
  ...NEVER_TRANSLATED_PAGE_TYPES,
  'cover', 'title-page', 'half-title', 'frontispiece', 'toc', 'table_of_contents', 'index', 'errata',
  'colophon', 'illustration', 'plate', 'map', 'diagram', 'table', 'advertisement', 'imprimatur', 'privilege',
  'archived-spread',
]);

export const PASSAGE_MAX_CHARS = 600;
export const PASSAGE_MIN_CHARS = 150;
export const PASSAGE_MIN_WORDS = 25;
/** How far past the starting page the loader looks, and how many pages it loads. */
const SCAN_SPAN_PAGES = 40;
const SCAN_LIMIT = 8;

export const OPENING_PASSAGE_PAGE_PROJECTION = {
  _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, printed_page: 1, repeat_of: 1, split_from: 1,
  seo_indexable: 1, translation: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'ocr.model': 1, 'ocr.source': 1,
} as const;

/** The first page worth looking at: the first chapter when it is inside the free sample, else page 1. */
export function passageStartPage(pagesCount: number, firstChapterPage?: number | null): number {
  const max = freeMaxPage(pagesCount);
  return typeof firstChapterPage === 'number' && firstChapterPage >= 1 && firstChapterPage <= max ? firstChapterPage : 1;
}

const TERM_TAG_RE = /<\/?term>/gi;
// Layout marks the translation carries: `->centred<-` lines.
const CENTRED_RE = /^\s*->[\s\S]*<-\s*$/;

/** One paragraph, ready to show, or null when it is not running prose in English. */
export function passageParagraph(raw: string): string | null {
  if (CENTRED_RE.test(raw)) return null;
  let p = raw.replace(TERM_TAG_RE, '');
  // Anything still marked up is apparatus, a table, a heading, a note the layer split left in place,
  // or a bracketed editorial remark: not the author's running words.
  // Square brackets are the translator's supplements and doubts: a passage that needs them is not
  // one to set in front of a first-time reader.
  if (/[<>|[\]]|^\s*(#|[-*+]\s|\d+[.)]\s|\(\d+\))/m.test(p)) return null;
  // Three or more lines in one paragraph is verse or a list; joined into one line it would read as prose.
  if (p.trim().split(/\n/).length >= 3) return null;
  // A footnote call ("errors. 1) But"), or an argument line ("The return. — First meeting. — ...").
  if (/\s\d+\)\s/.test(p) || (p.match(/[.!?]\s*—\s/g) || []).length >= 2) return null;
  if (/\.{4,}|(?:\. ){4,}|…{2,}/.test(p)) return null; // dot leaders: a contents line
  // Emphasis marks only; the words between them stay.
  p = p.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1').replace(/(^|[\s(“"'])_([^_\n]+)_(?=$|[\s).,;:!?”"'])/g, '$1$2');
  if (/[*_`\\]/.test(p)) return null;
  p = p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  if (p.length < PASSAGE_MIN_CHARS) return null;
  const words = p.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < PASSAGE_MIN_WORDS) return null;
  // Mostly letters: a run of figures, sigla or untranslated script is not a readable passage.
  const letters = (p.match(/[A-Za-z]/g) || []).length;
  if (letters / p.length < 0.7) return null;
  // A dedication's address or a title set in capitals.
  if ((p.match(/[A-Z]/g) || []).length / letters > 0.12 || /&c\./.test(p)) return null;
  const frac = englishFraction(p, PASSAGE_MIN_WORDS);
  if (frac === null || frac < ENGLISH_SOURCE_THRESHOLD) return null;
  // A list of names or a litany repeats few words, or none: prose sits between.
  if (new Set(words).size / words.length < 0.3) return null;
  // Must read as sentences: start with a capital or an opening quote, hold a full stop.
  // ("CHere begins": a pilcrow or initial read as a letter.)
  if (!/^[“"'‘(]?[A-Z]/.test(p) || /^[A-Z]{2}[a-z]/.test(p) || !/[.!?]/.test(p)) return null;
  return p;
}

/** Cut at the last sentence end at or before `max`; the whole paragraph when it fits. */
export function cutAtSentence(p: string, max = PASSAGE_MAX_CHARS): { text: string; truncated: boolean } | null {
  if (p.length <= max) {
    // A paragraph that stops mid-sentence continues on the next page: keep its complete sentences.
    if (/[.!?]["”'’)]?$/.test(p)) return { text: p, truncated: false };
  }
  const head = p.slice(0, max + 1);
  let cut = -1;
  const re = /[.!?]["”'’)]?(?=\s+["“'‘(]?[A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) {
    const end = m.index + m[0].length;
    // "St. Paul", "c. 1500", "i. e.": a full stop after a one- or two-letter word is not a sentence end.
    if (/(?:^|\s)[A-Za-z]{1,2}\.$/.test(head.slice(0, end)) || /\b(?:viz|etc|cf|vol|chap|cap|lib|fol|Mr|Dr|St|Mrs)\.$/i.test(head.slice(0, end))) continue;
    if (end <= max) cut = end;
  }
  if (cut < PASSAGE_MIN_CHARS) return null;
  return { text: p.slice(0, cut), truncated: true };
}

/**
 * The passage for this book from the pages given (in page order), or null. Pure.
 * `warnedPages`: page numbers a stored check has a current warning on (getQualityWarnings().pages).
 */
export function pickOpeningPassage(
  pages: readonly Page[],
  book: OpeningPassageBook,
  { warnedPages }: { warnedPages?: Readonly<Record<number, unknown>> } = {},
): OpeningPassage | null {
  if (!book.pages_count || book.pages_count <= 0) return null;
  if (book.needs_splitting === true && book.split_completed !== true) return null;
  for (const page of pages) {
    if (!page?.id || typeof page.page_number !== 'number' || page.page_number < 1) continue;
    if (!isReaderListedPage(page)) continue;
    // The free-sample rule by page NUMBER only: `seo_indexable` widens what is free, but an indexed
    // page deep in the book is not the opening, and the loader does not range that far anyway.
    if (!isPageFree({ page_number: page.page_number }, book.pages_count)) continue;
    if (page.page_type && PASSAGE_SKIP_PAGE_TYPES.has(page.page_type)) continue;
    if (page.ocr?.unreadable) continue;
    if (warnedPages && warnedPages[page.page_number]) continue;
    // A leaf already printed in English (an editor's preface in a Welsh or Pali edition): its stored
    // "translation" is a model's rewording of English, not a translation (#7100).
    if (isEnglishOriginalPage(page.ocr?.data)) continue;
    const quotable = resolveQuoteText(page, book.id, 'en', { mark: false, book });
    if (!quotable || quotable.source !== 'translation' || quotable.lang !== 'en') continue;
    for (const raw of quotable.text.split(/\n\s*\n/)) {
      const para = passageParagraph(raw);
      if (!para) continue;
      const cut = cutAtSentence(para);
      if (!cut) continue;
      return {
        ...cut,
        pageId: page.id,
        pageNumber: page.page_number,
        page: { ocr: page.ocr, translation: page.translation, split_from: page.split_from },
      };
    }
  }
  return null;
}

/**
 * The candidate pages for `pickOpeningPassage`: up to eight translated pages from the start of the
 * work, inside the free sample. One indexed range read on {book_id, page_number} plus one book lookup
 * for the hold marker (the book page's own projection leaves `pipeline_auto` out). Returns [] for a
 * held or untranslated book. Throws on a failed read: the caller decides what a failure shows.
 */
export async function loadOpeningPassageCandidates(
  db: Db,
  book: OpeningPassageBook,
  firstChapterPage?: number | null,
): Promise<Page[]> {
  const pagesCount = book.pages_count || 0;
  if (pagesCount <= 0 || !(book.pages_translated && book.pages_translated > 0)) return [];
  if (book.needs_splitting === true && book.split_completed !== true) return [];
  const start = passageStartPage(pagesCount, firstChapterPage);
  const end = Math.min(freeMaxPage(pagesCount), start + SCAN_SPAN_PAGES);
  const [held, pages] = await Promise.all([
    db.collection('books').findOne(
      { id: book.id, 'pipeline_auto.hold': { $exists: true } },
      { projection: { _id: 1 }, maxTimeMS: 3000 },
    ),
    db.collection('pages')
      .find(
        { ...readerPageListFilter(book.id), page_number: { $gte: start, $lte: end }, 'translation.data': { $exists: true, $ne: '' } },
        { projection: OPENING_PASSAGE_PAGE_PROJECTION },
      )
      .sort({ page_number: 1 })
      .limit(SCAN_LIMIT)
      .maxTimeMS(3000)
      .toArray(),
  ]);
  if (held) return [];
  return pages as unknown as Page[];
}
