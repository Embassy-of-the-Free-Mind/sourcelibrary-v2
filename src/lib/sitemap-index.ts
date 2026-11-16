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
export const BOOKS_PER_CHUNK = 5000;

/**
 * Which books the sitemap lists. The book chunks (src/app/sitemap.ts) select
 * these and the index counts these, so the two can never disagree. They did:
 * the index counted `pages_ocr > 0` (50,184 books on 2026-11-12) while the
 * chunks selected `pages_count > 0` (71,315), so /sitemap.xml and
 * /sitemap-core.xml listed chunks 2-12 and the newest 16,315 books, served at
 * /sitemap/13-16.xml, were in no index (#78). `pages_count > 0` is the
 * canonical live filter (/api/books/library).
 */
export const SITEMAP_BOOK_FILTER = {
  visible: true,
  slug: { $exists: true, $ne: null },
  pages_count: { $gt: 0 },
};
// Reader-page (/sitemap/1000+) and gallery-image (/sitemap/2000+) chunks are
// still served by src/app/sitemap.ts but no longer listed in either index:
// those URLs now name their book as canonical, so a sitemap must not offer
// them (#3755). Artwork chunks (#4357) stay; offsets must match sitemap.ts.
const ARTWORKS_PER_CHUNK = 5000;
const ARTWORK_CHUNK_OFFSET = 3000;

// PRIOR ART: src/app/sitemap-index/route.ts — moved here unchanged so the full
// index (/sitemap.xml) and the core index (/sitemap-core.xml) share one builder.

/**
 * `core`: static + hub chunks and books only. The full index adds the artwork
 * chunks. Google spends only ~150-250 HTML fetches a day on this
 * host (Search Console crawl stats, Oct 2026), so the core list is submitted on
 * its own to be read first and reported separately (#3755).
 */
export async function sitemapIndexResponse({ core }: { core: boolean }) {
  let bookCount = 0;
  let artworkCount = 0;
  try {
    const db = await getReadDb();
    // Counts run in parallel; each failure only omits its own chunk range
    // (the chunk routes still serve, just undiscovered until the next ok
    // revalidation).
    [bookCount, artworkCount] = await Promise.all([
      db.collection('books').countDocuments(
        SITEMAP_BOOK_FILTER,
        { maxTimeMS: 10000 }
      ).catch((error) => { console.error('sitemap-index: book count failed', error); return 0; }),
      // Artworks (#4357).
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
  const artworkChunks = Math.ceil(artworkCount / ARTWORKS_PER_CHUNK);
  const chunkIds = [
    0,
    1,
    ...Array.from({ length: bookChunks }, (_, i) => i + 2),
    ...(core ? [] : Array.from({ length: artworkChunks }, (_, i) => ARTWORK_CHUNK_OFFSET + i)),
  ];

  // No <lastmod> on index entries (optional in the protocol). It used to be the
  // render time, so every chunk claimed to change hourly, which teaches Google
  // to ignore our dates. Per-URL lastmod inside each chunk stays.
  const entries = chunkIds
    .map((id) => `  <sitemap><loc>${BASE_URL}/sitemap/${id}.xml</loc></sitemap>`)
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
