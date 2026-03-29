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
  context?: string; // Lines following the heading (helps distinguish TOC from body)
}

// Extract headings from text: markdown headings, centered markers, bold standalone
function extractRawHeadings(text: string, pageNumber: number, source: 'ocr' | 'translation'): RawHeading[] {
  const headings: RawHeading[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Skip non-structural tags
    if (/^<(margin|meta|header|sig|page-num|language|page-type|columns|warning|summary|keywords)>/.test(trimmed)) continue;

    let title: string | null = null;
    let level = 2;

    // 1. Markdown headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      level = headingMatch[1].length;
      title = headingMatch[2].trim()
        .replace(/^->/, '').replace(/<-$/, '')
        .replace(/^\*\*/, '').replace(/\*\*$/, '')
        .trim();
    }

    // 2. Centered markers: ->*Caput V. De anima.*<-
    if (!title) {
      const centeredMatch = trimmed.match(/^->\*(.+)\*<-$/);
      if (centeredMatch) {
        title = centeredMatch[1].trim();
        level = 2;
      }
    }

    // 3. Bold standalone structural labels: **LIBER PRIMUS**
    if (!title) {
      const boldMatch = trimmed.match(/^\*\*([A-Z][^*]{3,80})\*\*$/);
      if (boldMatch) {
        title = boldMatch[1].trim();
        level = 1;
      }
    }

    if (!title || title.length < 3) continue;

    // Gather 3 lines of context after the heading
    const contextLines: string[] = [];
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cl = lines[j].trim();
      if (cl && !cl.startsWith('<') && cl.length > 10) {
        contextLines.push(cl.slice(0, 100));
      }
    }

    headings.push({
      title,
      level,
      pageNumber,
      source,
      context: contextLines.join(' | ').slice(0, 200) || undefined,
    });
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

  // Identify TOC page range to help Gemini
  const tocPageNumbers = new Set(tocPages.map(t => t.pageNumber));

  prompt += `## Headings Found in the Text

Below are headings from the OCR and translation, with context lines after each.
- If context shows body text (prose, arguments), the heading likely starts a real chapter.
- If context shows more chapter titles or page numbers, the heading is inside a table of contents.
- If a heading appears in the TOC AND later in the body, use the BODY page number.

`;

  // Merge all headings and present with context
  const allByPage = new Map<number, RawHeading[]>();
  for (const h of [...ocrHeadings, ...translationHeadings]) {
    const arr = allByPage.get(h.pageNumber) || [];
    arr.push(h);
    allByPage.set(h.pageNumber, arr);
  }

  const sortedPages = [...allByPage.keys()].sort((a, b) => a - b);
  for (const pageNum of sortedPages) {
    const pageHeadings = allByPage.get(pageNum)!;
    const isTocPage = tocPageNumbers.has(pageNum);
    const prefix = isTocPage ? '[TOC] ' : '';
    for (const h of pageHeadings) {
      prompt += `${prefix}p.${pageNum}: ${'#'.repeat(h.level)} ${h.title}\n`;
      if (h.context) {
        prompt += `  → ${h.context}\n`;
      }
    }
  }

  prompt += `

## Instructions

Return the real structural chapters as a JSON array. CRITICAL rules:
- "pageNumber" must be where chapter TEXT BEGINS in the body, NOT where it appears in a table of contents
- Headings marked [TOC] are from table of contents pages — use them to understand structure, but find the BODY page where each chapter actually starts
- Verify each chapter by checking context: does body text follow, or more chapter listings?

Each entry:
- "title": Clean chapter title in the original language (fix obvious OCR errors)
- "titleEn": English translation (concise — e.g., "Tractatus I: De Macrocosmi Historia" → "Treatise I: On the History of the Macrocosm"). Omit if already English.
- "pageNumber": Page where this chapter's TEXT begins (not TOC reference)
- "level": 1 = top-level (Tractatus/Part/Book/Tomus/Volume), 2 = chapter (Liber/Section/Caput), 3 = sub-chapter
- "confidence": "high"/"medium"/"low"

Guidelines:
- Look for the book's actual organizational structure (Parts, Books, Chapters, Sections, Tractatus, Liber, Caput, Tomus, Volumen, Band, etc.)
- For multi-volume works: use level 1 for volumes, level 2 for chapters within. Chapter numbering restarts per volume.
- SKIP: title pages, dedications, indices, running headers, image captions, colophons
- INCLUDE: prefaces/prologues if they are labeled sections
- A typical book has 5-50 chapters. Over 80 usually means noise.
- Cross-reference OCR and translation headings — prefer the cleaner version for "title"

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N, "confidence": "high|medium|low"}, ...]

Empty array [] if no discernible structure.`;

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

  // Parse AI response — handle various wrapper formats
  let aiChapters: Array<{ title: string; titleEn?: string; pageNumber: number; level: number; confidence?: string }>;
  try {
    let cleaned = responseText.trim();
    // Strip markdown code fences (may appear with or without leading text)
    const jsonBlockMatch = cleaned.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    } else {
      cleaned = cleaned.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    }
    // Find the JSON array even if surrounded by text
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      cleaned = arrayMatch[0];
    }
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
