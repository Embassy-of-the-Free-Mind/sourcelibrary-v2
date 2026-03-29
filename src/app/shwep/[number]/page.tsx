import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEpisodeData, getAllEpisodeNumbers } from '../shwep-data';
import type { MatchedBook } from '../shwep-data';

export const revalidate = 600;

interface Props {
  params: Promise<{ number: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  let ep;
  try {
    ep = await getEpisodeData(parseInt(number));
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }
  if (!ep) return { title: 'Episode Not Found - SHWEP Reading Room', robots: { index: false, follow: true } };
  return {
    title: `${ep.title} - SHWEP Reading Room`,
    description: ep.description || `Primary sources discussed in SHWEP episode ${ep.number}.`,
    alternates: { canonical: `/shwep/${ep.number}` },
    openGraph: {
      title: `${ep.title} - SHWEP Reading Room`,
      description: ep.description || `Primary sources discussed in SHWEP episode ${ep.number}.`,
      url: `https://sourcelibrary.org/shwep/${ep.number}`,
    },
  };
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default async function EpisodePage({ params }: Props) {
  const { number } = await params;
  const epNum = parseInt(number);
  if (isNaN(epNum)) notFound();

  const episode = await getEpisodeData(epNum);
  if (!episode) notFound();

  const translatedCount = episode.books.filter(b => (b.pages_translated || 0) > 0).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
          <span className="text-stone-300">/</span>
          <Link href="/shwep" className="text-stone-500 hover:text-stone-800 transition-colors text-sm">
            SHWEP Reading Room
          </Link>
        </div>
      </header>

      {/* Caveat */}
      <div className="bg-stone-100 border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-2.5 text-sm text-stone-500">
          Source Library provides the primary texts — we are not affiliated with{' '}
          <a href="https://shwep.net" target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">SHWEP</a>.
        </div>
      </div>

      {/* Episode header */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12 md:py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center gap-3 mb-4 text-sm text-stone-400">
            <span>Episode {episode.number}</span>
            {episode.publishDate && (
              <>
                <span>&middot;</span>
                <span>{formatDate(episode.publishDate)}</span>
              </>
            )}
            <span>&middot;</span>
            <span>{episode.period}</span>
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif leading-tight mb-4">
            {episode.title}
          </h1>

          {episode.description && (
            <p className="text-lg text-stone-300 max-w-3xl leading-relaxed">
              {episode.description}
            </p>
          )}

          <div className="mt-6 flex items-center gap-4">
            <a
              href={episode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              Listen on SHWEP
            </a>
            {episode.bookCount > 0 && (
              <span className="text-sm text-stone-400">
                {episode.bookCount} source{episode.bookCount !== 1 ? 's' : ''} in collection
                {translatedCount > 0 && ` · ${translatedCount} translated`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Books */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {episode.bookCount > 0 ? (
          <>
            <h2 className="text-xl font-serif text-stone-800 mb-6">
              Primary Sources
            </h2>
            <div className="space-y-4">
              {episode.books.map(book => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-stone-500">
            <p className="text-lg mb-2">No matching source texts in the collection yet.</p>
            <p className="text-sm">
              <Link href="/contribute" className="text-accent-rust underline">Suggest a book</Link> to help expand coverage.
            </p>
          </div>
        )}

        {/* Back link */}
        <div className="mt-12 pt-8 border-t border-stone-200">
          <Link href="/shwep" className="text-sm text-stone-500 hover:text-stone-700 transition-colors">
            &larr; Back to all episodes
          </Link>
        </div>
      </div>
    </div>
  );
}

function BookCard({ book }: { book: MatchedBook }) {
  const hasTranslation = (book.pages_translated || 0) > 0;
  const hasOcr = (book.pages_ocr || 0) > 0;
  const denom = Math.max((book.pages_count || 0) - (book.pages_blank || 0), 1);
  const translationPct = book.pages_count && book.pages_translated
    ? Math.round((book.pages_translated / denom) * 100)
    : 0;

  return (
    <a
      href={book.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-5 p-5 rounded-xl bg-white border border-stone-200 shadow-sm hover:shadow-md hover:border-accent-rust/30 transition-all group"
    >
      {/* Thumbnail */}
      {book.thumbnail ? (
        <img
          src={book.thumbnail}
          alt=""
          className="w-20 h-28 object-cover rounded-lg shadow-sm shrink-0 bg-stone-100 group-hover:shadow-md transition-shadow"
          loading="lazy"
        />
      ) : (
        <div className="w-20 h-28 rounded-lg bg-stone-100 shrink-0 flex items-center justify-center">
          <svg className="w-8 h-8 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-serif text-stone-800 group-hover:text-accent-rust transition-colors leading-snug">
          {book.title}
        </h3>

        <div className="text-sm text-stone-500 mt-1">
          {book.author}
          {book.year ? ` · ${book.year}` : ''}
          {' · '}{book.language}
          {book.pages_count ? ` · ${book.pages_count} pages` : ''}
        </div>

        {/* Overview/description */}
        {book.overview && (
          <p className="text-sm text-stone-500 mt-2 leading-relaxed line-clamp-2">
            {book.overview}
          </p>
        )}

        {/* Status badges */}
        <div className="flex items-center gap-2 mt-3">
          {hasTranslation && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
              {translationPct >= 90 ? 'Fully translated' : `${translationPct}% translated`}
            </span>
          )}
          {hasOcr && !hasTranslation && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              Text extracted (OCR)
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <div className="self-center shrink-0">
        <svg className="w-5 h-5 text-stone-300 group-hover:text-accent-rust transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </a>
  );
}
