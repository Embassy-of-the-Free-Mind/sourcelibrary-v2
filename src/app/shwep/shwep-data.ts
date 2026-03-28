import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { SHWEP_PERIODS } from '@/data/shwep-episodes';
import { EPISODE_DESCRIPTIONS } from '@/data/shwep-descriptions';
import { EPISODE_DATES } from '@/data/shwep-dates';
import { SHWEP_BOOK_MATCHES } from '@/data/shwep-book-matches';

export interface MatchedBook {
  id: string;
  title: string;
  author: string;
  year?: number;
  language: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  thumbnail?: string;
  overview?: string;
  url: string;
}

export interface EnrichedEpisode {
  number: number;
  title: string;
  url: string;
  period: string;
  tags: string[];
  description?: string;
  publishDate?: string;
  books: MatchedBook[];
  bookCount: number;
}

export interface EnrichedPeriod {
  id: string;
  name: string;
  description: string;
  dateRange: string;
  episodes: EnrichedEpisode[];
}

export interface GalleryImage {
  id: string;
  thumbnailUrl: string;
  description?: string;
  type?: string;
  bookTitle?: string;
  bookId?: string;
  pageNumber?: number;
}

export interface ShwepIndexData {
  periods: EnrichedPeriod[];
  galleryImages: GalleryImage[];
  stats: {
    totalEpisodes: number;
    episodesWithBooks: number;
    totalMatches: number;
    totalBooksInCollection: number;
  };
}

function toMatchedBook(b: any): MatchedBook {
  const overview =
    b.reading_summary?.overview ||
    b.index?.bookSummary?.brief ||
    (typeof b.summary === 'string' ? b.summary : b.summary?.data) ||
    undefined;
  return {
    id: b._id.toString(),
    title: b.display_title || b.title,
    author: b.author,
    year: b.year || (b.published ? parseInt(b.published) : undefined),
    language: b.language,
    pages_count: b.pages_count,
    pages_ocr: b.pages_ocr,
    pages_translated: b.pages_translated,
    thumbnail: b.thumbnail_blob || b.thumbnail || undefined,
    overview: overview ? String(overview).slice(0, 300) : undefined,
    url: `https://sourcelibrary.org/book/${b._id}`,
  };
}

// Collect all unique book IDs from the LLM match table
function getAllMatchedBookIds(): string[] {
  const ids = new Set<string>();
  for (const bookIds of Object.values(SHWEP_BOOK_MATCHES)) {
    for (const id of bookIds) ids.add(id);
  }
  return [...ids];
}

// Fetch only the books that appear in matches (much faster than loading all 4,800+)
async function fetchMatchedBooks(db: any): Promise<Map<string, MatchedBook>> {
  const allIds = getAllMatchedBookIds();
  const objectIds = allIds.map(id => {
    try { return new ObjectId(id); } catch { return null; }
  }).filter(Boolean);

  const books = await db.collection('books').find(
    { _id: { $in: objectIds }, deleted: { $ne: true } },
    {
      projection: {
        _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
        language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
        thumbnail: 1, thumbnail_blob: 1,
        'reading_summary.overview': 1, 'index.bookSummary.brief': 1, summary: 1,
      },
      maxTimeMS: 45000,
    }
  ).toArray();

  const bookMap = new Map<string, MatchedBook>();
  for (const b of books) {
    bookMap.set(b._id.toString(), toMatchedBook(b));
  }
  return bookMap;
}

function enrichEpisodes(bookMap: Map<string, MatchedBook>) {
  return SHWEP_PERIODS.map(period => ({
    ...period,
    episodes: period.episodes.map(ep => {
      const bookIds = SHWEP_BOOK_MATCHES[ep.number] || [];
      const books = bookIds
        .map(id => bookMap.get(id))
        .filter((b): b is MatchedBook => !!b)
        .sort((a, b) => (a.year || 9999) - (b.year || 9999));

      return {
        ...ep,
        description: EPISODE_DESCRIPTIONS[ep.number] || undefined,
        publishDate: EPISODE_DATES[ep.number] || undefined,
        books,
        bookCount: books.length,
      };
    }),
  }));
}

export async function getShwepIndexData(): Promise<ShwepIndexData> {
  const db = await getDb();
  const bookMap = await fetchMatchedBooks(db);
  const enrichedPeriods = enrichEpisodes(bookMap);

  const totalEpisodes = enrichedPeriods.reduce((sum, p) => sum + p.episodes.length, 0);
  const episodesWithBooks = enrichedPeriods.reduce(
    (sum, p) => sum + p.episodes.filter(e => e.bookCount > 0).length, 0
  );
  const totalMatches = enrichedPeriods.reduce(
    (sum, p) => sum + p.episodes.reduce((s, e) => s + e.bookCount, 0), 0
  );

  const reversedPeriods = [...enrichedPeriods].reverse().map(p => ({
    ...p,
    episodes: [...p.episodes].reverse(),
  }));

  // Gallery images from linked books
  const allBookIds = [...bookMap.keys()];

  let galleryImages: GalleryImage[] = [];
  try {
    const rawImages = await db.collection('gallery_images').find(
      {
        book_id: { $in: allBookIds },
        gallery_quality: { $gte: 0.8 },
        type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'ornament', 'border'] },
      },
      {
        projection: { thumbnail_url: 1, extracted_url: 1, description: 1, type: 1, book_id: 1, book_title: 1, page_number: 1 },
        sort: { gallery_quality: -1 },
        limit: 60,
      }
    ).toArray();

    const bookCounts: Record<string, number> = {};
    for (const img of rawImages) {
      const thumb = img.thumbnail_url || img.extracted_url;
      if (!thumb) continue;
      const bid = img.book_id?.toString() || '';
      bookCounts[bid] = (bookCounts[bid] || 0) + 1;
      if (bookCounts[bid] > 2) continue;
      galleryImages.push({
        id: img._id.toString(),
        thumbnailUrl: thumb,
        description: img.description,
        type: img.type,
        bookTitle: img.book_title,
        bookId: bid,
        pageNumber: img.page_number,
      });
      if (galleryImages.length >= 12) break;
    }
  } catch {
    // Gallery images are optional
  }

  // Get total books count efficiently
  // Use estimatedDocumentCount (instant, metadata-based) instead of slow filtered countDocuments
  const totalBooks = await db.collection('books').estimatedDocumentCount();

  return {
    periods: reversedPeriods,
    galleryImages,
    stats: { totalEpisodes, episodesWithBooks, totalMatches, totalBooksInCollection: totalBooks },
  };
}

export async function getEpisodeData(episodeNumber: number): Promise<EnrichedEpisode | null> {
  // For single episode, only fetch the books matched to this episode
  const bookIds = SHWEP_BOOK_MATCHES[episodeNumber];

  const episode = SHWEP_PERIODS
    .flatMap(p => p.episodes)
    .find(ep => ep.number === episodeNumber);
  if (!episode) return null;

  let books: MatchedBook[] = [];
  if (bookIds && bookIds.length > 0) {
    const db = await getDb();
    const objectIds = bookIds.map(id => {
      try { return new ObjectId(id); } catch { return null; }
    }).filter((id): id is ObjectId => id !== null);

    const rawBooks = await db.collection('books').find(
      { _id: { $in: objectIds }, deleted: { $ne: true } },
      {
        projection: {
          _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
          language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
          thumbnail: 1, thumbnail_blob: 1,
          'reading_summary.overview': 1, 'index.bookSummary.brief': 1, summary: 1,
        },
      }
    ).toArray();

    books = rawBooks
      .map(toMatchedBook)
      .sort((a, b) => (a.year || 9999) - (b.year || 9999));
  }

  return {
    ...episode,
    description: EPISODE_DESCRIPTIONS[episodeNumber] || undefined,
    publishDate: EPISODE_DATES[episodeNumber] || undefined,
    books,
    bookCount: books.length,
  };
}

export function getAllEpisodeNumbers(): number[] {
  const numbers: number[] = [];
  for (const p of SHWEP_PERIODS) {
    for (const ep of p.episodes) {
      numbers.push(ep.number);
    }
  }
  return numbers;
}
