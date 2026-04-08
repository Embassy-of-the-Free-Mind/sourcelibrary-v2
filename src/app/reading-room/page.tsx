import { connectToDatabase } from '@/lib/mongodb';
import ReadingRoomClient from './ReadingRoomClient';

export const revalidate = 86400; // 24h ISR

async function getHeroImages(): Promise<{ url: string; key: string }[]> {
  try {
    const { db } = await connectToDatabase();

    const images = await db.collection('gallery_images').aggregate([
      // Sample first so MongoDB uses its fast random-cursor optimization,
      // then filter — avoids a full scan of all matching documents.
      { $sample: { size: 200 } },
      {
        $match: {
          gallery_quality: { $gte: 0.8 },
          type: { $in: ['engraving', 'woodcut', 'diagram', 'illustration', 'painting'] },
          thumbnail_url: { $exists: true, $ne: '' },
        },
      },
      { $limit: 12 },
      {
        $project: {
          thumbnail_url: 1,
          _id: 1,
        },
      },
    ], { maxTimeMS: 8000 }).toArray();

    return images.map((img) => ({
      url: img.thumbnail_url as string,
      key: img._id.toString(),
    }));
  } catch (err) {
    console.error('[reading-room] Failed to load hero images:', err);
    return [];
  }
}

async function getFeaturedPassage() {
  try {
    const { db } = await connectToDatabase();

    // Step 1: pick a random translated book from the (small) books collection.
    // `pages_translated` is a cached counter kept in sync by the pipeline —
    // querying it is fast and index-friendly.
    const books = await db.collection('books').aggregate([
      { $match: { pages_translated: { $gt: 20 } } },
      { $sample: { size: 1 } },
      { $project: { title: 1, display_title: 1, author: 1, year: 1, slug: 1, id: 1 } },
    ], { maxTimeMS: 5000 }).toArray();

    if (!books.length) return null;
    const book = books[0];

    // Step 2: fetch translated pages for just that book — hits the book_id index.
    const results = await db.collection('pages').find(
      {
        book_id: book.id,
        'translation.data': { $exists: true, $ne: '' },
        page_number: { $gte: 3, $lte: 200 },
      },
      {
        projection: { book_id: 1, page_number: 1, 'translation.data': 1 },
        maxTimeMS: 5000,
      }
    ).toArray();

    // Find a passage that reads well as a quote
    // Shuffle so we don't always pick the earliest page
    results.sort(() => Math.random() - 0.5);

    let bestPage = null;
    for (const page of results) {
      const text = (page.translation?.data || '').trim();
      if (text.length < 80 || text.length > 600) continue;
      // Skip structural/metadata pages
      if (text.includes('<pb') || text.includes('<gap')) continue;
      if ((text.match(/</g) || []).length > 3) continue;
      if (/^\d/.test(text) || /^(chapter|section|part|index|table|page|finis)/i.test(text)) continue;
      // Prefer pages that start with a capital letter (natural prose)
      if (/^[A-Z]/.test(text)) {
        bestPage = page;
        break;
      }
      if (!bestPage) bestPage = page;
    }

    if (!bestPage) return null;

    // Clean and truncate the excerpt
    let excerpt = (bestPage.translation?.data || '').trim();
    excerpt = excerpt.replace(/<[^>]+>/g, '').trim();

    if (excerpt.length > 280) {
      const truncated = excerpt.slice(0, 300);
      const lastPeriod = truncated.lastIndexOf('.');
      const lastQuestion = truncated.lastIndexOf('?');
      const lastExclaim = truncated.lastIndexOf('!');
      const cutPoint = Math.max(lastPeriod, lastQuestion, lastExclaim);
      excerpt = cutPoint > 80 ? truncated.slice(0, cutPoint + 1) : truncated.slice(0, 280) + '...';
    }

    return {
      text: excerpt,
      bookTitle: book.display_title || book.title,
      bookAuthor: book.author,
      bookYear: book.year,
      bookSlug: book.slug || book.id,
      pageNumber: bestPage.page_number,
    };
  } catch (err) {
    console.error('[reading-room] Failed to load featured passage:', err);
    return null;
  }
}

export default async function ReadingRoomPage() {
  const featuredPassage = await getFeaturedPassage();

  return (
    <ReadingRoomClient
      featuredPassage={featuredPassage}
    />
  );
}
