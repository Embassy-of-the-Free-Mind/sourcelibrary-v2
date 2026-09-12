import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

// Next.js 16's generateSitemaps() (in src/app/sitemap.ts) produces chunks at
// /sitemap/{id}.xml but does NOT serve a sitemap-index at /sitemap.xml — so
// robots.txt (which points to /sitemap.xml) was returning 404 and the 17K
// book URLs in the chunks were undiscoverable.
//
// Lives at /sitemap-index (not /sitemap.xml/) because Next's metadata route
// for sitemap.ts uses /sitemap/[__metadata_id__], which collides with a
// sibling /sitemap.xml/ directory and breaks `Collecting page data` at build
// time. next.config.ts rewrites /sitemap.xml → /sitemap-index so external
// crawlers see the canonical path.

const BASE_URL = 'https://sourcelibrary.org';
const BOOKS_PER_CHUNK = 5000;
// Indexable reader-page chunks (issue #2688) live at /sitemap/{1000+i}.xml —
// the offset must match PAGE_CHUNK_OFFSET / PAGES_PER_CHUNK in src/app/sitemap.ts.
// This index route (not Next's auto-index) is what robots.txt's /sitemap.xml
// resolves to, so page chunks must be listed HERE or Google never sees them.
const PAGES_PER_CHUNK = 5000;
const PAGE_CHUNK_OFFSET = 1000;
// Gallery-image and artwork chunks (#4357) — offsets/filters must match
// src/app/sitemap.ts exactly, or the index advertises chunks that 404 (or
// misses ones that exist).
const GALLERY_PER_CHUNK = 5000;
const GALLERY_CHUNK_OFFSET = 2000;
const ARTWORKS_PER_CHUNK = 5000;
const ARTWORK_CHUNK_OFFSET = 3000;

export const revalidate = 3600;

export async function GET() {
  let bookCount = 0;
  let pageCount = 0;
  let galleryCount = 0;
  let artworkCount = 0;
  try {
    const db = await getReadDb();
    // Counts run in parallel; each failure only omits its own chunk range
    // (the chunk routes still serve, just undiscovered until the next ok
    // revalidation). seo_indexable_id_partial keeps the pages count ~50ms.
    [bookCount, pageCount, galleryCount, artworkCount] = await Promise.all([
      db.collection('books').countDocuments(
        { visible: true, slug: { $exists: true, $ne: null }, pages_ocr: { $gt: 0 } },
        { maxTimeMS: 10000 }
      ).catch((error) => { console.error('sitemap-index: book count failed', error); return 0; }),
      db.collection('pages').countDocuments(
        { seo_indexable: true },
        { maxTimeMS: 30000 }
      ).catch((error) => { console.error('sitemap-index: page count failed', error); return 0; }),
      // Gallery images + artworks (#4357).
      db.collection('gallery_images').countDocuments(
        {
          gallery_quality: { $gte: 0.7 },
          book_hidden: { $ne: true },
          book_visible: { $ne: false },
          image_url: { $exists: true, $nin: [null, ''] },
        },
        { maxTimeMS: 30000 }
      ).catch((error) => { console.error('sitemap-index: gallery count failed', error); return 0; }),
      db.collection('books').countDocuments(
        {
          resource_type: { $exists: true, $ne: null },
          content_type: { $ne: 'book' },
          visible: true,
          slug: { $exists: true, $nin: [null, ''] },
        },
        { maxTimeMS: 30000 }
      ).catch((error) => { console.error('sitemap-index: artwork count failed', error); return 0; }),
    ]);
  } catch (error) {
    console.error('sitemap-index: count failed', error);
  }
  if (!bookCount) bookCount = 20000;

  const bookChunks = Math.max(1, Math.ceil(bookCount / BOOKS_PER_CHUNK));
  const pageChunks = Math.ceil(pageCount / PAGES_PER_CHUNK);
  const galleryChunks = Math.ceil(galleryCount / GALLERY_PER_CHUNK);
  const artworkChunks = Math.ceil(artworkCount / ARTWORKS_PER_CHUNK);
  const chunkIds = [
    0,
    1,
    ...Array.from({ length: bookChunks }, (_, i) => i + 2),
    ...Array.from({ length: pageChunks }, (_, i) => PAGE_CHUNK_OFFSET + i),
    ...Array.from({ length: galleryChunks }, (_, i) => GALLERY_CHUNK_OFFSET + i),
    ...Array.from({ length: artworkChunks }, (_, i) => ARTWORK_CHUNK_OFFSET + i),
  ];
  const lastmod = new Date().toISOString();

  const entries = chunkIds
    .map(
      (id) =>
        `  <sitemap><loc>${BASE_URL}/sitemap/${id}.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>
`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
