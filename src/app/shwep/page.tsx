import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { SHWEP_PERIODS, getAllTags } from '@/data/shwep-episodes';
import ShwepClient from './ShwepClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SHWEP Reading Room - Source Library',
  description: 'Read the primary sources discussed on the Secret History of Western Esotericism Podcast. Browse episodes and access original texts in Latin, Greek, and other languages.',
  alternates: {
    canonical: '/shwep',
  },
  openGraph: {
    title: 'SHWEP Reading Room - Source Library',
    description: 'Read the primary sources discussed on the Secret History of Western Esotericism Podcast.',
    url: 'https://sourcelibrary.org/shwep',
  },
};

export interface MatchedBook {
  id: string;
  title: string;
  author: string;
  year?: number;
  language: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  url: string;
}

export interface EnrichedEpisode {
  number: number;
  title: string;
  url: string;
  period: string;
  tags: string[];
  description?: string;
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

export interface ShwepPageData {
  periods: EnrichedPeriod[];
  stats: {
    totalEpisodes: number;
    episodesWithBooks: number;
    totalMatches: number;
    totalBooksInCollection: number;
  };
}

async function getShwepData(): Promise<ShwepPageData> {
  const db = await getDb();
  const allTags = getAllTags();

  const tagPatterns = allTags.map(tag => ({
    tag,
    pattern: new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  }));

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

      matchedBooks.sort((a, b) => (a.year || 9999) - (b.year || 9999));

      return {
        ...ep,
        books: matchedBooks,
        bookCount: matchedBooks.length,
      };
    }),
  }));

  const totalEpisodes = enrichedPeriods.reduce((sum, p) => sum + p.episodes.length, 0);
  const episodesWithBooks = enrichedPeriods.reduce(
    (sum, p) => sum + p.episodes.filter(e => e.bookCount > 0).length,
    0
  );
  const totalMatches = enrichedPeriods.reduce(
    (sum, p) => sum + p.episodes.reduce((s, e) => s + e.bookCount, 0),
    0
  );

  return {
    periods: enrichedPeriods,
    stats: {
      totalEpisodes,
      episodesWithBooks,
      totalMatches,
      totalBooksInCollection: books.length,
    },
  };
}

export default async function ShwepPage() {
  const data = await getShwepData();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <ShwepClient data={data} />
    </div>
  );
}
