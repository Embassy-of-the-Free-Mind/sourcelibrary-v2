/**
 * Chapter Extraction — shared logic
 *
 * Extracts chapter structure from OCR headings using Gemini AI.
 * Used by both the API route and the pipeline cron.
 */

import { getGeminiClient } from '@/lib/gemini-client';
import { logGeminiCall } from '@/lib/gemini-logger';
import { DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';
import type { Chapter } from '@/lib/types';

// Extract raw markdown headings from OCR for AI context
function extractRawHeadings(ocrText: string, pageNumber: number): Array<{ title: string; level: number; pageNumber: number }> {
  const headings: Array<{ title: string; level: number; pageNumber: number }> = [];
  const lines = ocrText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let title = headingMatch[2].trim();
      title = title.replace(/^->/, '').replace(/<-$/, '').trim();
      title = title.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      if (title.length < 3) continue;
      headings.push({ title, level, pageNumber });
    }
  }

  return headings;
}

// Build the AI prompt for chapter extraction
function buildExtractionPrompt(
  bookTitle: string,
  author: string,
  language: string,
  pageCount: number,
  rawHeadings: Array<{ title: string; level: number; pageNumber: number }>,
  tocPages: Array<{ pageNumber: number; text: string }>,
): string {
  let prompt = `You are analyzing the structure of a digitized historical book to extract its table of contents.

**Book:** ${bookTitle}
**Author:** ${author}
**Language:** ${language}
**Total pages:** ${pageCount}

`;

  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages

The following pages appear to contain a printed table of contents:\n\n`;
    for (const toc of tocPages) {
      prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 3000)}\n\`\`\`\n\n`;
    }
  }

  prompt += `## Raw OCR Headings

The OCR system marked ${rawHeadings.length} lines as headings. Most are noise (title pages, dedications, running headers, captions, centered text). Your job is to identify which ones are real structural divisions of the book.

`;

  // Group headings by page to show context
  const byPage = new Map<number, typeof rawHeadings>();
  for (const h of rawHeadings) {
    const arr = byPage.get(h.pageNumber) || [];
    arr.push(h);
    byPage.set(h.pageNumber, arr);
  }

  for (const [pageNum, pageHeadings] of byPage) {
    prompt += `p.${pageNum}: ${pageHeadings.map(h => `${'#'.repeat(h.level)} ${h.title}`).join(' | ')}\n`;
  }

  prompt += `

## Instructions

Return ONLY the real structural chapters/sections of this book as a JSON array. Each entry needs:
- "title": Clean chapter title in the original language (fix obvious OCR errors if any)
- "titleEn": English translation of the chapter title (concise, natural English — e.g., "Tractatus I: De Macrocosmi Historia" → "Treatise I: On the History of the Macrocosm"). If the book is already in English, omit this field.
- "pageNumber": The page number where this chapter starts
- "level": Hierarchy level (1 = top-level division like Tractatus/Part/Book, 2 = major chapter like Liber/Section, 3 = sub-chapter like Caput/Chapter)

Guidelines:
- Look for the book's actual organizational structure (Parts, Books, Chapters, Sections, Tractatus, Liber, Caput, etc.)
- SKIP: title pages, dedications, epistles to the reader, indices/indexes, running headers, image captions, printer colophons
- SKIP: fragmentary text, continuation lines, single words that aren't chapter titles
- INCLUDE: prefaces/prologues if they are labeled sections the reader would navigate to
- A typical book has 5-50 chapters. If you find more than 80, you're probably including too much noise.
- If the book has a clear hierarchy (e.g., Tractatus > Liber > Caput), preserve it with levels 1/2/3
- If a heading appears to be a table of contents entry listing a chapter, include the chapter, not the TOC entry
- Merge multi-line titles that were split across headings on the same page
- For titleEn: preserve structural labels (Tractatus → Treatise, Liber → Book, Caput → Chapter, Pars → Part) and translate the descriptive part naturally

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N}, ...]

If the book has no discernible chapter structure, return an empty array: []`;

  return prompt;
}

export interface ChapterExtractionResult {
  chapters: Chapter[];
  rawHeadingsCount: number;
  tocPagesFound: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Extract chapters for a book using AI.
 * Shared function used by both the API route and the pipeline cron.
 *
 * @param db - MongoDB database instance
 * @param bookId - Book ID to extract chapters for
 * @returns Extraction result with chapters and usage stats
 * @throws Error if book not found, no OCR pages, or AI fails to parse
 */
export async function extractChaptersForBook(
  db: Awaited<ReturnType<typeof import('@/lib/mongodb').getDb>>,
  bookId: string,
): Promise<ChapterExtractionResult> {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    throw new Error('Book not found');
  }

  // Get all pages with OCR
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, page_type: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    throw new Error('No pages with OCR found for this book');
  }

  // Step 1: Extract all raw headings
  const rawHeadings: Array<{ title: string; level: number; pageNumber: number }> = [];
  for (const page of pages) {
    const ocrText = page.ocr?.data || '';
    const headings = extractRawHeadings(ocrText, page.page_number);
    rawHeadings.push(...headings);
  }

  // Step 2: Identify likely TOC pages
  const tocPages: Array<{ pageNumber: number; text: string }> = [];
  for (const page of pages) {
    const ocrText = (page.ocr?.data || '').toLowerCase();
    const pageType = page.page_type;
    const isTocByType = pageType === 'table_of_contents' || pageType === 'index';
    const isTocByContent = /\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText)
      && page.page_number <= Math.min(30, pages.length * 0.1);
    if (isTocByType || isTocByContent) {
      tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
    }
  }

  // Step 3: Call Gemini
  const modelId = DEFAULT_MODEL;
  const model = getGeminiClient().getGenerativeModel({ model: modelId });
  const prompt = buildExtractionPrompt(
    book.display_title || book.title,
    book.author || 'Unknown',
    book.language || book.original_language || 'Unknown',
    pages.length,
    rawHeadings,
    tocPages.slice(0, 5),
  );

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.text();

  const usageMetadata = response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;
  const pricing = MODEL_PRICING[modelId] || MODEL_PRICING['default'];
  const costUsd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

  // Parse AI response
  let aiChapters: Array<{ title: string; titleEn?: string; pageNumber: number; level: number }>;
  try {
    const cleaned = responseText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    aiChapters = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned unparseable response: ${responseText.slice(0, 500)}`);
  }

  // Build page ID mapping and validate chapters
  const pageByNumber = new Map<number, string>();
  for (const page of pages) {
    pageByNumber.set(page.page_number, page.id);
  }

  const chapters: Chapter[] = [];
  for (const ch of aiChapters) {
    if (!ch.title || !ch.pageNumber) continue;
    let pageId = pageByNumber.get(ch.pageNumber);
    if (!pageId) {
      for (let offset = 1; offset <= 2; offset++) {
        pageId = pageByNumber.get(ch.pageNumber + offset) || pageByNumber.get(ch.pageNumber - offset);
        if (pageId) break;
      }
    }
    if (!pageId) continue;

    const chapter: Chapter = {
      title: ch.title,
      pageId,
      pageNumber: ch.pageNumber,
      level: Math.min(Math.max(ch.level || 1, 1), 3),
    };
    if (ch.titleEn) chapter.titleEn = ch.titleEn;
    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.pageNumber - b.pageNumber);

  // Save to book
  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        chapters,
        chapters_extracted_at: new Date(),
      }
    }
  );

  // Log AI usage with proper type
  logGeminiCall({
    type: 'extract_chapters',
    mode: 'realtime',
    model: modelId,
    book_id: bookId,
    page_count: pages.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    status: 'success',
    endpoint: 'chapter-extraction',
  }).catch(() => {}); // non-blocking

  return {
    chapters,
    rawHeadingsCount: rawHeadings.length,
    tocPagesFound: tocPages.length,
    usage: { inputTokens, outputTokens, costUsd: +costUsd.toFixed(4) },
  };
}
