/**
 * DTS Navigation Endpoint — Distributed Text Services v1.0
 *
 * GET /api/dts/navigation?resource={bookId}&down=1
 * GET /api/dts/navigation?resource={bookId}&ref={pageNum|chapterRef}&down=1
 * GET /api/dts/navigation?resource={bookId}&ref={ref}  (no down → info about ref only)
 *
 * Returns the hierarchical citation structure of a text.
 * CitableUnit objects follow the spec: identifier, @type, level, parent.
 *
 * For books with chapters: level 1 = chapters (ch1, ch2...), level 2 = pages (1, 2...).
 * For books without chapters: level 1 = pages.
 *
 * Behavior matrix (per DTS v1.0):
 *   - No ref, no down → 400 (must specify what you want)
 *   - No ref, down=1 → top-level units (chapters or pages)
 *   - No ref, down=2 → all units down to level 2
 *   - ref=X, no down → info about unit X only (no member array)
 *   - ref=X, down=1 → children of unit X
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const BASE = 'https://sourcelibrary.org';

function corsHeaders() {
  return {
    'Content-Type': 'application/ld+json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  };
}

interface Chapter {
  title: string;
  titleEn?: string;
  pageNumber: number;
  endPage?: number;
  level: number;
}

function chapterEndPage(
  chapters: Chapter[],
  idx: number,
  totalPages: number
): number {
  const ch = chapters[idx];
  if (ch.endPage) return ch.endPage;
  // Find next chapter at same or higher level
  for (let i = idx + 1; i < chapters.length; i++) {
    if (chapters[i].level <= ch.level) return chapters[i].pageNumber - 1;
  }
  return totalPages;
}

function findPageParent(
  chapters: Chapter[],
  pageNum: number,
  totalPages: number
): string | null {
  for (let i = chapters.length - 1; i >= 0; i--) {
    const ch = chapters[i];
    if (ch.level > 1) continue; // only top-level chapters for parent
    const end = chapterEndPage(chapters, i, totalPages);
    if (pageNum >= ch.pageNumber && pageNum <= end) {
      return `ch${i + 1}`;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const resourceId = searchParams.get('resource');
    const ref = searchParams.get('ref');
    const downParam = searchParams.get('down');
    const down = downParam !== null ? parseInt(downParam, 10) : undefined;

    if (!resourceId) {
      return NextResponse.json(
        { error: 'resource parameter is required' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Per spec: no ref and no down → 400
    if (!ref && down === undefined) {
      return NextResponse.json(
        { error: 'Either ref or down parameter is required' },
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
    const totalPages = (book.pages_count as number) || 0;
    const chapters = (book.chapters as Chapter[] | undefined)?.filter(
      (ch) => ch.level === 1
    );
    const hasChapters = chapters && chapters.length > 0;

    // Citation tree descriptor
    const citationTree = hasChapters
      ? {
          '@type': 'CitationTree',
          citeStructure: [
            {
              '@type': 'CiteStructure',
              citeType: 'chapter',
              citeStructure: [{ '@type': 'CiteStructure', citeType: 'page' }],
            },
          ],
        }
      : {
          '@type': 'CitationTree',
          citeStructure: [{ '@type': 'CiteStructure', citeType: 'page' }],
        };

    const resource = {
      '@id': bookId,
      '@type': 'Resource',
      title: book.display_title || book.title,
      citationTrees: [citationTree],
      collection: `${BASE}/api/dts/collection/{?id,page,nav}`,
      navigation: `${BASE}/api/dts/navigation/{?resource,ref,start,end,down,page}`,
      document: `${BASE}/api/dts/document/{?resource,ref,start,end,mediaType}`,
    };

    // Build the current request URL for @id
    const requestUrl = new URL(request.url);
    requestUrl.host = 'sourcelibrary.org';
    requestUrl.protocol = 'https:';

    // ── ref provided, no down → return info about this unit only (no member) ──
    if (ref && down === undefined) {
      const unit = resolveRef(ref, chapters, hasChapters, totalPages);
      if (!unit) {
        return NextResponse.json(
          { error: `Reference "${ref}" not found` },
          { status: 404, headers: corsHeaders() }
        );
      }

      return NextResponse.json(
        {
          '@context': 'https://dtsapi.org/context/v1.0.json',
          '@id': requestUrl.toString(),
          '@type': 'Navigation',
          dtsVersion: '1.0',
          resource,
          ref: unit,
        },
        { headers: corsHeaders() }
      );
    }

    // ── ref + down → return children of ref ──
    if (ref && down !== undefined) {
      const members = getChildren(ref, down, chapters, hasChapters, totalPages);
      if (members === null) {
        return NextResponse.json(
          { error: `Reference "${ref}" not found` },
          { status: 404, headers: corsHeaders() }
        );
      }

      return NextResponse.json(
        {
          '@context': 'https://dtsapi.org/context/v1.0.json',
          '@id': requestUrl.toString(),
          '@type': 'Navigation',
          dtsVersion: '1.0',
          resource,
          member: members,
        },
        { headers: corsHeaders() }
      );
    }

    // ── no ref, down specified → return top-level units ──
    const members: Record<string, unknown>[] = [];

    if (hasChapters && down === 1) {
      // Return chapters
      for (let i = 0; i < chapters!.length; i++) {
        const ch = chapters![i];
        const end = chapterEndPage(chapters!, i, totalPages);
        members.push({
          identifier: `ch${i + 1}`,
          '@type': 'CitableUnit',
          level: 1,
          parent: null,
          citeType: 'chapter',
          dublinCore: {
            title: [{ value: ch.titleEn || ch.title }],
          },
          extensions: {
            pageStart: ch.pageNumber,
            pageEnd: end,
          },
        });
      }
    } else if (hasChapters && down !== undefined && down >= 2) {
      // Return chapters + their pages
      for (let i = 0; i < chapters!.length; i++) {
        const ch = chapters![i];
        const end = chapterEndPage(chapters!, i, totalPages);
        const chRef = `ch${i + 1}`;
        members.push({
          identifier: chRef,
          '@type': 'CitableUnit',
          level: 1,
          parent: null,
          citeType: 'chapter',
          dublinCore: {
            title: [{ value: ch.titleEn || ch.title }],
          },
        });
        for (let p = ch.pageNumber; p <= end; p++) {
          members.push({
            identifier: `${p}`,
            '@type': 'CitableUnit',
            level: 2,
            parent: chRef,
            citeType: 'page',
          });
        }
      }
    } else {
      // No chapters, or down=1 on flat structure → return pages
      for (let p = 1; p <= totalPages; p++) {
        members.push({
          identifier: `${p}`,
          '@type': 'CitableUnit',
          level: 1,
          parent: null,
          citeType: 'page',
        });
      }
    }

    return NextResponse.json(
      {
        '@context': 'https://dtsapi.org/context/v1.0.json',
        '@id': requestUrl.toString(),
        '@type': 'Navigation',
        dtsVersion: '1.0',
        resource,
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

/** Resolve a ref string to a CitableUnit object */
function resolveRef(
  ref: string,
  chapters: Chapter[] | undefined,
  hasChapters: boolean | undefined,
  totalPages: number
): Record<string, unknown> | null {
  if (hasChapters && ref.startsWith('ch')) {
    const idx = parseInt(ref.replace('ch', ''), 10) - 1;
    if (!chapters || idx < 0 || idx >= chapters.length) return null;
    const ch = chapters[idx];
    const end = chapterEndPage(chapters, idx, totalPages);
    return {
      identifier: ref,
      '@type': 'CitableUnit',
      level: 1,
      parent: null,
      citeType: 'chapter',
      dublinCore: { title: [{ value: ch.titleEn || ch.title }] },
      extensions: { pageStart: ch.pageNumber, pageEnd: end },
    };
  }

  const pageNum = parseInt(ref, 10);
  if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) return null;

  const parent = hasChapters && chapters
    ? findPageParent(chapters, pageNum, totalPages)
    : null;

  return {
    identifier: `${pageNum}`,
    '@type': 'CitableUnit',
    level: hasChapters ? 2 : 1,
    parent,
    citeType: 'page',
  };
}

/** Get children of a ref at the specified depth */
function getChildren(
  ref: string,
  down: number,
  chapters: Chapter[] | undefined,
  hasChapters: boolean | undefined,
  totalPages: number
): Record<string, unknown>[] | null {
  if (hasChapters && ref.startsWith('ch')) {
    const idx = parseInt(ref.replace('ch', ''), 10) - 1;
    if (!chapters || idx < 0 || idx >= chapters.length) return null;
    const ch = chapters[idx];
    const end = chapterEndPage(chapters, idx, totalPages);
    const chRef = `ch${idx + 1}`;

    if (down >= 1) {
      // Return pages within this chapter
      const members: Record<string, unknown>[] = [];
      for (let p = ch.pageNumber; p <= end; p++) {
        members.push({
          identifier: `${p}`,
          '@type': 'CitableUnit',
          level: 2,
          parent: chRef,
          citeType: 'page',
        });
      }
      return members;
    }
    return [];
  }

  // Page ref has no children
  const pageNum = parseInt(ref, 10);
  if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) return null;
  return [];
}
