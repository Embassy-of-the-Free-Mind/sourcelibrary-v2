import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isBot, isTrustedBot, isBotAccessible, botGateResponse } from '@/lib/bot-gate';
import { getChapterTexts } from '@/lib/chapter-text';

export const maxDuration = 30;

/**
 * GET /api/books/[id]/text
 *
 * Returns all page text for a book in a single response.
 * Designed for machine consumption (MCP servers, Claude Code, research scripts).
 *
 * Query params:
 *   content=ocr|translation|both (default: both)
 *   from=N  — start page number (inclusive)
 *   to=N    — end page number (inclusive)
 *   chapter=N — return chapter N (0-indexed). Overrides from/to.
 *   format=json|plain (default: json)
 *   include_metadata=true — include page-level OCR/translation metadata
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const { searchParams } = new URL(request.url);

    const content = searchParams.get('content') || 'both';
    const fromPage = searchParams.get('from') ? parseInt(searchParams.get('from')!) : undefined;
    const toPage = searchParams.get('to') ? parseInt(searchParams.get('to')!) : undefined;
    const chapterParam = searchParams.get('chapter');
    const partParam = searchParams.get('part');
    const format = searchParams.get('format') || 'json';
    const includeMetadata = searchParams.get('include_metadata') === 'true';

    if (!['ocr', 'translation', 'both'].includes(content)) {
      return NextResponse.json({ error: 'content must be ocr, translation, or both' }, { status: 400 });
    }

    const db = await getDb();

    // Find book by id or _id
    let book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, pages_count: 1 } }
    );
    if (!book && ObjectId.isValid(bookId)) {
      book = await db.collection('books').findOne(
        { _id: new ObjectId(bookId) },
        { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, pages_count: 1 } }
      );
    }
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const resolvedBookId = book.id || bookId;

    // Bot gating: non-trusted bots only get ~20% of books
    if (isBot(request) && !isTrustedBot(request) && !isBotAccessible(resolvedBookId)) {
      // Fetch summary for the gated response
      const fullBook = await db.collection('books').findOne(
        { id: resolvedBookId },
        { projection: { reading_summary: 1, pages_count: 1 } }
      );
      return NextResponse.json(
        botGateResponse({ ...book, ...fullBook, id: resolvedBookId }),
        { status: 200, headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    // Chapter mode: return pre-materialized chapter text
    if (chapterParam !== null) {
      const chapterIndex = parseInt(chapterParam);
      if (isNaN(chapterIndex) || chapterIndex < 0) {
        return NextResponse.json({ error: 'chapter must be a non-negative integer' }, { status: 400 });
      }

      const allParts = await getChapterTexts(db, resolvedBookId, chapterIndex);

      if (allParts.length === 0) {
        // Fall back: check if chapters exist but aren't materialized yet
        const bookWithChapters = await db.collection('books').findOne(
          { id: resolvedBookId },
          { projection: { chapters: 1 } },
        );
        if (bookWithChapters?.chapters?.[chapterIndex]) {
          return NextResponse.json({
            error: 'Chapter exists but text not yet materialized. Run POST /api/books/{id}/materialize-chapters first.',
            chapter: bookWithChapters.chapters[chapterIndex],
          }, { status: 404 });
        }
        return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
      }

      // Select the right part (default: part 1 or the only part)
      const requestedPart = partParam ? parseInt(partParam) : 1;
      const ct = allParts.length === 1
        ? allParts[0]
        : allParts.find(p => p.part === requestedPart) || allParts[0];

      if (format === 'plain') {
        const partLabel = ct.parts_total ? ` (part ${ct.part} of ${ct.parts_total})` : '';
        const header = [
          `# ${book.display_title || book.title}`,
          `# ${book.author} (${book.published || 'n.d.'})`,
          `# Chapter ${chapterIndex}: ${ct.titleEn || ct.title}${partLabel}`,
          `# Pages ${ct.pageStart}–${ct.pageEnd}`,
          `# Source: https://sourcelibrary.org/book/${resolvedBookId}`,
          '',
          content === 'ocr' ? (ct.ocr_text || ct.text) : ct.text,
        ].join('\n');

        return new Response(header, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        });
      }

      return NextResponse.json({
        book: {
          id: resolvedBookId,
          title: book.display_title || book.title,
          author: book.author,
          url: `https://sourcelibrary.org/book/${resolvedBookId}`,
        },
        chapter: {
          index: ct.chapter_index,
          title: ct.title,
          titleEn: ct.titleEn,
          level: ct.level,
          pageStart: ct.pageStart,
          pageEnd: ct.pageEnd,
          token_estimate: ct.token_estimate,
          ...(ct.parts_total ? { part: ct.part, parts_total: ct.parts_total } : {}),
          text: content === 'ocr' ? (ct.ocr_text || ct.text) : ct.text,
          ...(content === 'both' && ct.ocr_text ? { ocr_text: ct.ocr_text } : {}),
        },
      }, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // Build page query
    const pageFilter: Record<string, unknown> = { book_id: resolvedBookId };
    if (fromPage !== undefined || toPage !== undefined) {
      pageFilter.page_number = {};
      if (fromPage !== undefined) (pageFilter.page_number as Record<string, number>).$gte = fromPage;
      if (toPage !== undefined) (pageFilter.page_number as Record<string, number>).$lte = toPage;
    }

    // Build projection — only fetch what's needed
    const projection: Record<string, number> = { page_number: 1, _id: 0 };
    if (content === 'ocr' || content === 'both') {
      projection['ocr.data'] = 1;
      if (includeMetadata) {
        projection['ocr.language'] = 1;
        projection['ocr.model'] = 1;
        projection['ocr.source'] = 1;
      }
    }
    if (content === 'translation' || content === 'both') {
      projection['translation.data'] = 1;
      if (includeMetadata) {
        projection['translation.language'] = 1;
        projection['translation.model'] = 1;
        projection['translation.source'] = 1;
      }
    }
    if (includeMetadata) {
      projection.page_type = 1;
      projection.columns = 1;
    }

    const pages = await db.collection('pages')
      .find(pageFilter)
      .project(projection)
      .sort({ page_number: 1 })
      .toArray();

    // Plain text format — concatenated text with page markers
    if (format === 'plain') {
      const lines: string[] = [];
      lines.push(`# ${book.display_title || book.title}`);
      lines.push(`# ${book.author} (${book.published || 'n.d.'})`);
      lines.push(`# Language: ${book.language}`);
      lines.push(`# Produced by SourceLibrary.org in Amsterdam, 2026`);
      lines.push(`# Source: https://sourcelibrary.org/book/${resolvedBookId}`);
      lines.push(`# License: CC BY-SA 4.0 (https://sourcelibrary.org/terms)`);
      lines.push('');

      for (const page of pages) {
        const ocr = page.ocr?.data;
        const translation = page.translation?.data;

        if (content === 'both' && (ocr || translation)) {
          lines.push(`--- Page ${page.page_number} ---`);
          if (ocr) {
            lines.push(`[Original]`);
            lines.push(ocr);
            lines.push('');
          }
          if (translation) {
            lines.push(`[Translation]`);
            lines.push(translation);
            lines.push('');
          }
        } else if (content === 'ocr' && ocr) {
          lines.push(`--- Page ${page.page_number} ---`);
          lines.push(ocr);
          lines.push('');
        } else if (content === 'translation' && translation) {
          lines.push(`--- Page ${page.page_number} ---`);
          lines.push(translation);
          lines.push('');
        }
      }

      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // JSON format — structured response
    const pagesWithContent = pages.filter(p => {
      if (content === 'ocr') return p.ocr?.data;
      if (content === 'translation') return p.translation?.data;
      return p.ocr?.data || p.translation?.data;
    });

    const result = {
      book: {
        id: resolvedBookId,
        title: book.display_title || book.title,
        original_title: book.title !== (book.display_title || book.title) ? book.title : undefined,
        author: book.author,
        language: book.language,
        published: book.published,
        year: book.year,
        url: `https://sourcelibrary.org/book/${resolvedBookId}`,
      },
      license: {
        spdx: 'CC-BY-SA-4.0',
        url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attribution: 'Source Library (https://sourcelibrary.org)',
        terms: 'https://sourcelibrary.org/terms',
      },
      content_type: content,
      total_pages: book.pages_count || pages.length,
      pages_returned: pagesWithContent.length,
      pages: pagesWithContent.map(p => {
        const entry: Record<string, unknown> = { page_number: p.page_number };

        if ((content === 'ocr' || content === 'both') && p.ocr?.data) {
          entry.ocr = p.ocr.data;
          if (includeMetadata) {
            entry.ocr_metadata = {
              language: p.ocr.language,
              model: p.ocr.model,
              source: p.ocr.source,
            };
          }
        }
        if ((content === 'translation' || content === 'both') && p.translation?.data) {
          entry.translation = p.translation.data;
          if (includeMetadata) {
            entry.translation_metadata = {
              language: p.translation.language,
              model: p.translation.model,
              source: p.translation.source,
            };
          }
        }
        if (includeMetadata) {
          if (p.page_type) entry.page_type = p.page_type;
          if (p.columns) entry.columns = p.columns;
        }

        return entry;
      }),
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Bulk text error:', error);
    return NextResponse.json({ error: 'Failed to fetch text' }, { status: 500 });
  }
}
