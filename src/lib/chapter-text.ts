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

export interface ChapterText {
  book_id: string;
  chapter_index: number;
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

    const translationParts: string[] = [];
    const ocrParts: string[] = [];

    // Start with chapter header for structural context
    const chapterLabel = ch.titleEn
      ? `# ${ch.title}\n## ${ch.titleEn}`
      : `# ${ch.title}`;
    translationParts.push(chapterLabel);
    ocrParts.push(`# ${ch.title}`);

    for (let pn = startPage; pn <= endPage; pn++) {
      const page = pageMap.get(pn);
      if (!page) continue;

      // Embed page markers so readers can cite specific pages
      const marker = `[Page ${pn}]`;

      if (page.translation) {
        translationParts.push(`${marker}\n${page.translation}`);
      } else if (page.ocr) {
        translationParts.push(`${marker}\n${page.ocr}`);
      }

      if (page.ocr) {
        ocrParts.push(`${marker}\n${page.ocr}`);
      }
    }

    const text = translationParts.join('\n\n');
    const ocrText = ocrParts.join('\n\n');
    const tokenEstimate = Math.round(text.length / 4);
    totalTokens += tokenEstimate;

    docs.push({
      book_id: bookId,
      chapter_index: i,
      title: ch.title,
      titleEn: ch.titleEn,
      level: ch.level,
      pageStart: startPage,
      pageEnd: endPage,
      text,
      ocr_text: ocrText || undefined,
      token_estimate: tokenEstimate,
      materialized_at: new Date(),
    });
  }

  // Upsert: delete old chapter texts for this book, insert new ones
  await db.collection('chapter_texts').deleteMany({ book_id: bookId });
  if (docs.length > 0) {
    await db.collection('chapter_texts').insertMany(docs);
  }

  // Update book with endPages and materialization timestamp
  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        chapters: chapters,
        chapter_texts_at: new Date(),
      },
    },
  );

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
    .sort({ chapter_index: 1 })
    .toArray() as unknown as ChapterText[];
}
