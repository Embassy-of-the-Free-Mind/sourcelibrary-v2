/**
 * DTS Collection Endpoint — Distributed Text Services v1.0
 *
 * GET /api/dts/collection
 * GET /api/dts/collection?id={collectionSlug|bookId}
 * GET /api/dts/collection?id={id}&page={n}
 * GET /api/dts/collection?id={id}&nav=parents
 *
 * Navigates across texts. The root collection contains all Source Library
 * collections as children. Each collection contains its books as Resources.
 * Individual books are Resources with citationTrees describing their
 * page/chapter structure.
 *
 * Dublin Core metadata uses the DTS v1.0 dublinCore format with lang/value pairs.
 * Source Library extensions (IIIF links, site URLs) go under `extensions`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const BASE = 'https://sourcelibrary.org';
const PAGE_SIZE = 50;

const LANG_CODES: Record<string, string> = {
  latin: 'la', german: 'de', french: 'fr', english: 'en',
  italian: 'it', dutch: 'nl', spanish: 'es', greek: 'el',
  hebrew: 'he', arabic: 'ar', sumerian: 'sux', akkadian: 'akk',
};

function langCode(language?: string): string {
  if (!language) return 'none';
  const lower = language.toLowerCase();
  return LANG_CODES[lower] || lower.slice(0, 2);
}

function corsHeaders() {
  return {
    'Content-Type': 'application/ld+json',
    'Access-Control-Allow-Origin': '*',
  };
}

/**
 * Build a DTS Resource (individual text) from a book document.
 */
function bookToResource(book: Record<string, unknown>) {
  const bookId = book.id as string;
  const slug = (book.slug as string) || bookId;
  const lang = langCode(book.language as string);
  const chapters = book.chapters as Array<{
    title: string; titleEn?: string; pageNumber: number;
    endPage?: number; level: number;
  }> | undefined;

  // Build citation tree — no `identifier` when there's only one tree
  const hasChapters = chapters && chapters.length > 0;
  const citationTrees = [
    hasChapters
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
        },
  ];

  // Dublin Core per DTS v1.0 format: lang/value pairs
  const titles: Array<{ lang: string; value: string }> = [
    { lang, value: book.title as string },
  ];
  if (book.display_title && book.display_title !== book.title) {
    titles.push({ lang: 'en', value: book.display_title as string });
  }

  const dublinCore: Record<string, unknown> = {
    title: titles,
    creator: [{ value: book.author as string }],
    date: book.published,
    language: [lang],
  };

  if (book.doi) dublinCore.identifier = `doi:${book.doi}`;
  if (book.place_published) dublinCore.spatial = book.place_published;
  if (book.publisher) dublinCore.publisher = book.publisher;

  const resource: Record<string, unknown> = {
    '@id': bookId,
    '@type': 'Resource',
    dtsVersion: '1.0',
    collection: `${BASE}/api/dts/collection/{?id,page,nav}`,
    navigation: `${BASE}/api/dts/navigation/{?resource,ref,start,end,down,page}`,
    document: `${BASE}/api/dts/document/{?resource,ref,start,end,mediaType}`,
    title: book.display_title || book.title,
    totalChildren: 0,
    totalParents: (book.collections as string[] | undefined)?.length || 0,
    dublinCore,
    citationTrees,
    download: `${BASE}/api/books/${bookId}/download?format=txt`,
    extensions: {
      'iiif:manifest': `${BASE}/api/iiif/${bookId}/manifest`,
      url: `${BASE}/book/${slug}`,
    },
  };

  return resource;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const nav = searchParams.get('nav') || 'children';

    const db = await getDb();

    // No id → return root collection
    if (!id) {
      const collections = await db
        .collection('collections')
        .find({
          collection_type: { $ne: 'visual_art' },
          parent: { $exists: false },
          $or: [
            { type: { $ne: 'curated' } },
            { type: 'curated', published: true },
          ],
        })
        .sort({ order: 1 })
        .project({ slug: 1, name: 1, description: 1, book_count: 1 })
        .toArray();

      const members = collections.map((c) => ({
        '@id': c.slug,
        '@type': 'Collection',
        title: c.name,
        description: c.description || '',
        totalChildren: c.book_count || 0,
        totalParents: 1, // all are children of root
        collection: `${BASE}/api/dts/collection/{?id,page,nav}`,
        extensions: {
          url: `${BASE}/collection/${c.slug}`,
        },
      }));

      return NextResponse.json(
        {
          '@context': 'https://dtsapi.org/context/v1.0.json',
          '@id': 'root',
          '@type': 'Collection',
          dtsVersion: '1.0',
          collection: `${BASE}/api/dts/collection/{?id,page,nav}`,
          title: 'Source Library',
          description:
            'Pre-modern texts in translation — alchemy, Hermetica, Kabbalah, natural philosophy, and the encyclopedic ambitions of early modern Europe.',
          totalChildren: collections.length,
          totalParents: 0,
          member: members,
        },
        { headers: corsHeaders() }
      );
    }

    // Check if id is a collection slug
    const collection = await db
      .collection('collections')
      .findOne({ slug: id });

    if (collection) {
      // Return collection with paginated book members
      const skip = (page - 1) * PAGE_SIZE;
      const filter = {
        collections: id,
        pages_count: { $gt: 0 },
      };

      const [books, total] = await Promise.all([
        db
          .collection('books')
          .find(filter)
          .sort({ author: 1, published: 1 })
          .skip(skip)
          .limit(PAGE_SIZE)
          .project({
            id: 1, slug: 1, title: 1, display_title: 1, author: 1,
            published: 1, language: 1, pages_count: 1, doi: 1,
            place_published: 1, publisher: 1, chapters: 1, collections: 1,
          })
          .toArray(),
        db.collection('books').countDocuments(filter),
      ]);

      const members = books.map(bookToResource);
      const totalPages = Math.ceil(total / PAGE_SIZE);

      const result: Record<string, unknown> = {
        '@context': 'https://dtsapi.org/context/v1.0.json',
        '@id': id,
        '@type': 'Collection',
        dtsVersion: '1.0',
        collection: `${BASE}/api/dts/collection/{?id,page,nav}`,
        title: collection.name,
        description: collection.description || '',
        totalChildren: total,
        totalParents: collection.parent ? 1 : 1, // parent collection or root
        member: members,
        extensions: {
          url: `${BASE}/collection/${id}`,
        },
      };

      // Pagination
      if (totalPages > 1) {
        result['view'] = {
          '@id': `${BASE}/api/dts/collection?id=${id}&page=${page}`,
          '@type': 'Pagination',
          first: `${BASE}/api/dts/collection?id=${id}&page=1`,
          last: `${BASE}/api/dts/collection?id=${id}&page=${totalPages}`,
          ...(page < totalPages
            ? { next: `${BASE}/api/dts/collection?id=${id}&page=${page + 1}` }
            : {}),
          ...(page > 1
            ? { previous: `${BASE}/api/dts/collection?id=${id}&page=${page - 1}` }
            : {}),
        };
      }

      return NextResponse.json(result, { headers: corsHeaders() });
    }

    // Check if id is a book id or slug
    const book = await db.collection('books').findOne(
      { $or: [{ id }, { slug: id }] },
      {
        projection: {
          id: 1, slug: 1, title: 1, display_title: 1, author: 1,
          published: 1, language: 1, pages_count: 1, doi: 1,
          place_published: 1, publisher: 1, chapters: 1,
          collections: 1, license: 1,
        },
      }
    );

    if (book) {
      const resource = bookToResource(book);

      // If nav=parents, show which collections this book belongs to
      if (nav === 'parents' && book.collections?.length) {
        const parentCollections = await db
          .collection('collections')
          .find({ slug: { $in: book.collections } })
          .project({ slug: 1, name: 1, book_count: 1 })
          .toArray();

        resource['member'] = parentCollections.map((c: Record<string, unknown>) => ({
          '@id': c.slug,
          '@type': 'Collection',
          title: c.name,
          totalChildren: c.book_count || 0,
          totalParents: 1,
          collection: `${BASE}/api/dts/collection/{?id,page,nav}`,
        }));
      }

      return NextResponse.json(
        { '@context': 'https://dtsapi.org/context/v1.0.json', ...resource },
        { headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      { error: `Resource "${id}" not found` },
      { status: 404, headers: corsHeaders() }
    );
  } catch (error) {
    console.error('DTS collection error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}
