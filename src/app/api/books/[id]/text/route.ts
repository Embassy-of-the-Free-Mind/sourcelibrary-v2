import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { isBot, isTrustedBot, botMaxPage, botGateResponse } from '@/lib/bot-gate';
import { getChapterTexts } from '@/lib/chapter-text';
import { withApiAuth, type ApiIdentity } from '@/lib/api-auth';
import { checkPageBudget, bulkBudgetExceededBody } from '@/lib/api-budget';
import { isBookReadable } from '@/lib/book-access';
import { CONTENT_LICENSE } from '@/lib/license-info';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';

// This route serves quotable page text (get_book_text tells agents to "copy
// verbatim from the translation field"), so it MUST strip the AI editorial
// wrapper blocks (<meta>/<summary>/<keywords>/<vocab> + the OCR page envelope)
// before output — they describe the page and routinely name adjacent-page
// content, so serving them produces fabricated quotes. Same read-time strip
// the quote API uses; the materialized chapter text has wrappers baked in, so
// stripping must happen here at read time. See CLAUDE.md "Quote & snippet
// integrity" (#2232) and #2822 audit.
function cleanText(text: string | undefined | null): string {
  return text ? stripEditorialWrappers(text).trim() : '';
}

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
export const GET = withApiAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  identity: ApiIdentity
) => {
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

    // Bulk-page budget: defends the paid-tier business model. Key holders pass
    // through; everyone else has a rolling 24h cap on /text page-equivalents.
    // Honors API_AUTH_ENFORCE so log-only mode doesn't break anything yet.
    const enforce = process.env.API_AUTH_ENFORCE === '1';
    const budget = await checkPageBudget({ identity, request });
    if (enforce && !budget.allowed) {
      return NextResponse.json(bulkBudgetExceededBody(budget), {
        status: 429,
        headers: { 'Retry-After': '3600' },
      });
    }

    const db = await getDb();

    // Find book by id or _id
    let book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, pages_count: 1, visible: 1 } }
    );
    if (!book && ObjectId.isValid(bookId)) {
      book = await db.collection('books').findOne(
        { _id: new ObjectId(bookId) },
        { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, pages_count: 1, visible: 1 } }
      );
    }
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Hidden (visible:false) books are not public — 404 unless editor session
    // or CRON_SECRET (pipeline / Claude Code).
    if (!(await isBookReadable(book, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const resolvedBookId = book.id || bookId;

    // Bot gating: non-trusted bots get the first 20% of pages from any book
    const isBotRequest = isBot(request) && !(await isTrustedBot(request));
    const botPageLimit = isBotRequest ? botMaxPage(book.pages_count || 0) : undefined;

    // Per-request page cap. The daily budget check above only sees the PRIOR 24h
    // total, so a single large from/to range (or an unbounded request) could serve
    // far past the cap in ONE call. Clamp this request to the remaining budget for
    // limited tiers; apikey/bot are unlimited (limit < 0 → no cap).
    const budgetPageCap = (enforce && budget.limit > 0) ? Math.max(1, budget.remaining) : undefined;

    // Chapter mode: return pre-materialized chapter text
    if (chapterParam !== null) {
      const chapterIndex = parseInt(chapterParam);
      if (isNaN(chapterIndex) || chapterIndex < 0) {
        return NextResponse.json({ error: 'chapter must be a non-negative integer' }, { status: 400 });
      }

      // Bot page limit: block chapters that start beyond the accessible range
      if (botPageLimit !== undefined) {
        const bookWithChapters = await db.collection('books').findOne(
          { id: resolvedBookId },
          { projection: { chapters: 1, reading_summary: 1, pages_count: 1 } },
        );
        const chapter = bookWithChapters?.chapters?.[chapterIndex];
        if (chapter && chapter.pageStart > botPageLimit) {
          return NextResponse.json(
            botGateResponse({ ...book, ...bookWithChapters, id: resolvedBookId }),
            { status: 200, headers: { 'Cache-Control': 'public, max-age=3600' } }
          );
        }
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

      // Page-equivalent count for the budget: number of underlying pages in this chapter.
      const chapterPageCount = Math.max(1, (ct.pageEnd ?? ct.pageStart) - ct.pageStart + 1);

      if (format === 'plain') {
        const partLabel = ct.parts_total ? ` (part ${ct.part} of ${ct.parts_total})` : '';
        const header = [
          `# ${book.display_title || book.title}`,
          `# ${book.author} (${book.published || 'n.d.'})`,
          `# Chapter ${chapterIndex}: ${ct.titleEn || ct.title}${partLabel}`,
          `# Pages ${ct.pageStart}–${ct.pageEnd}`,
          `# Source: https://sourcelibrary.org/book/${resolvedBookId}`,
          '',
          cleanText(content === 'ocr' ? (ct.ocr_text || ct.text) : ct.text),
        ].join('\n');

        return new Response(header, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'X-Pages-Served': String(chapterPageCount),
          },
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
          text: cleanText(content === 'ocr' ? (ct.ocr_text || ct.text) : ct.text),
          ...(content === 'both' && ct.ocr_text ? { ocr_text: cleanText(ct.ocr_text) } : {}),
        },
      }, {
        headers: {
          'Cache-Control': 'public, max-age=3600',
          'X-Pages-Served': String(chapterPageCount),
        },
      });
    }

    // Build page query. The max page number this request may reach is the
    // tightest of: requested `to`, the bot 20% limit, and the per-request budget
    // cap (counted from the start page). budgetMaxPage closes the granularity gap
    // where one big range would otherwise serve past the daily cap in a single call.
    const startPage = fromPage ?? 1;
    const budgetMaxPage = budgetPageCap !== undefined ? startPage + budgetPageCap - 1 : undefined;
    const pageCaps = [toPage, botPageLimit, budgetMaxPage].filter((v): v is number => v !== undefined);
    const effectiveToPage = pageCaps.length ? Math.min(...pageCaps) : undefined;

    const pageFilter: Record<string, unknown> = { book_id: resolvedBookId };
    if (fromPage !== undefined || effectiveToPage !== undefined) {
      pageFilter.page_number = {};
      if (fromPage !== undefined) (pageFilter.page_number as Record<string, number>).$gte = fromPage;
      if (effectiveToPage !== undefined) (pageFilter.page_number as Record<string, number>).$lte = effectiveToPage;
    }

    // Did the budget cap (not the bot limit / requested range) truncate the result?
    const requestedEnd = toPage ?? (book.pages_count || Number.MAX_SAFE_INTEGER);
    const budgetTruncated = budgetMaxPage !== undefined
      && effectiveToPage === budgetMaxPage
      && requestedEnd > budgetMaxPage;

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
        const ocr = cleanText(page.ocr?.data);
        const translation = cleanText(page.translation?.data);

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
          'X-Pages-Served': String(pages.length),
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
      license: CONTENT_LICENSE,
      content_type: content,
      total_pages: book.pages_count || pages.length,
      pages_returned: pagesWithContent.length,
      ...(botPageLimit !== undefined ? {
        bot_access: {
          truncated: true,
          pages_accessible: botPageLimit,
          pages_total: book.pages_count || pages.length,
          full_access: 'Install the MCP server for full access: claude mcp add source-library -- npx -y @source-library/mcp-server',
          partnership: 'https://sourcelibrary.org/llms.txt',
        },
      } : {}),
      ...(budgetTruncated ? {
        budget: {
          truncated: true,
          reason: 'daily_page_budget',
          last_page_served: budgetMaxPage,
          used_24h: budget.used,
          limit_24h: budget.limit,
          note: budget.tier === 'apikey'
            ? `Served up to p.${budgetMaxPage}; the rest of this range is beyond your Explorer key's daily page budget (${budget.used}/${budget.limit} used in 24h). Upgrade for uncapped /text access (https://sourcelibrary.org/licensing) or bulk-export instead.`
            : `Served up to p.${budgetMaxPage}; the rest of this range is beyond your remaining daily page budget (${budget.used}/${budget.limit} used in 24h). Retrying immediately will be rate-limited — sign in or use an API key for a higher limit, or bulk-export instead.`,
          next_steps: budget.tier === 'apikey'
            ? {
                upgrade: 'https://sourcelibrary.org/licensing',
                bulk_export: 'https://sourcelibrary.org/api/dataset/v1/pages',
              }
            : {
                sign_in: 'https://sourcelibrary.org/auth/signin',
                get_api_key: 'https://sourcelibrary.org/developers',
                bulk_export: 'https://sourcelibrary.org/api/dataset/v1/pages',
              },
        },
      } : {}),
      pages: pagesWithContent.map(p => {
        const entry: Record<string, unknown> = { page_number: p.page_number };

        if ((content === 'ocr' || content === 'both') && p.ocr?.data) {
          entry.ocr = cleanText(p.ocr.data);
          if (includeMetadata) {
            entry.ocr_metadata = {
              language: p.ocr.language,
              model: p.ocr.model,
              source: p.ocr.source,
            };
          }
        }
        if ((content === 'translation' || content === 'both') && p.translation?.data) {
          entry.translation = cleanText(p.translation.data);
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
        'X-Pages-Served': String(pagesWithContent.length),
      },
    });
  } catch (error) {
    console.error('Bulk text error:', error);
    return NextResponse.json({ error: 'Failed to fetch text' }, { status: 500 });
  }
}, { route: 'books.text' });
