import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';

const BASE_URL = 'https://sourcelibrary.org';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const db = await getDb();

  const books = await db.collection('books')
    .find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } })
    .sort({ created_at: -1 })
    .limit(50)
    .project({
      id: 1,
      title: 1,
      display_title: 1,
      author: 1,
      year: 1,
      language: 1,
      pages_count: 1,
      pages_ocr: 1,
      pages_translated: 1,
      reading_summary: 1,
      cover_image: 1,
      created_at: 1,
    })
    .toArray();

  const now = new Date().toISOString();
  const latestUpdate = books.length > 0 && books[0].created_at
    ? new Date(books[0].created_at).toISOString()
    : now;

  const entries = books.map((book) => {
    const url = `${BASE_URL}/book/${book.id}`;
    const title = book.display_title || book.title || 'Untitled';
    const updated = book.created_at ? new Date(book.created_at).toISOString() : now;

    const parts = [
      book.author ? `By ${book.author}` : '',
      book.year ? `Published ${book.year}` : '',
      book.language ? `Language: ${book.language}` : '',
      book.pages_count ? `${book.pages_count} pages` : '',
      book.pages_ocr ? `${book.pages_ocr} pages OCR'd` : '',
      book.pages_translated ? `${book.pages_translated} pages translated` : '',
    ].filter(Boolean);

    const summary = book.reading_summary?.overview
      ? book.reading_summary.overview.slice(0, 500)
      : parts.join('. ');

    const coverTag = book.cover_image
      ? `<img src="${escapeXml(book.cover_image.startsWith('/') ? BASE_URL + book.cover_image : book.cover_image)}" alt="${escapeXml(title)}" /><br/>`
      : '';

    return `  <entry>
    <id>${escapeXml(url)}</id>
    <title>${escapeXml(title)}</title>
    <link href="${escapeXml(url)}" rel="alternate" type="text/html"/>
    <updated>${updated}</updated>
    <summary type="text">${escapeXml(parts.join('. '))}</summary>
    <content type="html"><![CDATA[${coverTag}<p>${escapeXml(summary)}</p>]]></content>
    ${book.language ? `<category term="${escapeXml(book.language)}"/>` : ''}
    <author><name>${escapeXml(book.author || 'Source Library')}</name></author>
  </entry>`;
  });

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${BASE_URL}</id>
  <title>Source Library - New Books</title>
  <subtitle>Recently added rare books in alchemy, Hermetica, Kabbalah, and early modern philosophy</subtitle>
  <link href="${BASE_URL}" rel="alternate" type="text/html"/>
  <link href="${BASE_URL}/api/feed/books" rel="self" type="application/atom+xml"/>
  <updated>${latestUpdate}</updated>
  <icon>${BASE_URL}/favicon.ico</icon>
  <author><name>Source Library</name><uri>${BASE_URL}</uri></author>
${entries.join('\n')}
</feed>`;

  return new NextResponse(feed, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
