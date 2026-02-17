import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
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
- "title": Clean chapter title (preserve original language, fix obvious OCR errors if any)
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

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "pageNumber": N, "level": N}, ...]

If the book has no discernible chapter structure, return an empty array: []`;

  return prompt;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages with OCR, projecting only what we need
    const pages = await db.collection('pages')
      .find(
        { book_id: id, 'ocr.data': { $exists: true, $ne: '' } },
        { projection: { id: 1, page_number: 1, 'ocr.data': 1, page_type: 1 } }
      )
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json(
        { error: 'No pages with OCR found for this book' },
        { status: 404 }
      );
    }

    // Step 1: Extract all raw headings
    const rawHeadings: Array<{ title: string; level: number; pageNumber: number }> = [];
    for (const page of pages) {
      const ocrText = page.ocr?.data || '';
      const headings = extractRawHeadings(ocrText, page.page_number);
      rawHeadings.push(...headings);
    }

    // Step 2: Identify likely TOC pages (contain "index", "tabula", "contents", or dense heading lists)
    const tocPages: Array<{ pageNumber: number; text: string }> = [];
    for (const page of pages) {
      const ocrText = (page.ocr?.data || '').toLowerCase();
      const pageType = page.page_type;
      const isTocByType = pageType === 'table_of_contents' || pageType === 'index';
      const isTocByContent = /\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText)
        && page.page_number <= Math.min(30, pages.length * 0.1); // TOC is usually in first ~3% or first 30 pages
      if (isTocByType || isTocByContent) {
        tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
      }
    }

    // Step 3: Call Gemini to identify real chapters
    const modelId = DEFAULT_MODEL;
    const model = getGeminiClient().getGenerativeModel({ model: modelId });
    const prompt = buildExtractionPrompt(
      book.display_title || book.title,
      book.author || 'Unknown',
      book.language || book.original_language || 'Unknown',
      pages.length,
      rawHeadings,
      tocPages.slice(0, 5), // Cap at 5 TOC pages
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
    let aiChapters: Array<{ title: string; pageNumber: number; level: number }>;
    try {
      // Strip markdown fences if the model included them
      const cleaned = responseText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      aiChapters = JSON.parse(cleaned);
    } catch {
      console.error('Failed to parse AI chapter response:', responseText.slice(0, 500));
      return NextResponse.json(
        { error: 'AI returned unparseable response', raw: responseText.slice(0, 1000) },
        { status: 500 }
      );
    }

    // Validate and build page ID mapping
    const pageByNumber = new Map<number, string>();
    for (const page of pages) {
      pageByNumber.set(page.page_number, page.id);
    }

    const chapters: Chapter[] = [];
    for (const ch of aiChapters) {
      if (!ch.title || !ch.pageNumber) continue;
      // Find closest page if exact number doesn't match
      let pageId = pageByNumber.get(ch.pageNumber);
      if (!pageId) {
        // Try nearby pages (±2) in case of off-by-one
        for (let offset = 1; offset <= 2; offset++) {
          pageId = pageByNumber.get(ch.pageNumber + offset) || pageByNumber.get(ch.pageNumber - offset);
          if (pageId) break;
        }
      }
      if (!pageId) continue; // Skip chapters we can't map to a page

      chapters.push({
        title: ch.title,
        pageId,
        pageNumber: ch.pageNumber,
        level: Math.min(Math.max(ch.level || 1, 1), 3),
      });
    }

    // Sort by page number
    chapters.sort((a, b) => a.pageNumber - b.pageNumber);

    // Save to book
    await db.collection('books').updateOne(
      { id },
      {
        $set: {
          chapters,
          chapters_extracted_at: new Date(),
        }
      }
    );

    // Log AI usage
    logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: modelId,
      book_id: id,
      page_count: pages.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: 'success',
      endpoint: `/api/books/${id}/extract-chapters`,
    }).catch(() => {}); // non-blocking

    return NextResponse.json({
      success: true,
      chaptersCount: chapters.length,
      chapters,
      rawHeadingsCount: rawHeadings.length,
      tocPagesFound: tocPages.length,
      usage: { inputTokens, outputTokens, costUsd: +costUsd.toFixed(4) },
    });
  } catch (error) {
    console.error('Error extracting chapters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract chapters' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve existing chapters
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      chapters: book.chapters || [],
      extractedAt: book.chapters_extracted_at,
    });
  } catch (error) {
    console.error('Error getting chapters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get chapters' },
      { status: 500 }
    );
  }
}
