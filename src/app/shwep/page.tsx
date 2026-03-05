import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { SHWEP_PERIODS, getAllTags } from '@/data/shwep-episodes';
import { EPISODE_CITED_WORKS, getAllCitedWorks } from '@/data/shwep-cited-works';
import { EPISODE_DESCRIPTIONS } from '@/data/shwep-descriptions';
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
  thumbnail?: string;
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

  // Collect all unique search terms: curated tags + crawled cited works
  const allTags = getAllTags();
  const allCitedWorks = getAllCitedWorks();
  const allTerms = new Set([...allTags, ...allCitedWorks]);

  const books = await db.collection('books').find(
    { deleted: { $ne: true } },
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
        thumbnail: 1,
        thumbnail_blob: 1,
      },
    }
  ).toArray();

  function toMatchedBook(b: any): MatchedBook {
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
      url: `https://sourcelibrary.org/book/${b._id}`,
    };
  }

  // Build term → matched books lookup.
  // Tags use substring matching (curated, precise).
  // Cited works use word-boundary matching (broader, needs precision guard).
  // Cap at 30 matches per term to prevent over-broad results.
  const MAX_MATCHES_PER_TERM = 30;
  const tagSet = new Set(allTags);
  const termBooks: Record<string, MatchedBook[]> = {};

  for (const term of allTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isTag = tagSet.has(term);
    // Tags: substring match (curated, precise). Cited works: word-boundary match.
    const pattern = isTag
      ? new RegExp(escaped, 'i')
      : new RegExp('\\b' + escaped + '\\b', 'i');

    const matches = books.filter(b =>
      pattern.test(b.author || '') || pattern.test(b.title || '') || pattern.test(b.display_title || '')
    );

    // Skip overly broad cited works (tags are always kept)
    if (!isTag && matches.length > MAX_MATCHES_PER_TERM) continue;

    if (matches.length > 0) {
      termBooks[term] = matches.map(toMatchedBook);
    }
  }

  const enrichedPeriods = SHWEP_PERIODS.map(period => ({
    ...period,
    episodes: period.episodes.map(ep => {
      const matchedBooks: MatchedBook[] = [];
      const seenIds = new Set<string>();

      // Combine curated tags + crawled cited works for this episode
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

  // Reverse chronological: newest periods and episodes first
  const reversedPeriods = [...enrichedPeriods].reverse().map(p => ({
    ...p,
    episodes: [...p.episodes].reverse(),
  }));

  return {
    periods: reversedPeriods,
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
