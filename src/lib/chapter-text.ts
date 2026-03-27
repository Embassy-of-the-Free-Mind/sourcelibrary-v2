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
 * Compute endPage for each chapter based on the next chapter's start page.
 * Mutates the chapters array in place and returns it.
 */
export function computeEndPages(chapters: Chapter[], totalPages: number): Chapter[] {
  for (let i = 0; i < chapters.length; i++) {
    if (i < chapters.length - 1) {
      chapters[i].endPage = chapters[i + 1].pageNumber - 1;
    } else {
      chapters[i].endPage = totalPages;
    }
  }
  return chapters;
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
    const endPage = ch.endPage || totalPages;

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
