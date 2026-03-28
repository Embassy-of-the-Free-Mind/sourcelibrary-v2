import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';
export const dynamic = 'force-dynamic';

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

  // Find the 50 most recent high-quality gallery images from materialized collection
  const rawImages = await db.collection('gallery_images')
    .find({ gallery_quality: { $gte: 0.7 } })
    .sort({ updated_at: -1 })
    .limit(50)
    .project({
      page_id: 1, book_id: 1, page_number: 1, detection_index: 1,
      description: 1, type: 1, extracted_url: 1, thumbnail_url: 1,
      gallery_quality: 1, book_title: 1, book_author: 1, book_year: 1, updated_at: 1,
    })
    .toArray();

  // Map to field names used by the feed template
  const images = rawImages.map((img: any) => ({
    pageId: img.page_id,
    bookId: img.book_id,
    pageNumber: img.page_number,
    detectionIndex: img.detection_index,
    description: img.description,
    type: img.type,
    extractedUrl: img.extracted_url,
    thumbnailUrl: img.thumbnail_url,
    galleryQuality: img.gallery_quality,
    bookTitle: img.book_title,
    bookAuthor: img.book_author,
    bookYear: img.book_year,
    updatedAt: img.updated_at,
  }));

  const now = new Date().toISOString();
  const latestUpdate = images.length > 0 && images[0].updatedAt
    ? new Date(images[0].updatedAt).toISOString()
    : now;

  const entries = images.map((img) => {
    const imageId = `${img.pageId}-${img.detectionIndex}`;
    const url = `${BASE_URL}/gallery/image/${imageId}`;
    const title = img.description || 'Gallery Image';
    const bookInfo = img.bookTitle
      ? `From "${img.bookTitle}"${img.bookAuthor ? ` by ${img.bookAuthor}` : ''}${img.bookYear ? ` (${img.bookYear})` : ''}`
      : '';

    const contentParts = [
      img.description || '',
      bookInfo,
      img.type ? `Type: ${img.type}` : '',
    ].filter(Boolean);

    const thumbnailUrl = img.extractedUrl || img.thumbnailUrl;
    const imageTag = thumbnailUrl
      ? `<img src="${escapeXml(thumbnailUrl.startsWith('/') ? BASE_URL + thumbnailUrl : thumbnailUrl)}" alt="${escapeXml(title)}" /><br/>`
      : '';

    const updated = img.updatedAt ? new Date(img.updatedAt).toISOString() : now;

    return `  <entry>
    <id>${escapeXml(url)}</id>
    <title>${escapeXml(title)}</title>
    <link href="${escapeXml(url)}" rel="alternate" type="text/html"/>
    <updated>${updated}</updated>
    <summary type="text">${escapeXml(bookInfo || title)}</summary>
    <content type="html"><![CDATA[${imageTag}<p>${contentParts.join('</p><p>')}</p>]]></content>
    <category term="${escapeXml(img.type || 'illustration')}"/>
    <author><name>Source Library</name></author>
  </entry>`;
  });

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${BASE_URL}/gallery</id>
  <title>Source Library Gallery</title>
  <subtitle>Illustrations, diagrams, and engravings from rare Hermetic, alchemical, and philosophical texts</subtitle>
  <link href="${BASE_URL}/gallery" rel="alternate" type="text/html"/>
  <link href="${BASE_URL}/api/feed/gallery" rel="self" type="application/atom+xml"/>
  <updated>${latestUpdate}</updated>
  <icon>${BASE_URL}/favicon.ico</icon>
  <author><name>Source Library</name><uri>${BASE_URL}</uri></author>
  <rights>Images sourced from public domain collections. See individual entries for attribution.</rights>
${entries.join('\n')}
</feed>`;

  return new NextResponse(feed, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
