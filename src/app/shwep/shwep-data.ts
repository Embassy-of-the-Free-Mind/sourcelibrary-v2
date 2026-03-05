import { getDb } from '@/lib/mongodb';
import { SHWEP_PERIODS, getAllTags } from '@/data/shwep-episodes';
import { EPISODE_CITED_WORKS, getAllCitedWorks } from '@/data/shwep-cited-works';
import { EPISODE_DESCRIPTIONS } from '@/data/shwep-descriptions';
import { EPISODE_DATES } from '@/data/shwep-dates';

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

async function fetchBooksAndMatch(db: any) {
  const allTags = getAllTags();
  const allCitedWorks = getAllCitedWorks();
  const allTerms = new Set([...allTags, ...allCitedWorks]);

  const books = await db.collection('books').find(
    { deleted: { $ne: true } },
    {
      projection: {
        _id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
        language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
        thumbnail: 1, thumbnail_blob: 1,
        'reading_summary.overview': 1, 'index.bookSummary.brief': 1, summary: 1,
      },
    }
  ).toArray();

  const MAX_MATCHES_PER_TERM = 30;
  const tagSet = new Set(allTags);
  const termBooks: Record<string, MatchedBook[]> = {};

  for (const term of allTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isTag = tagSet.has(term);
    const pattern = isTag
      ? new RegExp(escaped, 'i')
      : new RegExp('\\b' + escaped + '\\b', 'i');

    const matches = books.filter((b: any) =>
      pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
    );

    if (!isTag && matches.length > MAX_MATCHES_PER_TERM) continue;

    if (matches.length > 0) {
      termBooks[term] = matches.map(toMatchedBook);
    }
  }

  return { books, termBooks };
}

function enrichEpisodes(termBooks: Record<string, MatchedBook[]>) {
  return SHWEP_PERIODS.map(period => ({
    ...period,
    episodes: period.episodes.map(ep => {
      const matchedBooks: MatchedBook[] = [];
      const seenIds = new Set<string>();

      const episodeTerms = new Set(ep.tags);
      for (const work of (EPISODE_CITED_WORKS[ep.number] || [])) {
        episodeTerms.add(work);
      }

      for (const term of episodeTerms) {
        for (const book of (termBooks[term] || [])) {
          if (!seenIds.has(book.id)) {
            seenIds.add(book.id);
            matchedBooks.push(book);
          }
        }
      }

      matchedBooks.sort((a, b) => (a.year || 9999) - (b.year || 9999));

      return {
        ...ep,
        description: EPISODE_DESCRIPTIONS[ep.number] || undefined,
        publishDate: EPISODE_DATES[ep.number] || undefined,
        books: matchedBooks,
        bookCount: matchedBooks.length,
      };
    }),
  }));
}

export async function getShwepIndexData(): Promise<ShwepIndexData> {
  const db = await getDb();
  const { books, termBooks } = await fetchBooksAndMatch(db);
  const enrichedPeriods = enrichEpisodes(termBooks);

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
  const allBookIds = new Set<string>();
  for (const p of enrichedPeriods) {
    for (const ep of p.episodes) {
      for (const b of ep.books) allBookIds.add(b.id);
    }
  }

  let galleryImages: GalleryImage[] = [];
  try {
    const rawImages = await db.collection('gallery_images').find(
      {
        book_id: { $in: [...allBookIds] },
        gallery_quality: { $gte: 0.8 },
        type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'ornament', 'border'] },
      },
      {
        projection: { thumbnail_url: 1, extracted_url: 1, description: 1, type: 1, book_id: 1, book_title: 1 },
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
      });
      if (galleryImages.length >= 12) break;
    }
  } catch {
    // Gallery images are optional
  }

  return {
    periods: reversedPeriods,
    galleryImages,
    stats: { totalEpisodes, episodesWithBooks, totalMatches, totalBooksInCollection: books.length },
  };
}

export async function getEpisodeData(episodeNumber: number): Promise<EnrichedEpisode | null> {
  const db = await getDb();
  const { termBooks } = await fetchBooksAndMatch(db);
  const enrichedPeriods = enrichEpisodes(termBooks);

  for (const p of enrichedPeriods) {
    for (const ep of p.episodes) {
      if (ep.number === episodeNumber) return ep;
    }
  }
  return null;
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
