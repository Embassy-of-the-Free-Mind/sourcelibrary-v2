import { connectToDatabase } from '@/lib/mongodb';
import ReadingRoomClient from './ReadingRoomClient';

export const revalidate = false; // 24h ISR

async function getFeaturedPassage() {
  try {
    const { db } = await connectToDatabase();

    // Get random translated pages with decent length
    const results = await db.collection('pages').aggregate([
      {
        $match: {
          'translation.data': { $exists: true, $ne: '' },
          page_number: { $gte: 3, $lte: 200 },
        },
      },
      { $sample: { size: 30 } },
      {
        $project: {
          book_id: 1,
          page_number: 1,
          'translation.data': 1,
        },
      },
    ], { maxTimeMS: 5000 }).toArray();

    // Find a passage that reads well as a quote
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

    const book = await db.collection('books').findOne(
      { id: bestPage.book_id },
      { projection: { title: 1, display_title: 1, author: 1, year: 1, slug: 1, id: 1 }, maxTimeMS: 3000 }
    );

    if (!book) return null;

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
