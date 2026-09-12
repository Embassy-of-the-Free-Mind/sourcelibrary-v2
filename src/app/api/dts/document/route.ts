/**
 * DTS Document Endpoint — Distributed Text Services v1.0
 *
 * GET /api/dts/document?resource={bookId}
 * GET /api/dts/document?resource={bookId}&ref={pageNum}
 * GET /api/dts/document?resource={bookId}&start={pageNum}&end={pageNum}
 * GET /api/dts/document?resource={bookId}&ref={pageNum}&mediaType=text/html
 *
 * Retrieves text content for a passage. Returns OCR text by default;
 * use &edition=translation for the English translation.
 *
 * Bot page gating applies: untrusted bots can only access the first 20% of pages.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { isBot, isTrustedBot, botMaxPage } from '@/lib/bot-gate';
import { isMeteredAnonRequest } from '@/lib/metered-gate';
import { resolveTenantId } from '@/lib/tenant-context';
import { dtsPageText } from '@/lib/dts-text';

const BASE = 'https://sourcelibrary.org';

function corsHeaders(contentType: string, resourceId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  };
  // DTS spec: Link header points to Collection endpoint for this resource
  if (resourceId) {
    headers['Link'] =
      `<${BASE}/api/dts/collection/?id=${encodeURIComponent(resourceId)}>; rel="collection"`;
  }
  return headers;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const resourceId = searchParams.get('resource');
    const ref = searchParams.get('ref');
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const mediaType = searchParams.get('mediaType') || 'text/plain';
    const edition = searchParams.get('edition') || 'original'; // 'original' | 'translation'

    if (!resourceId) {
      return NextResponse.json(
        { error: 'resource parameter is required' },
        { status: 400 }
      );
    }

    const db = await getReadDb();
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (!tenantId) {
      return NextResponse.json(
        { error: `Resource "${resourceId}" not found` },
        { status: 404 }
      );
    }

    const book = await db.collection('books').findOne(
      { $and: [{ tenantId }, { $or: [{ id: resourceId }, { slug: resourceId }] }] },
      {
        projection: {
          id: 1, title: 1, display_title: 1, slug: 1,
          author: 1, published: 1, language: 1,
          pages_count: 1, chapters: 1, license: 1,
        },
      }
    );

    if (!book) {
      return NextResponse.json(
        { error: `Resource "${resourceId}" not found` },
        { status: 404 }
      );
    }

    const bookId = book.id as string;
    const pagesCount = (book.pages_count as number) || 0;

    // Bot gating — and, when METERED_READER=1, the same free-sample clamp
    // for anonymous humans (#4357): DTS document serves full page text, so
    // leaving it open would hand the reader wall's content out the side
    // door. The human clamp applies only to default-tenant books — named
    // tenants are partner reading rooms and stay exempt, matching the pages
    // API. (Today every DTS-servable book is tenant-tagged to a partner, so
    // the human clamp is dormant even with the flag on; it exists for any
    // future default-tagged book.)
    const bot = isBot(request);
    const trusted = bot && (await isTrustedBot(request));
    const defaultTenantId = await resolveTenantId('default').catch(() => null);
    const meteredHuman = !bot
      && tenantId === defaultTenantId
      && (await isMeteredAnonRequest(request));
    const clampToFree = (bot && !trusted) || meteredHuman;
    const maxPage = clampToFree ? botMaxPage(pagesCount) : pagesCount;

    // Determine page range to fetch
    let startPage: number;
    let endPage: number;

    if (ref) {
      // Check if ref is a chapter reference
      const chapters = book.chapters as Array<{
        title: string; pageNumber: number; endPage?: number;
      }> | undefined;

      if (ref.startsWith('ch') && chapters?.length) {
        const chapterIdx = parseInt(ref.replace('ch', ''), 10) - 1;
        const chapter = chapters[chapterIdx];
        if (!chapter) {
          return NextResponse.json(
            { error: `Reference "${ref}" not found` },
            { status: 404 }
          );
        }
        startPage = chapter.pageNumber;
        endPage = chapter.endPage || (chapters[chapterIdx + 1]?.pageNumber
          ? chapters[chapterIdx + 1].pageNumber - 1
          : pagesCount);
      } else {
        startPage = parseInt(ref, 10);
        endPage = startPage;
      }
    } else if (start && end) {
      startPage = parseInt(start, 10);
      endPage = parseInt(end, 10);
    } else {
      // Full document
      startPage = 1;
      endPage = pagesCount;
    }

    if (isNaN(startPage) || isNaN(endPage) || startPage < 1) {
      return NextResponse.json(
        { error: 'Invalid page reference' },
        { status: 400 }
      );
    }

    // Apply bot gating
    if (bot && !trusted && endPage > maxPage) {
      endPage = maxPage;
      if (startPage > maxPage) {
        return NextResponse.json(
          {
            error: 'Page gated',
            message: `Bot access limited to pages 1–${maxPage}. Full text available via MCP server or API partnership.`,
            mcp_install: 'claude mcp add source-library -- npx -y @source-library/mcp-server',
          },
          { status: 403, headers: corsHeaders('application/json', bookId) }
        );
      }
    }

    // Fetch pages
    const textField = edition === 'translation' ? 'translation.data' : 'ocr.data';
    const pages = await db
      .collection('pages')
      .find(
        {
          book_id: bookId,
          page_number: { $gte: startPage, $lte: endPage },
        },
        {
          projection: { page_number: 1, [textField]: 1 },
          sort: { page_number: 1 },
        }
      )
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json(
        { error: 'No content found for the specified range' },
        { status: 404 }
      );
    }

    // Format output
    const title = (book.display_title || book.title) as string;
    const author = book.author as string;

    if (mediaType === 'text/html') {
      const htmlParts = pages.map((p) => {
        const text = dtsPageText(edition === 'translation' ? p.translation?.data : p.ocr?.data);
        const pageNum = p.page_number;
        return `<div class="dts-page" data-ref="${pageNum}" id="p${pageNum}">\n`
          + `<h3>Page ${pageNum}</h3>\n`
          + `<div class="dts-content">${escapeHtml(text).replace(/\n/g, '<br/>')}</div>\n`
          + `</div>`;
      });

      const html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n`
        + `<meta charset="utf-8"/>\n`
        + `<title>${escapeHtml(title)} — ${escapeHtml(author)}</title>\n`
        + `<link rel="alternate" type="application/ld+json" href="${BASE}/api/dts/collection?id=${bookId}"/>\n`
        + `</head>\n<body>\n`
        + `<header>\n<h1>${escapeHtml(title)}</h1>\n<h2>${escapeHtml(author)}</h2>\n</header>\n`
        + htmlParts.join('\n')
        + `\n</body>\n</html>`;

      return new NextResponse(html, { headers: corsHeaders('text/html; charset=utf-8', bookId) });
    }

    // Default: text/plain
    const textParts = pages.map((p) => {
      const text = dtsPageText(edition === 'translation' ? p.translation?.data : p.ocr?.data);
      return `--- Page ${p.page_number} ---\n${text}`;
    });

    const header = `${title}\n${author} (${book.published || 'n.d.'})\n`
      + `Source Library: ${BASE}/book/${book.slug || bookId}\n\n`;

    return new NextResponse(header + textParts.join('\n\n'), {
      headers: corsHeaders('text/plain; charset=utf-8', bookId),
    });
  } catch (error) {
    console.error('DTS document error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
