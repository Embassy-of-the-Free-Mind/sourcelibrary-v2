import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

// Next.js 16's generateSitemaps() (in src/app/sitemap.ts) produces chunks at
// /sitemap/{id}.xml but does NOT serve a sitemap-index at /sitemap.xml — so
// robots.txt (which points to /sitemap.xml) ends up 404, and Google never
// discovers the chunks. This route fills that gap.

const BASE_URL = 'https://sourcelibrary.org';
const BOOKS_PER_CHUNK = 5000;

export const revalidate = 3600;

export async function GET() {
  let bookCount = 0;
  try {
    const db = await getReadDb();
    bookCount = await db.collection('books').countDocuments(
      { visible: true, slug: { $exists: true, $ne: null }, pages_ocr: { $gt: 0 } },
      { maxTimeMS: 10000 }
    );
  } catch (error) {
    console.error('sitemap.xml index: book count failed', error);
    bookCount = 20000;
  }

  const bookChunks = Math.max(1, Math.ceil(bookCount / BOOKS_PER_CHUNK));
  const chunkIds = [0, 1, ...Array.from({ length: bookChunks }, (_, i) => i + 2)];
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
