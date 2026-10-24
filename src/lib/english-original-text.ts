/**
 * On an English-original page, the author's words are the transcription (#7100).
 *
 * PRIOR ART: src/lib/quote-text.ts (resolveQuoteText) — decides which text a
 * page quotes, but trusts `translation.data` whenever it exists, which is the
 * bug; src/lib/english-page-language.ts (isEnglishOriginalPage) and
 * src/lib/page-counts.ts (isEnglishOriginal) — the per-page and per-book
 * tests, reused here rather than re-derived.
 *
 * Before #5384 (2026-09-30) the translate lanes ran English pages through the
 * translator, so 2,173 public English books hold a stored "translation" that is
 * a model's rewording of an English page. Every door that prefers
 * `translation.data` over `ocr.data` — the reader, `/quote`, `/text`, exports,
 * and the MCP tools built on them — then served and cited that rewording as the
 * author's text. Hall, *Secret Teachings* p.40: "WHEN confronted with a problem
 * involving the use of the reasoning faculties…" was served as "When faced with
 * a problem that requires the use of reason…" (measured 2026-10-21: 446 books
 * read as paraphrase, 782 as a light spelling edit, 719 as a near-copy).
 *
 * The rule, applied at READ time and nowhere written back (no data changes):
 *
 * - A page on an English-original BOOK whose LEAF is English
 *   (`isEnglishOriginalPage` on its OCR) serves no `translation`. Every
 *   downstream reader of `translation.data` then falls through to the OCR the
 *   way it already does for an English page that was never translated.
 * - A bilingual edition keeps its real translations: the test is per page, so
 *   a Latin leaf facing the English keeps the English rendering of the Latin.
 * - Where the stored text is only a LIGHT edit of the transcription (word-bigram
 *   overlap >= MODERNIZED_SPELLING_MIN_OVERLAP), the reader may offer it as
 *   `modernized_spelling` — labelled, off by default, never as "Translation",
 *   never in a citation. A rewrite below that line is not shown at all.
 *
 * `modernized_spelling` is a SERVED-ONLY field: computed here on the way out,
 * never stored. Nothing that cites or exports may read it.
 */
import { isEnglishOriginalPage } from '@/lib/english-page-language';
import { isEnglishOriginal } from '@/lib/page-counts';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

/** The book fields the decision reads. Project these wherever a door loads the book. */
export const ENGLISH_ORIGINAL_BOOK_PROJECTION = {
  language: 1,
  'translation_state.english_original': 1,
} as const;

export interface EnglishOriginalBookFields {
  language?: unknown;
  translation_state?: { english_original?: boolean | null } | null;
}

/**
 * Is this book an English edition? The stamped `translation_state.english_original`
 * when present, else the same first-language test that stamps it — so an
 * unstamped book is not let through.
 */
export function isEnglishOriginalBook(book: BookLike): boolean {
  if (!book) return false;
  const b = book as EnglishOriginalBookFields;
  const stamped = b.translation_state?.english_original;
  if (typeof stamped === 'boolean') return stamped;
  return isEnglishOriginal(b.language);
}

type TextField = { data?: unknown } | null | undefined;
interface PageTexts {
  ocr?: TextField;
  translation?: TextField;
}
/**
 * Any book or page document — a typed `Book`/`Page`, a projected Mongo
 * `Document`. The fields read are the ones above; `object` keeps both shapes
 * assignable without a cast at every door.
 */
type BookLike = object | null | undefined;
type PageLike = object;

/**
 * True when this page's stored `translation` must NOT be served: the book is an
 * English edition, the leaf is English, and there is a transcription to serve
 * in its place. A page with no OCR keeps whatever it has — withholding the only
 * text would leave the reader with nothing.
 */
export function servesTranscriptionInsteadOfTranslation(
  pageDoc: PageLike | null | undefined,
  book: BookLike,
): boolean {
  if (!pageDoc) return false;
  const page = pageDoc as PageTexts;
  const ocr = typeof page.ocr?.data === 'string' ? page.ocr.data : '';
  const tr = typeof page.translation?.data === 'string' ? page.translation.data : '';
  if (!tr || !ocr.trim()) return false;
  if (!isEnglishOriginalBook(book)) return false;
  return isEnglishOriginalPage(ocr);
}

/** Overlap at or above which the stored text is a light (spelling) edit — #7100's bins. */
export const MODERNIZED_SPELLING_MIN_OVERLAP = 0.6;

function bigrams(text: string): Set<string> {
  const words = stripEditorialWrappers(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/ſ/g, 's')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z]+/g) ?? [];
  const out = new Set<string>();
  for (let i = 1; i < words.length; i++) out.add(`${words[i - 1]} ${words[i]}`);
  return out;
}

/**
 * Word-bigram overlap (Dice over the two bigram SETS) of a stored text against
 * the transcription, editorial wrappers and tags stripped first. 1 is a copy;
 * a paraphrase of the same page lands near 0.3–0.5. Null when either side has
 * too few words to judge.
 */
export function wordBigramOverlap(stored: string, ocr: string, minBigrams = 20): number | null {
  const a = bigrams(stored);
  const b = bigrams(ocr);
  if (a.size < minBigrams || b.size < minBigrams) return null;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** The served-only "Modernized spelling" view of an English-original page. */
export interface ModernizedSpellingView {
  data: string;
  /** Word-bigram overlap with the transcription, rounded to 2 places. */
  overlap: number;
}

/**
 * The page as every door must serve it. Non-mutating: returns the same object
 * when nothing changes, else a shallow copy with `translation` removed and, for
 * a light edit, `modernized_spelling` attached.
 *
 * `{ modernized: false }` for doors that cite or export — they must never carry
 * the edited text at all.
 */
export function serveEnglishOriginalPage<T extends PageLike>(
  page: T,
  book: BookLike,
  { modernized = true }: { modernized?: boolean } = {},
): T & { modernized_spelling?: ModernizedSpellingView } {
  if (!servesTranscriptionInsteadOfTranslation(page, book)) return page;
  const texts = page as PageTexts;
  const stored = String(texts.translation?.data ?? '');
  const { translation: _withheld, ...rest } = page as T & { translation?: unknown };
  const served = rest as T & { modernized_spelling?: ModernizedSpellingView };
  if (modernized) {
    const overlap = wordBigramOverlap(stored, String(texts.ocr?.data ?? ''));
    if (overlap !== null && overlap >= MODERNIZED_SPELLING_MIN_OVERLAP) {
      served.modernized_spelling = { data: stored, overlap: Math.round(overlap * 100) / 100 };
    }
  }
  return served;
}

/** Minimal Mongo surface, so this module needs no driver import. */
interface BooksReader {
  collection(name: string): {
    find(filter: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<unknown[]> };
  };
}

/**
 * `serveEnglishOriginalPage` for a batch of pages whose books the caller has
 * not loaded (`/api/pages/*`). Looks books up ONLY for pages that could be
 * affected — a translation over an English leaf — so a page turn in a Latin
 * book costs no query. On a lookup failure the pages are served unchanged
 * rather than failing the read.
 */
export async function serveEnglishOriginalPages<T extends PageLike>(
  db: BooksReader,
  pages: T[],
  opts: { modernized?: boolean } = {},
): Promise<Array<T & { modernized_spelling?: ModernizedSpellingView }>> {
  const candidates = new Set<string>();
  const bookIdOf = (p: T) => { const id = (p as { book_id?: unknown }).book_id; return typeof id === 'string' ? id : null; };
  for (const p of pages) {
    const id = bookIdOf(p);
    if (id && servesTranscriptionInsteadOfTranslation(p, { translation_state: { english_original: true } })) {
      candidates.add(id);
    }
  }
  if (candidates.size === 0) return pages;
  let books: Array<EnglishOriginalBookFields & { id?: string; _id?: unknown }> = [];
  try {
    // `id` OR `_id`: a book with a re-minted `_id` is invisible to an
    // `_id`-only lookup and vice versa (book-deletion-and-identity.md).
    const { ObjectId } = await import('mongodb');
    const ids = [...candidates];
    const oids = ids.filter((s) => ObjectId.isValid(s) && s.length === 24).map((s) => new ObjectId(s));
    books = await db.collection('books').find(
      { $or: [{ id: { $in: ids } }, ...(oids.length ? [{ _id: { $in: oids } }] : [])] },
      { projection: { _id: 1, id: 1, ...ENGLISH_ORIGINAL_BOOK_PROJECTION }, maxTimeMS: 3000 },
    ).toArray() as typeof books;
  } catch (err) {
    console.error('[english-original] book lookup failed; serving pages unchanged:', (err as Error).message);
    return pages;
  }
  const byId = new Map<string, EnglishOriginalBookFields>();
  for (const b of books) {
    if (b._id != null) byId.set(String(b._id), b);
    if (b.id) byId.set(b.id, b);
  }
  return pages.map((p) => { const id = bookIdOf(p); return serveEnglishOriginalPage(p, id ? byId.get(id) : null, opts); });
}
