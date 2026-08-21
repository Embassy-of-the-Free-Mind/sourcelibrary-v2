import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { User, MapPin, Lightbulb, ExternalLink } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { ENTITY_TYPE_STYLES, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/style-constants';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { bookUrl } from '@/lib/slugify';
import { getBookThumbnailUrl } from '@/lib/utils';
import { getEntity, getAuthoredWorks } from './layout';

const TYPE_ICONS = {
  person: User,
  place: MapPin,
  concept: Lightbulb,
};

function formatLifespan(birth?: string, death?: string): string | null {
  if (!birth && !death) return null;
  const fmtYear = (s: string) => {
    const y = parseInt(s, 10);
    return y < 0 ? `${Math.abs(y)} BCE` : String(Math.abs(y));
  };
  const b = birth ? fmtYear(birth) : null;
  const d = death ? fmtYear(death) : null;
  if (b && d) return `${b}\u2013${d}`;
  if (b) return `b.\u00a0${b}`;
  return `d.\u00a0${d}`;
}

function formatCoordinates(coords: { lat: number; lng: number }) {
  const latDir = coords.lat >= 0 ? 'N' : 'S';
  const lngDir = coords.lng >= 0 ? 'E' : 'W';
  return {
    label: `${Math.abs(coords.lat).toFixed(4)}\u00b0\u00a0${latDir}, ${Math.abs(coords.lng).toFixed(4)}\u00b0\u00a0${lngDir}`,
    osmUrl: `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=10/${coords.lat}/${coords.lng}`,
  };
}

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const entity = await getEntity(decodedName);

  if (!entity) {
    notFound();
  }

  // Already deduped and normalized in getEntity (src/lib/entity-books.ts).
  const deduplicatedBooks = entity.books;

  const Icon = TYPE_ICONS[entity.type];

  // Books this person WROTE (vs the books that mention them, below). Only people
  // can have authored works, so don't spend a query on places and concepts.
  const {
    works: authoredWorks,
    total: authoredTotal,
    authorSlug: canonicalAuthorSlug,
  } = entity.type === 'person'
    ? await getAuthoredWorks(entity._id, entity.wikidata_id, entity.name)
    : { works: [], total: 0, authorSlug: null };

  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl ${ENTITY_TYPE_STYLES[entity.type as EntityType].badgeBordered}`}>
              <Icon className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-white/10 rounded text-xs text-stone-300">
                  {ENTITY_TYPE_LABELS[entity.type as EntityType]}
                </span>
              </div>
              <h1 className="text-3xl font-serif font-bold">{entity.name}</h1>
              {entity.aliases && entity.aliases.length > 0 && (
                <p className="text-stone-400 mt-1">
                  Also known as: {entity.aliases.join(', ')}
                </p>
              )}
              {entity.type === 'person' && formatLifespan(entity.wikidata_birth_date, entity.wikidata_death_date) && (
                <p className="text-stone-300 mt-1 text-lg">
                  {formatLifespan(entity.wikidata_birth_date, entity.wikidata_death_date)}
                </p>
              )}
              {/*
                Counts come from the deduped book list, so this row can't
                contradict the "Appears in N Books" heading below. "Total
                mentions" used to sum the smeared page arrays, which is how this
                page came to advertise five-figure mention counts (#3361) — it
                now counts page references we actually verified, and is omitted
                when there are none rather than reading as a hard zero.
              */}
              <div className="flex items-center gap-4 mt-4 text-sm text-stone-400">
                <span>{entity.book_count} book{entity.book_count !== 1 ? 's' : ''}</span>
                {entity.total_mentions > 0 && (
                  <>
                    <span>&middot;</span>
                    <span>
                      {entity.total_mentions} verified page reference{entity.total_mentions !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/*
          Works BY this person come first. Everything below is about books that
          mention them — for an author we actually hold, that was a confusing
          lead (#3361).
        */}
        {authoredWorks.length > 0 && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-stone-900">
                  {authoredTotal === 1
                    ? `1 work by ${entity.name} in the library`
                    : `${authoredTotal} works by ${entity.name} in the library`}
                </h2>
                {authoredTotal > authoredWorks.length && (
                  <p className="text-sm text-stone-500 mt-0.5">
                    Showing {authoredWorks.length} — see the author page for all {authoredTotal}.
                  </p>
                )}
              </div>
              {canonicalAuthorSlug && (
                <Link
                  href={`/author/${canonicalAuthorSlug}`}
                  className="shrink-0 text-sm text-accent-rust hover:text-accent-gold-dark"
                >
                  Author page →
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {authoredWorks.map((work) => {
                const thumb = getBookThumbnailUrl(work);
                return (
                  <Link key={work.id} href={bookUrl(work)} className="group block">
                    <div className="relative w-full aspect-[3/4] rounded overflow-hidden bg-stone-100 border border-stone-200">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={work.display_title || work.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 45vw, (max-width: 768px) 30vw, 22vw"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center p-2 text-center text-[10px] text-stone-400">
                          {work.display_title || work.title}
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium text-stone-900 line-clamp-2 group-hover:text-accent-rust transition-colors">
                      {work.display_title || work.title}
                    </p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      {[work.year || work.published, work.language].filter(Boolean).join(' · ')}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Description */}
        {(entity.description || (entity.type === 'place' && entity.wikidata_coordinates)) && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-3">About</h2>
            {entity.description && (
              <p className="text-stone-700 leading-relaxed">{entity.description}</p>
            )}
            {entity.type === 'place' && entity.wikidata_coordinates && (() => {
              const coords = formatCoordinates(entity.wikidata_coordinates);
              return (
                <p className={`text-sm text-stone-500 ${entity.description ? 'mt-3' : ''}`}>
                  <MapPin className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
                  <a
                    href={coords.osmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent-rust transition-colors"
                  >
                    {coords.label}
                  </a>
                </p>
              );
            })()}
            <div className="flex items-center gap-4 mt-4">
              {entity.wikipedia_url && (
                <a
                  href={entity.wikipedia_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent-rust hover:text-accent-gold-dark"
                >
                  Wikipedia
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {entity.wikidata_id && (
                <a
                  href={`https://www.wikidata.org/wiki/${entity.wikidata_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent-violet hover:text-accent-gold-dark"
                >
                  Wikidata
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}


        {/* Appearances */}
        <div className="bg-white rounded-lg border border-stone-200 p-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">
            Appears in {deduplicatedBooks.length} Book{deduplicatedBooks.length !== 1 ? 's' : ''}
          </h2>
          <div className="space-y-4">
            {deduplicatedBooks.map((book) => (
              <div
                key={book.book_id}
                className="border-l-2 border-accent-gold/30 pl-4 py-2"
              >
                <Link
                  href={`/book/${book.book_id}`}
                  className="font-medium text-stone-900 hover:text-accent-rust transition-colors"
                >
                  {book.book_title}
                </Link>
                <p className="text-sm text-stone-500 mt-0.5">{book.book_author}</p>
                {/*
                  Page pills are citations, so only verified pages get one. A
                  'section' entry means we know which stretch of the book
                  discusses this entity but not the page — it links to the start
                  of the range and says so, rather than minting a pill per page
                  in the range (which is what made these pages ~78% wrong, #3361).
                */}
                {book.page_precision === 'page' && book.pages.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {book.pages.slice(0, 10).map((page) => (
                      <Link
                        key={page}
                        href={`/book/${book.book_id}/page-number/${page}`}
                        className="inline-block px-2 py-0.5 bg-stone-100 text-stone-600 text-xs rounded hover:bg-accent-gold/15 hover:text-accent-rust transition-colors"
                      >
                        p. {page}
                      </Link>
                    ))}
                    {book.pages.length > 10 && (
                      <span className="inline-block px-2 py-0.5 text-stone-400 text-xs">
                        +{book.pages.length - 10} more pages
                      </span>
                    )}
                  </div>
                ) : book.page_range ? (
                  <div className="mt-2">
                    <Link
                      href={`/book/${book.book_id}/page-number/${book.page_range.start}`}
                      className="inline-block px-2 py-0.5 bg-stone-100 text-stone-500 text-xs rounded hover:bg-accent-gold/15 hover:text-accent-rust transition-colors"
                    >
                      discussed in pp. {book.page_range.start}–{book.page_range.end}
                    </Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </main>
      <SignUpCTA />
    </div>
  );
}
