/**
 * DTS Navigation Endpoint — Distributed Text Services v1.0
 *
 * GET /api/dts/navigation?resource={bookId}
 * GET /api/dts/navigation?resource={bookId}&ref={pageNum|chapterIdx}
 * GET /api/dts/navigation?resource={bookId}&down={level}
 *
 * Returns the hierarchical citation structure of a text:
 * which citable units exist, their identifiers, and parent relationships.
 * For books with chapters: level 1 = chapters, level 2 = pages.
 * For books without chapters: level 1 = pages.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const BASE = 'https://sourcelibrary.org';

function corsHeaders() {
  return {
    'Content-Type': 'application/ld+json',
    'Access-Control-Allow-Origin': '*',
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const resourceId = searchParams.get('resource');
    const ref = searchParams.get('ref');
    const down = searchParams.get('down')
      ? parseInt(searchParams.get('down')!, 10)
      : undefined;

    if (!resourceId) {
      return NextResponse.json(
        { error: 'resource parameter is required' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const db = await getDb();

    const book = await db.collection('books').findOne(
      { $or: [{ id: resourceId }, { slug: resourceId }] },
      {
        projection: {
          id: 1, title: 1, display_title: 1, pages_count: 1, chapters: 1,
        },
      }
    );

    if (!book) {
      return NextResponse.json(
        { error: `Resource "${resourceId}" not found` },
        { status: 404, headers: corsHeaders() }
      );
    }

    const bookId = book.id as string;
    const chapters = book.chapters as Array<{
      title: string; titleEn?: string; pageNumber: number;
      endPage?: number; level: number;
    }> | undefined;
    const hasChapters = chapters && chapters.length > 0;

    // Build citation tree descriptor
    const citationTree = hasChapters
      ? {
          '@type': 'CitationTree',
          identifier: 'default',
          citeStructure: [
            {
              citeType: 'chapter',
              citeStructure: [{ citeType: 'page' }],
            },
          ],
        }
      : {
          '@type': 'CitationTree',
          identifier: 'default',
          citeStructure: [{ citeType: 'page' }],
        };

    // If ref is specified, return children of that reference
    if (ref) {
      if (hasChapters && ref.startsWith('ch')) {
        // ref is a chapter reference like "ch1" — return its pages
        const chapterIdx = parseInt(ref.replace('ch', ''), 10) - 1;
        const chapter = chapters![chapterIdx];
        if (!chapter) {
          return NextResponse.json(
            { error: `Reference "${ref}" not found` },
            { status: 404, headers: corsHeaders() }
          );
        }

        const startPage = chapter.pageNumber;
        const endPage = chapter.endPage || (chapters![chapterIdx + 1]?.pageNumber
          ? chapters![chapterIdx + 1].pageNumber - 1
          : (book.pages_count as number) || startPage);

        const members = [];
        for (let p = startPage; p <= endPage; p++) {
          members.push({
            ref: `${p}`,
            citeType: 'page',
            'dts:citeAs': `p. ${p}`,
          });
        }

        return NextResponse.json(
          {
            '@context': 'https://dtsapi.org/context/v1.0.json',
            resource: {
              '@id': bookId,
              '@type': 'Resource',
              title: book.display_title || book.title,
              citationTrees: [citationTree],
            },
            ref,
            member: members,
          },
          { headers: corsHeaders() }
        );
      }

      // ref is a page number — return info about that page
      const pageNum = parseInt(ref, 10);
      if (isNaN(pageNum)) {
        return NextResponse.json(
          { error: `Invalid reference "${ref}"` },
          { status: 400, headers: corsHeaders() }
        );
      }

      const unit: Record<string, unknown> = {
        ref: `${pageNum}`,
        citeType: 'page',
        'dts:citeAs': `p. ${pageNum}`,
      };

      // Find parent chapter if applicable
      if (hasChapters) {
        for (let i = 0; i < chapters!.length; i++) {
          const ch = chapters![i];
          const chEnd = ch.endPage || (chapters![i + 1]?.pageNumber
            ? chapters![i + 1].pageNumber - 1
            : (book.pages_count as number));
          if (pageNum >= ch.pageNumber && pageNum <= chEnd) {
            unit['parent'] = `ch${i + 1}`;
            break;
          }
        }
      }

      return NextResponse.json(
        {
          '@context': 'https://dtsapi.org/context/v1.0.json',
          resource: {
            '@id': bookId,
            '@type': 'Resource',
            title: book.display_title || book.title,
            citationTrees: [citationTree],
          },
          ref,
          member: [unit],
        },
        { headers: corsHeaders() }
      );
    }

    // No ref — return top-level citation units
    const members: Record<string, unknown>[] = [];

    if (hasChapters && (!down || down === 1)) {
      // Return chapters as top-level units
      for (let i = 0; i < chapters!.length; i++) {
        const ch = chapters![i];
        if (ch.level > 1) continue; // Only top-level chapters
        members.push({
          ref: `ch${i + 1}`,
          citeType: 'chapter',
          'dts:citeAs': ch.titleEn || ch.title,
          'dts:extensions': {
            pageStart: ch.pageNumber,
            pageEnd: ch.endPage,
          },
        });
      }
    } else {
      // Return pages (either no chapters, or down=2 requesting page level)
      // Only return page numbers — don't load all page documents
      const pagesCount = (book.pages_count as number) || 0;
      for (let p = 1; p <= pagesCount; p++) {
        members.push({
          ref: `${p}`,
          citeType: 'page',
          'dts:citeAs': `p. ${p}`,
        });
      }
    }

    return NextResponse.json(
      {
        '@context': 'https://dtsapi.org/context/v1.0.json',
        resource: {
          '@id': bookId,
          '@type': 'Resource',
          title: book.display_title || book.title,
          citationTrees: [citationTree],
        },
        member: members,
      },
      { headers: corsHeaders() }
    );
  } catch (error) {
    console.error('DTS navigation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
