/**
 * Chapter Text Materialization
 *
 * Concatenates page-level text into chapter-sized chunks for AI reading,
 * search, and RAG. Chapters are the optimal unit for LLM comprehension
 * (~10K-50K tokens vs ~300-500 per page).
 *
 * Source of truth remains the `pages` collection. Chapter texts are derived
 * and stored in `chapter_texts` for fast retrieval.
 */

import type { Db } from 'mongodb';
import type { Chapter } from '@/lib/types';

// Max tokens per chunk. Chapters exceeding this are split at page boundaries.
const MAX_CHUNK_TOKENS = 100_000;
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * 4; // ~4 chars per token

export interface ChapterText {
  book_id: string;
  chapter_index: number;
  part?: number;          // Set when a chapter is split into multiple parts (1-based)
  parts_total?: number;   // Total parts for this chapter (only set when split)
  title: string;
  titleEn?: string;
  level: number;
  pageStart: number;
  pageEnd: number;
  text: string;           // Concatenated translation (or OCR fallback)
  ocr_text?: string;      // Concatenated original language text
  token_estimate: number; // Rough token count (~4 chars/token)
  materialized_at: Date;
}

/**
 * Compute endPage for each chapter: it runs until the next entry AT OR ABOVE
 * its own level begins.
 *
 * The level check is the whole point. This used to look at `chapters[i + 1]`
 * flatly, which is correct for a single-level list and wrong for every nested
 * one — a "Book I" heading is immediately followed by its own "Chapter I",
 * usually on the SAME page, so the book got `endPage = pageNumber - 1` and
 * every level-1 span came back inverted. Measured 2026-08-07: 29,037 such
 * entries across 6,901 books (6,045 of them visible), i.e. essentially every
 * multi-level book in the corpus. Reported from an MCP session that found
 * Book I of Taylor's Nicomachean Ethics spanning pp. 12–11 (#3653 follow-up).
 *
 * A child is still bounded by the next sibling OR by the end of its parent,
 * whichever comes first, which falls out of "next entry at or above my level"
 * for free.
 *
 * Mutates the chapters array in place and returns it. Callers must pass
 * chapters already sorted by pageNumber.
 */
export function computeEndPages(chapters: Chapter[], totalPages: number): Chapter[] {
  for (let i = 0; i < chapters.length; i++) {
    const level = chapters[i].level ?? 1;
    let end = totalPages;
    for (let j = i + 1; j < chapters.length; j++) {
      if ((chapters[j].level ?? 1) <= level) {
        end = chapters[j].pageNumber - 1;
        break;
      }
    }
    // A heading whose successor starts on the same page would otherwise get an
    // inverted span. It is at minimum one page long — the page it opens on.
    chapters[i].endPage = Math.max(end, chapters[i].pageNumber);
  }
  return chapters;
}

/**
 * How far does this entry's own MATERIALIZED TEXT run?
 *
 * This is deliberately NOT `endPage`. The two answer different questions:
 *
 *   endPage      — "where does Book I end?"   → p.57, children included.
 *                  What a reader, the API, and a range query want.
 *   chunkEndPage — "which pages are Book I's OWN text?" → p.12–11, i.e. the
 *                  preamble before Chapter I starts. Usually empty.
 *
 * `chapter_texts` is a RETRIEVAL store, so its rows must PARTITION the book.
 * If a container were chunked over its full span, "Book I" (pp. 12–57) would
 * be stored on top of its ten chapters — every page twice, and a RAG caller
 * handed the same passage under two labels.
 *
 * Keeping these separate is what lets `endPage` be fixed without touching a
 * single materialized row: a container's chunk range here is exactly what the
 * old flat rule produced, so `chapter_texts` output is unchanged.
 *
 * Entries are sorted by pageNumber, so a container is exactly an entry whose
 * immediate successor sits at a deeper level.
 *
 * TWIN: `chunkEndPage` in `scripts/lib/chapter-endpages.mjs`.
 */
export function chunkEndPage(chapters: Chapter[], i: number, totalPages: number): number {
  const next = chapters[i + 1];
  if (next && (next.level ?? 1) > (chapters[i].level ?? 1)) {
    return next.pageNumber - 1; // container: its own preamble only
  }
  return chapters[i].endPage ?? totalPages;
}

/**
 * Materialize chapter texts for a single book.
 * Fetches page text, concatenates by chapter boundaries, and upserts
 * into the `chapter_texts` collection.
 *
 * @returns Number of chapters materialized
 */
export async function materializeChapterTexts(
  db: Db,
  bookId: string,
): Promise<{ chapters: number; totalTokens: number }> {
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { chapters: 1, pages_count: 1 } },
  );

  if (!book?.chapters?.length) {
    return { chapters: 0, totalTokens: 0 };
  }

  const chapters: Chapter[] = book.chapters;
  const totalPages = book.pages_count || 0;
  computeEndPages(chapters, totalPages);

  // Fetch all pages with text in one query
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
    )
    .sort({ page_number: 1 })
    .toArray();

  // Index pages by page_number for fast lookup
  const pageMap = new Map<number, { ocr?: string; translation?: string }>();
  for (const p of pages) {
    pageMap.set(p.page_number, {
      ocr: p.ocr?.data || undefined,
      translation: p.translation?.data || undefined,
    });
  }

  const docs: ChapterText[] = [];
  let totalTokens = 0;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const startPage = ch.pageNumber;
    // NOT ch.endPage — a container's span covers its children, which must not
    // be chunked twice. See chunkEndPage.
    const endPage = chunkEndPage(chapters, i, totalPages);

    // Collect per-page text first, then chunk
    const pageTexts: Array<{ pn: number; trans: string; ocr: string }> = [];

    for (let pn = startPage; pn <= endPage; pn++) {
      const page = pageMap.get(pn);
      if (!page) continue;

      const marker = `[Page ${pn}]`;
      const trans = page.translation
        ? `${marker}\n${page.translation}`
        : page.ocr
          ? `${marker}\n${page.ocr}`
          : '';
      const ocr = page.ocr ? `${marker}\n${page.ocr}` : '';

      if (trans || ocr) {
        pageTexts.push({ pn, trans, ocr });
      }
    }

    // Build chunks, splitting at page boundaries when exceeding MAX_CHUNK_CHARS
    const chunks: Array<{ pageStart: number; pageEnd: number; transParts: string[]; ocrParts: string[] }> = [];
    let current = { pageStart: startPage, pageEnd: startPage, transParts: [] as string[], ocrParts: [] as string[] };
    let currentChars = 0;

    for (const pt of pageTexts) {
      const pageChars = pt.trans.length + 4; // +4 for join separator
      if (currentChars > 0 && currentChars + pageChars > MAX_CHUNK_CHARS) {
        // Start a new chunk
        chunks.push(current);
        current = { pageStart: pt.pn, pageEnd: pt.pn, transParts: [], ocrParts: [] };
        currentChars = 0;
      }
      if (pt.trans) current.transParts.push(pt.trans);
      if (pt.ocr) current.ocrParts.push(pt.ocr);
      current.pageEnd = pt.pn;
      currentChars += pageChars;
    }
    if (current.transParts.length > 0) {
      chunks.push(current);
    }

    const needsSplit = chunks.length > 1;

    for (let partIdx = 0; partIdx < chunks.length; partIdx++) {
      const chunk = chunks[partIdx];

      // Prepend chapter header
      const chapterLabel = ch.titleEn
        ? `# ${ch.title}\n## ${ch.titleEn}`
        : `# ${ch.title}`;
      const headerSuffix = needsSplit ? ` (part ${partIdx + 1} of ${chunks.length})` : '';
      chunk.transParts.unshift(chapterLabel + headerSuffix);
      chunk.ocrParts.unshift(`# ${ch.title}${headerSuffix}`);

      const text = chunk.transParts.join('\n\n');
      const ocrText = chunk.ocrParts.join('\n\n');
      const tokenEstimate = Math.round(text.length / 4);
      totalTokens += tokenEstimate;

      const doc: ChapterText = {
        book_id: bookId,
        chapter_index: i,
        title: ch.title,
        titleEn: ch.titleEn,
        level: ch.level,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        text,
        ocr_text: ocrText || undefined,
        token_estimate: tokenEstimate,
        materialized_at: new Date(),
      };
      if (needsSplit) {
        doc.part = partIdx + 1;
        doc.parts_total = chunks.length;
      }
      docs.push(doc);
    }
  }

  // Upsert: delete old chapter texts for this book, insert new ones
  await db.collection('chapter_texts').deleteMany({ book_id: bookId });
  if (docs.length > 0) {
    await db.collection('chapter_texts').insertMany(docs);
  }

  // Update book with endPages and materialization timestamp
  try {
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          chapters: chapters,
          chapter_texts_at: new Date(),
        },
      },
    );
  } catch (err: unknown) {
    // If book doc is too large (>16MB), just set the timestamp without chapters update
    if (err instanceof Error && err.message.includes('larger than the maximum size')) {
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { chapter_texts_at: new Date() } },
      );
    } else {
      throw err;
    }
  }

  return { chapters: docs.length, totalTokens };
}

/**
 * Get chapter texts for a book, optionally filtered by chapter index.
 */
export async function getChapterTexts(
  db: Db,
  bookId: string,
  chapterIndex?: number,
): Promise<ChapterText[]> {
  const filter: Record<string, unknown> = { book_id: bookId };
  if (chapterIndex !== undefined) {
    filter.chapter_index = chapterIndex;
  }
  return db.collection('chapter_texts')
    .find(filter)
    .sort({ chapter_index: 1, part: 1 })
    .toArray() as unknown as ChapterText[];
}
