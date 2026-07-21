import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getEpisodeData, getAllEpisodeNumbers } from '../shwep-data';
import type { MatchedBook } from '../shwep-data';
import { getWorksCitedForEpisode } from '../works-cited';
import type { CitedWorkEntry, EditionRef } from '../works-cited';
import SiteHeader from '@/components/layout/SiteHeader';

// Must be a finite number — `false` would cache a bad-render fallback forever
// (e.g. the noindex metadata below) until the next deploy.
export const revalidate = 21600;

interface Props {
  params: Promise<{ number: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  // No try/catch: letting a fetch failure throw here keeps ISR serving the
  // last good page instead of permanently caching noindex fallback metadata.
  const ep = await getEpisodeData(parseInt(number));
  if (!ep) return { title: 'Episode Not Found - SHWEP Reading Room', robots: { index: false, follow: true } };
  return {
    title: `${ep.title} - SHWEP Reading Room`,
    description: ep.description || `Primary sources discussed in SHWEP episode ${ep.number}.`,
    // See the note in ../page.tsx: an alias domain does not inherit the preview
    // deployment's noindex, and this branch is shown privately pending the SHWEP's
    // author's say-so.
    robots: { index: false, follow: false },
    alternates: { canonical: `/shwep/${ep.number}` },
    openGraph: {
      images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
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

  const [episode, citedWorks] = await Promise.all([
    getEpisodeData(epNum),
    getWorksCitedForEpisode(epNum),
  ]);
  if (!episode) notFound();

  const translatedCount = episode.books.filter(b => (b.pages_translated || 0) > 0).length;
  const heldWorks = citedWorks.filter(w => w.held);
  const absentWorks = citedWorks.filter(w => !w.held);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <SiteHeader variant="light" breadcrumbs={[{ label: 'SHWEP Reading Room', href: '/shwep' }]} />

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

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* The bibliography proper: one entry per work the episode cites, carrying the
            editions of it we hold. This is the part that is ours — Earl's own prose sits
            below it, attributed, rather than being the substance of the page. */}
        {heldWorks.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-serif text-stone-800 mb-1">Works cited in this episode</h2>
            <p className="text-sm text-stone-500 mb-6">
              {heldWorks.length} work{heldWorks.length !== 1 ? 's' : ''} discussed in this episode {heldWorks.length !== 1 ? 'are' : 'is'} held here,
              in {heldWorks.reduce((n, w) => n + w.editions.length + w.moreEditions.length, 0)} editions.
              Where several editions survive they are listed together, because a manuscript, an early printing and a later translation are different objects.
            </p>
            <ul className="space-y-5">
              {heldWorks.map(w => (
                <li key={`${w.author}-${w.work}`}>
                  <WorkEntry entry={w} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {absentWorks.length > 0 && (
          <section className="mb-10">
            {/* NOT "not in the library" — that claim is unsafe. Psellos' Epistle on
                Chrysopoeia shows here while we hold it, because it sits inside a volume
                titled "Catalogue des manuscrits alchimiques grecs, Vol. VI"; the matcher
                searches work titles and never sees the container. Until a gap audit runs
                against the full catalogue, say only what is true: we have not matched a
                copy to this citation. */}
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-1">
              Also cited, no copy matched here yet
            </h2>
            <p className="text-sm text-stone-500 mb-3">
              We may still hold one of these inside a larger volume — collected works and
              catalogues hide their contents from the matcher.
            </p>
            <ul className="text-[15px] text-stone-600 leading-relaxed columns-1 sm:columns-2 gap-8">
              {absentWorks.map(w => (
                <li key={`${w.author}-${w.work}`} className="break-inside-avoid mb-1.5">
                  <span className="text-stone-800">{w.author}</span>
                  {w.author && w.work ? ', ' : ''}
                  <em>{w.work}</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Earl Fontainelle's reading list, scraped from the episode page on shwep.net */}
        {(episode.linkedBibliography || episode.bibliography) && (
          <section className="mb-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
              <h2 className="text-xl font-serif text-stone-800">Reading List</h2>
              <p className="text-xs text-stone-500">
                Compiled by{' '}
                <a href="https://shwep.net" target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">Earl Fontainelle</a>
                {' '}for SHWEP ·{' '}
                <a href={episode.url} target="_blank" rel="noopener noreferrer" className="text-accent-rust underline">view on shwep.net</a>
              </p>
            </div>
            {episode.linkedBibliography && (
              <p className="text-sm text-stone-500 mb-4">
                The works <span className="text-accent-rust font-medium">underlined in rust</span> are in Source Library — click any to read the original.
              </p>
            )}
            <div className="rounded-xl bg-white border border-stone-200 shadow-sm p-6 md:p-7">
              <ReadingList markdown={episode.linkedBibliography || episode.bibliography!} />
            </div>
          </section>
        )}

        {/* When the bibliography has inline "read here" links, it IS the integrated experience —
            skip the separate book list. Otherwise fall back to the matched-books list. */}
        {!episode.linkedBibliography && (
          episode.bookCount > 0 ? (
            <>
              <h2 className="text-xl font-serif text-stone-800 mb-1">
                Read in Source Library
              </h2>
              <p className="text-sm text-stone-500 mb-6">
                Primary sources from this episode that you can read here — {episode.bookCount} title{episode.bookCount !== 1 ? 's' : ''} in the collection.
              </p>
              <div className="space-y-4">
                {episode.books.map(book => (
                  <BookCard key={book.id} book={book} />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-stone-500">
              <p className="text-lg mb-2">None of this episode&rsquo;s sources are in the collection yet.</p>
              <p className="text-sm">
                <Link href="/contribute" className="text-accent-rust underline">Suggest a book</Link> to help expand coverage.
              </p>
            </div>
          )
        )}

        {/* On an inline-linked episode, the reading list links the works named in Earl's
            discussion. Some held works are cited only via a dated edition (we hold a
            different edition) or aren't named in the text — surface those here so no held
            primary source is hidden behind the linked bibliography. */}
        {episode.linkedBibliography && episode.supplementaryBooks && episode.supplementaryBooks.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-serif text-stone-800 mb-1">
              Also in Source Library
            </h2>
            <p className="text-sm text-stone-500 mb-6">
              More primary sources from this episode you can read here — held in the collection but not linked in the reading list above.
            </p>
            <div className="space-y-4">
              {episode.supplementaryBooks.map(book => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          </section>
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

const ROLE_STYLE: Record<EditionRef['role'], string> = {
  critical: 'bg-amber-50 text-amber-800 border-amber-200',
  princeps: 'bg-amber-50 text-amber-800 border-amber-200',
  manuscript: 'bg-violet-50 text-violet-800 border-violet-200',
  edition: 'bg-stone-100 text-stone-600 border-stone-200',
  translation: 'bg-green-50 text-green-700 border-green-200',
};

function EditionRow({ edition }: { edition: EditionRef }) {
  return (
    <li>
      <Link
        href={edition.url}
        className="group flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 border-b border-stone-100 last:border-0"
      >
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${ROLE_STYLE[edition.role]}`}>
          {edition.roleLabel}
        </span>
        <span className="text-[15px] text-stone-700 group-hover:text-accent-rust transition-colors">
          {edition.title}
        </span>
        {edition.year && <span className="text-sm text-stone-400 tabular-nums">{edition.year}</span>}
        {/* Only worth saying on a non-English edition — on an English translation it is
            the same fact twice. */}
        {edition.translated && edition.role !== 'translation' && (
          <span className="text-xs text-green-700">· translated here</span>
        )}
        {edition.alsoCopies > 0 && (
          <span className="text-xs text-stone-400">
            · {edition.alsoCopies} further cop{edition.alsoCopies === 1 ? 'y' : 'ies'}
          </span>
        )}
      </Link>
    </li>
  );
}

function WorkEntry({ entry }: { entry: CitedWorkEntry }) {
  const total = entry.editions.length + entry.moreEditions.length;
  return (
    <div className="rounded-xl bg-white border border-stone-200 shadow-sm p-5">
      <h3 className="font-serif text-lg text-stone-800 leading-snug">
        {entry.author && <span className="text-stone-600">{entry.author}, </span>}
        <em>{entry.work}</em>
      </h3>
      <p className="text-xs uppercase tracking-wide text-stone-400 mt-0.5">
        {entry.era}
        {entry.workLanguage && ` · written in ${entry.workLanguage}`}
      </p>

      {/* Why this episode cites it. Without this an entry reads as an arbitrary match —
          a Jacobean comedy on a Byzantine alchemy episode looks like a mistake until you
          see what it was cited for. */}
      {entry.note && (
        <p className="text-[15px] text-stone-600 mt-2 leading-relaxed">{entry.note}</p>
      )}

      <ul className="mt-3">
        {entry.editions.map(e => <EditionRow key={e.id} edition={e} />)}
      </ul>

      {entry.moreEditions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-stone-500 hover:text-stone-700">
            All {total} editions held
          </summary>
          <ul className="mt-2">
            {entry.moreEditions.map(e => <EditionRow key={e.id} edition={e} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReadingList({ markdown }: { markdown: string }) {
  return (
    <div className="text-[15px] leading-relaxed text-stone-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-5 mb-2 first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-5 mb-2 first:mt-0">{children}</h3>,
          h3: ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-5 mb-2 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mt-4 mb-2">{children}</h4>,
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          ul: ({ children }) => <ul className="my-2.5 space-y-1.5 list-disc pl-5 marker:text-stone-300">{children}</ul>,
          ol: ({ children }) => <ol className="my-2.5 space-y-1.5 list-decimal pl-5 marker:text-stone-300">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          em: ({ children }) => <em className="italic">{children}</em>,
          strong: ({ children }) => <strong className="font-semibold text-stone-800">{children}</strong>,
          a: ({ href, children }) => {
            // Internal /book/ links are works we hold — render as a same-tab Source Library
            // link with a "read here" book affordance. External refs (Earl's own links,
            // JSTOR, Wikipedia, cross-episode) open in a new tab as before.
            if (href?.startsWith('/')) {
              return (
                <Link href={href} className="text-accent-rust underline decoration-accent-rust/40 underline-offset-2 hover:decoration-accent-rust font-medium whitespace-nowrap">
                  {children}
                  <svg className="inline-block w-3.5 h-3.5 ml-0.5 -mt-0.5 align-middle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </Link>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-700">{children}</a>;
          },
          hr: () => <hr className="my-4 border-stone-200" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
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
      {(book.thumbnail_blob || book.thumbnail) ? (
        <img
          src={book.thumbnail_blob || book.thumbnail}
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
