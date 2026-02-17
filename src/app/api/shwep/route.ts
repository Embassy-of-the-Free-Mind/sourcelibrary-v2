import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { SHWEP_PERIODS, getAllTags } from '@/data/shwep-episodes';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface MatchedBook {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  year?: number;
  language: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  url: string;
}

/**
 * GET /api/shwep — Returns SHWEP episodes enriched with matching books from our collection.
 *
 * For each episode tag (author/text name), searches the books collection for matches.
 * Returns the full episode structure with matched books attached.
 */
export async function GET() {
  try {
    const db = await getDb();
    const allTags = getAllTags();

    // Build regex patterns for each tag to match against author and title fields
    const tagPatterns = allTags.map(tag => ({
      tag,
      pattern: new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    }));

    // Fetch all books with minimal fields
    const books = await db.collection('books').find(
      {},
      {
        projection: {
          _id: 1,
          title: 1,
          display_title: 1,
          author: 1,
          year: 1,
          published: 1,
          language: 1,
          pages_count: 1,
          pages_ocr: 1,
          pages_translated: 1,
        },
      }
    ).toArray();

    // Build tag → books mapping
    const tagBooks: Record<string, MatchedBook[]> = {};

    for (const { tag, pattern } of tagPatterns) {
      const matches = books.filter(b => {
        const authorMatch = pattern.test(b.author || '');
        const titleMatch = pattern.test(b.title || '') || pattern.test(b.display_title || '');
        return authorMatch || titleMatch;
      });

      tagBooks[tag] = matches.map(b => ({
        id: b._id.toString(),
        title: b.display_title || b.title,
        author: b.author,
        year: b.year || (b.published ? parseInt(b.published) : undefined),
        language: b.language,
        pages_count: b.pages_count,
        pages_ocr: b.pages_ocr,
        pages_translated: b.pages_translated,
        url: `https://sourcelibrary.org/book/${b._id}`,
      }));
    }

    // Enrich episodes with matched books
    const enrichedPeriods = SHWEP_PERIODS.map(period => ({
      ...period,
      episodes: period.episodes.map(ep => {
        const matchedBooks: MatchedBook[] = [];
        const seenIds = new Set<string>();

        for (const tag of ep.tags) {
          for (const book of (tagBooks[tag] || [])) {
            if (!seenIds.has(book.id)) {
              seenIds.add(book.id);
              matchedBooks.push(book);
            }
          }
        }

        // Sort by year ascending
        matchedBooks.sort((a, b) => (a.year || 9999) - (b.year || 9999));

        return {
          ...ep,
          books: matchedBooks,
          bookCount: matchedBooks.length,
        };
      }),
    }));

    // Stats
    const totalEpisodes = enrichedPeriods.reduce((sum, p) => sum + p.episodes.length, 0);
    const episodesWithBooks = enrichedPeriods.reduce(
      (sum, p) => sum + p.episodes.filter(e => e.bookCount > 0).length,
      0
    );
    const totalMatches = enrichedPeriods.reduce(
      (sum, p) => sum + p.episodes.reduce((s, e) => s + e.bookCount, 0),
      0
    );

    return NextResponse.json({
      periods: enrichedPeriods,
      stats: {
        totalEpisodes,
        episodesWithBooks,
        totalMatches,
        totalBooksInCollection: books.length,
      },
    });
  } catch (error) {
    console.error('SHWEP API error:', error);
    return NextResponse.json(
      { error: 'Failed to load SHWEP data' },
      { status: 500 }
    );
  }
}
