import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';
export const revalidate = 3600; // Cache for 1 hour

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

  // Find the 50 most recent high-quality gallery images
  const pipeline = [
    {
      $match: {
        'detected_images': { $exists: true, $ne: [] },
        'detected_images.gallery_quality': { $gte: 0.7 },
      },
    },
    { $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } },
    { $match: { 'detected_images.gallery_quality': { $gte: 0.7 } } },
    {
      $lookup: {
        from: 'books',
        let: { bookId: '$book_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', '$$bookId'] } } },
          { $project: { title: 1, display_title: 1, author: 1, year: 1 } },
        ],
        as: 'book',
      },
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    { $sort: { updated_at: -1 as const } },
    { $limit: 50 },
    {
      $project: {
        pageId: '$id',
        bookId: '$book_id',
        pageNumber: '$page_number',
        detectionIndex: 1,
        description: '$detected_images.description',
        museumDescription: '$detected_images.museum_description',
        type: '$detected_images.type',
        extractedUrl: '$detected_images.extracted_url',
        thumbnailUrl: '$detected_images.thumbnail_url',
        metadata: '$detected_images.metadata',
        galleryQuality: '$detected_images.gallery_quality',
        bookTitle: { $ifNull: ['$book.display_title', '$book.title'] },
        bookAuthor: '$book.author',
        bookYear: '$book.year',
        updatedAt: '$updated_at',
      },
    },
  ];

  const images = await db.collection('pages').aggregate(pipeline).toArray();

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

    const subjects = img.metadata?.subjects?.join(', ') || '';
    const contentParts = [
      img.museumDescription || img.description || '',
      bookInfo,
      img.type ? `Type: ${img.type}` : '',
      subjects ? `Subjects: ${subjects}` : '',
    ].filter(Boolean);

    const thumbnailUrl = img.thumbnailUrl || img.extractedUrl;
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
