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

export const revalidate = 3600;

export async function GET() {
  let bookCount = 0;
  let pageCount = 0;
  try {
    const db = await getReadDb();
    bookCount = await db.collection('books').countDocuments(
      { visible: true, slug: { $exists: true, $ne: null }, pages_ocr: { $gt: 0 } },
      { maxTimeMS: 10000 }
    );
    // seo_indexable_id_partial makes this ~50ms; on failure we simply omit the
    // page chunks (the chunk routes still serve, just undiscovered until next ok).
    pageCount = await db.collection('pages').countDocuments(
      { seo_indexable: true },
      { maxTimeMS: 30000 }
    );
  } catch (error) {
    console.error('sitemap-index: count failed', error);
    if (!bookCount) bookCount = 20000;
  }

  const bookChunks = Math.max(1, Math.ceil(bookCount / BOOKS_PER_CHUNK));
  const pageChunks = Math.ceil(pageCount / PAGES_PER_CHUNK);
  const chunkIds = [
    0,
    1,
    ...Array.from({ length: bookChunks }, (_, i) => i + 2),
    ...Array.from({ length: pageChunks }, (_, i) => PAGE_CHUNK_OFFSET + i),
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
