/**
 * Chapter Extraction — shared logic
 *
 * Extracts chapter structure from OCR and translation text using Gemini AI.
 * Used by both the API route and the pipeline cron.
 *
 * Improvements (Feb 2026):
 * - Uses both OCR headings and translation headings for bilingual context
 * - Feeds index sectionSummaries as structural hints when available
 * - Confidence scoring (high/medium/low) per chapter
 * - Multi-volume detection with Tomus/Volumen/Band awareness
 */

import { getGeminiClient } from '@/lib/gemini-client';
import { logGeminiCall } from '@/lib/gemini-logger';
import { DEFAULT_MODEL } from '@/lib/types';
import { MODEL_PRICING } from '@/lib/ai';
import { computeEndPages } from '@/lib/chapter-text';
import type { Chapter } from '@/lib/types';

interface RawHeading {
  title: string;
  level: number;
  pageNumber: number;
  source: 'ocr' | 'translation';
}

// Extract raw markdown headings from text
function extractRawHeadings(text: string, pageNumber: number, source: 'ocr' | 'translation'): RawHeading[] {
  const headings: RawHeading[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let title = headingMatch[2].trim();
      title = title.replace(/^->/, '').replace(/<-$/, '').trim();
      title = title.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      if (title.length < 3) continue;
      headings.push({ title, level, pageNumber, source });
    }
  }

  return headings;
}

interface SectionHint {
  title: string;
  startPage: number;
  endPage: number;
}

// Build the AI prompt for chapter extraction
function buildExtractionPrompt(
  bookTitle: string,
  author: string,
  language: string,
  pageCount: number,
  rawHeadings: RawHeading[],
  tocPages: Array<{ pageNumber: number; text: string }>,
  sectionHints: SectionHint[],
): string {
  let prompt = `You are analyzing the structure of a digitized historical book to extract its table of contents.

**Book:** ${bookTitle}
**Author:** ${author}
**Language:** ${language}
**Total pages:** ${pageCount}

`;

  // Section hints from the book's AI index (if available)
  if (sectionHints.length > 0) {
    prompt += `## Prior Section Analysis

A previous AI analysis identified these broad sections (use as hints, not gospel — page numbers may be approximate):

`;
    for (const s of sectionHints) {
      prompt += `- "${s.title}" (pp. ${s.startPage}–${s.endPage})\n`;
    }
    prompt += '\n';
  }

  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages

The following pages appear to contain a printed table of contents:\n\n`;
    for (const toc of tocPages) {
      prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 3000)}\n\`\`\`\n\n`;
    }
  }

  // Split headings by source
  const ocrHeadings = rawHeadings.filter(h => h.source === 'ocr');
  const translationHeadings = rawHeadings.filter(h => h.source === 'translation');

  prompt += `## Raw OCR Headings

The OCR system marked ${ocrHeadings.length} lines as headings. Most are noise (title pages, dedications, running headers, captions, centered text). Your job is to identify which ones are real structural divisions of the book.

`;

  // Group OCR headings by page
  const ocrByPage = new Map<number, RawHeading[]>();
  for (const h of ocrHeadings) {
    const arr = ocrByPage.get(h.pageNumber) || [];
    arr.push(h);
    ocrByPage.set(h.pageNumber, arr);
  }

  for (const [pageNum, pageHeadings] of ocrByPage) {
    prompt += `p.${pageNum}: ${pageHeadings.map(h => `${'#'.repeat(h.level)} ${h.title}`).join(' | ')}\n`;
  }

  // Translation headings (if available and distinct from OCR)
  if (translationHeadings.length > 0) {
    prompt += `
## Translation Headings

The English translation also contains ${translationHeadings.length} headings. These may clarify Latin/German section markers that are ambiguous in the original:

`;
    const transByPage = new Map<number, RawHeading[]>();
    for (const h of translationHeadings) {
      const arr = transByPage.get(h.pageNumber) || [];
      arr.push(h);
      transByPage.set(h.pageNumber, arr);
    }

    for (const [pageNum, pageHeadings] of transByPage) {
      prompt += `p.${pageNum}: ${pageHeadings.map(h => `${'#'.repeat(h.level)} ${h.title}`).join(' | ')}\n`;
    }
  }

  prompt += `

## Instructions

Return ONLY the real structural chapters/sections of this book as a JSON array. Each entry needs:
- "title": Clean chapter title in the original language (fix obvious OCR errors if any)
- "titleEn": English translation of the chapter title (concise, natural English — e.g., "Tractatus I: De Macrocosmi Historia" → "Treatise I: On the History of the Macrocosm"). If the book is already in English, omit this field.
- "pageNumber": The page number where this chapter starts
- "level": Hierarchy level (1 = top-level division like Tractatus/Part/Book/Tomus/Volume, 2 = major chapter like Liber/Section, 3 = sub-chapter like Caput/Chapter)
- "confidence": "high" if this is clearly a structural division (appears in TOC, has a numbered label, or matches section analysis), "medium" if likely but uncertain, "low" if plausible but might be noise

Guidelines:
- Look for the book's actual organizational structure (Parts, Books, Chapters, Sections, Tractatus, Liber, Caput, Tomus, Volumen, Band, etc.)
- For multi-volume works: use level 1 for volumes/tomi, level 2 for books/chapters within a volume
- SKIP: title pages, dedications, epistles to the reader, indices/indexes, running headers, image captions, printer colophons
- SKIP: fragmentary text, continuation lines, single words that aren't chapter titles
- INCLUDE: prefaces/prologues if they are labeled sections the reader would navigate to
- A typical book has 5-50 chapters. If you find more than 80, you're probably including too much noise.
- If the book has a clear hierarchy (e.g., Tractatus > Liber > Caput), preserve it with levels 1/2/3
- If a heading appears to be a table of contents entry listing a chapter, include the chapter, not the TOC entry
- Merge multi-line titles that were split across headings on the same page
- For titleEn: preserve structural labels (Tractatus → Treatise, Liber → Book, Caput → Chapter, Pars → Part, Tomus → Volume) and translate the descriptive part naturally
- Cross-reference OCR headings with translation headings when available — if the same page has a heading in both, prefer the cleaner version for "title" (original language) and use the translation for "titleEn"

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N, "confidence": "high|medium|low"}, ...]

If the book has no discernible chapter structure, return an empty array: []`;

  return prompt;
}

export interface ChapterExtractionResult {
  chapters: Chapter[];
  rawHeadingsCount: number;
  translationHeadingsCount: number;
  tocPagesFound: number;
  sectionHintsUsed: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Extract chapters for a book using AI.
 * Shared function used by both the API route and the pipeline cron.
 *
 * Uses OCR headings, translation headings, and index section summaries
 * for best results.
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

  // Get all pages with OCR, include translation data too
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, page_type: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    throw new Error('No pages with OCR found for this book');
  }

  // Step 1: Extract raw headings from both OCR and translation
  const rawHeadings: RawHeading[] = [];
  for (const page of pages) {
    const ocrText = page.ocr?.data || '';
    rawHeadings.push(...extractRawHeadings(ocrText, page.page_number, 'ocr'));

    const translationText = page.translation?.data || '';
    if (translationText) {
      rawHeadings.push(...extractRawHeadings(translationText, page.page_number, 'translation'));
    }
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

  // Step 3: Gather section hints from book index (if available)
  const sectionHints: SectionHint[] = [];
  if (book.index?.sectionSummaries) {
    for (const section of book.index.sectionSummaries) {
      if (section.title && section.startPage) {
        sectionHints.push({
          title: section.title,
          startPage: section.startPage,
          endPage: section.endPage || section.startPage,
        });
      }
    }
  }

  // Step 4: Call Gemini
  const modelId = DEFAULT_MODEL;
  const model = getGeminiClient().getGenerativeModel({ model: modelId });
  const prompt = buildExtractionPrompt(
    book.display_title || book.title,
    book.author || 'Unknown',
    book.language || book.original_language || 'Unknown',
    pages.length,
    rawHeadings,
    tocPages.slice(0, 5),
    sectionHints,
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
  let aiChapters: Array<{ title: string; titleEn?: string; pageNumber: number; level: number; confidence?: string }>;
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
    if (ch.confidence === 'high' || ch.confidence === 'medium' || ch.confidence === 'low') {
      chapter.confidence = ch.confidence;
    }
    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.pageNumber - b.pageNumber);

  // Compute endPage for each chapter
  computeEndPages(chapters, pages.length);

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

  const translationHeadingsCount = rawHeadings.filter(h => h.source === 'translation').length;

  // Log AI usage
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
    rawHeadingsCount: rawHeadings.filter(h => h.source === 'ocr').length,
    translationHeadingsCount,
    tocPagesFound: tocPages.length,
    sectionHintsUsed: sectionHints.length,
    usage: { inputTokens, outputTokens, costUsd: +costUsd.toFixed(4) },
  };
}
