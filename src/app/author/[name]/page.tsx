import { Metadata } from 'next';
import { translationPercent } from '@/lib/translation-percent';
import { ftRenderProps } from '@/lib/first-translation/render';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import { bookUrl, authorSlug, artistUrl } from '@/lib/slugify';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import AuthorBibliography from '@/components/browse/AuthorBibliography';
import { VISUAL_RESOURCE_TYPES } from '@/lib/books-catalog';
import { ObjectId } from 'mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';
import AuthorSchema from '@/components/seo/AuthorSchema';
import { authorThesaurusReadpathEnabled, resolveCanonicalAuthor } from '@/lib/author-thesaurus';
import { classifyNonPersonAuthor, type NonPersonAuthor } from '@/lib/non-person-author';
import { isPublishedEntity, type EntityPublishFields } from '@/lib/entity-publish';

// ISR: 24h background revalidation (survives deploys better than revalidate=false)
export const revalidate = 86400;

interface Book {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  year?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  translation_percent?: number;
  summary?: { data: string } | string;
  is_first_translation?: boolean;
  ft_disposition?: string;
  ft_claim?: 'confirmed' | 'candidate';
  publisher?: string;
  place_of_publication?: string;
  publication_place?: string;
  place_published?: string;
  place?: string;
  image_source?: { contributing_library?: string; provider_name?: string };
  // Used to split the bibliography (texts) from visual works (artworks).
  // See isArtworkRecord() — older records use resource_type instead.
  content_type?: string;
  resource_type?: string;
  image_display?: string;
  image_thumb?: string;
}

function isArtworkRecord(b: Pick<Book, 'content_type' | 'resource_type'>): boolean {
  // 25,368 of 25,383 artworks carry both markers in production; a handful
  // have only one. Treat either as artwork to avoid leaks during slow
  // backfills, mirroring the /artist/[slug] page (which keys off
  // resource_type).
  // An explicit content_type:'book' always wins: a textual book that happens to
  // carry a resource_type (e.g. a digitized papyrus text tagged 'papyrus_fragment')
  // must never be treated as artwork, or it routes to /artwork/ instead of /book/.
  if (b.content_type === 'book') return false;
  return b.content_type === 'artwork' || !!b.resource_type;
}

interface AuthorEntity {
  _id: ObjectId;
  name: string;
  canonical_name?: string;
  description?: string;
  aliases?: string[];
  viaf_id?: string;
  wikidata_id?: string;
  wikipedia_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
  portrait_url?: string;
  book_count?: number;
}

// dynamicParams + generateStaticParams: generate on first request, not at build time
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface AuthorPageProps {
  params: Promise<{ name: string }>;
}

/**
 * Resolve an author slug to an entity + canonical name.
 * Strategy:
 *   1. Find a book matching the slug pattern
 *   2. If that book has author_entity_id, load the entity (gets all variants)
 *   3. Otherwise fall back to raw author string matching
 */
const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
  author_entity_id: 1, language: 1, published: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, year: 1,
  summary: 1, is_first_translation: 1,
  // What ftRenderProps needs to pick the claim register (#3726 Tier 3). The
  // old `ft_disposition: 1` projected a field Mongo books never had.
  'translation_verification.disposition': 1,
  'first_translation.verdict': 1, 'first_translation.evidence_strength': 1,
  'first_translation.our_completeness': 1,
  'source_language_screen.verdict': 1, 'translator_author_screen.verdict': 1,
  // The whole imprint-place family (#4043) — the resolver reads all four.
  publisher: 1, place_of_publication: 1, publication_place: 1, place_published: 1, place: 1,
  resource_type: 1, content_type: 1,
  'image_source.contributing_library': 1, 'image_source.provider_name': 1,
};

function computeBooks(raw: any[]): Book[] {
  return raw.map((b: any) => {
    const ft = ftRenderProps(b);
    const {
      first_translation: _ft, translation_verification: _tv,
      source_language_screen: _sls, translator_author_screen: _tas,
      ...rest
    } = b;
    return {
      ...rest,
      pages_count: b.pages_count || 0,
      pages_translated: b.pages_translated || 0,
      // Shared definition. The formula that stood here divided by
      // (pages_ocr − pages_blank), which exceeds 100% on 5,835 live books because
      // "blank" leaves do get translated. See src/lib/translation-percent.ts.
      translation_percent: translationPercent(b),
      ft_disposition: ft.disposition,
      ft_claim: ft.claim,
    };
  });
}

/**
 * Partition a computed book set into texts (bibliography) and artworks.
 * Shared by the legacy entity path and the canonical-thesaurus path.
 */
function partitionAuthorBooks(books: Book[]): { works: Book[]; artworks: Book[] } {
  return {
    works: books.filter(b => !isArtworkRecord(b)),
    artworks: books.filter(b => isArtworkRecord(b)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Load author page data. Entity-aware: if an entity exists, fetches ALL books
 * linked to that entity (across name variants), not just exact author match.
 *
 * Strategy:
 *   1. Resolve slug → author name via system_config cache
 *   2. Find a book with that author to get author_entity_id
 *   3. If entity found, query books by author_entity_id (captures all variants)
 *   4. If no entity, fall back to exact author string match
 */
async function loadAuthorData(db: any, slug: string): Promise<{
  authorName: string;
  entity: AuthorEntity | null;
  works: Book[];
  artworks: Book[];
} | null> {
  // Look up author slug→name from system_config cache
  const config = await db.collection('system_config').findOne(
    { _id: 'author_slugs' },
    { projection: { slugs: 1 } }
  );

  let authorName: string | undefined;
  if (config?.slugs?.[slug]) {
    authorName = config.slugs[slug];
  } else {
    // Fallback: title-case from slug (handles uncached authors until next sync)
    const guess = slug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    // Verify this author exists with an exact match
    const check = await db.collection('books').findOne(
      { author: guess, visible: true },
      { projection: { _id: 1 } }
    );
    if (check) authorName = guess;
  }

  if (!authorName) return null;

  // Find a representative book to get entity link
  const repBook = await db.collection('books').findOne(
    { author: authorName, visible: true, author_entity_id: { $exists: true, $ne: null } },
    { projection: { author_entity_id: 1 } }
  );

  let entity: AuthorEntity | null = null;
  let books: any[];

  if (repBook?.author_entity_id) {
    // Entity-driven path: get entity, then ALL books linked to it
    try {
      entity = await db.collection('entities').findOne(
        { _id: new ObjectId(repBook.author_entity_id) },
        { projection: { name: 1, canonical_name: 1, description: 1, aliases: 1, viaf_id: 1, wikidata_id: 1, wikipedia_url: 1, wikidata_birth_date: 1, wikidata_death_date: 1, portrait_url: 1, book_count: 1 } }
      ) as AuthorEntity | null;
    } catch { /* invalid ObjectId */ }

    if (entity) {
      // Fetch all books with this entity (any name variant)
      books = await db.collection('books').find(
        { author_entity_id: repBook.author_entity_id, visible: true },
        { projection: BOOK_PROJECTION }
      ).sort({ year: 1, title: 1 }).toArray();
    } else {
      // Entity not found — fall back to string match
      books = await db.collection('books').find(
        { author: authorName, visible: true },
        { projection: BOOK_PROJECTION }
      ).sort({ year: 1, title: 1 }).toArray();
    }
  } else {
    // No entity link — string match only
    books = await db.collection('books').find(
      { author: authorName, visible: true },
      { projection: BOOK_PROJECTION }
    ).sort({ year: 1, title: 1 }).toArray();

    // Still try to resolve entity from any linked book in results
    const entityBookId = books.find((b: any) => b.author_entity_id)?.author_entity_id;
    if (entityBookId) {
      try {
        entity = await db.collection('entities').findOne(
          { _id: new ObjectId(entityBookId) },
          { projection: { name: 1, canonical_name: 1, description: 1, aliases: 1, viaf_id: 1, wikidata_id: 1, wikipedia_url: 1, wikidata_birth_date: 1, wikidata_death_date: 1, portrait_url: 1, book_count: 1 } }
        ) as AuthorEntity | null;
      } catch { /* invalid ObjectId */ }
    }
  }

  if (books.length === 0) return null;

  const displayName = entity?.canonical_name || entity?.name || authorName;

  // Partition the record set: texts go to the bibliography, artworks get
  // their own preview strip + link to the dedicated /artist/[name] page.
  const { works, artworks } = partitionAuthorBooks(computeBooks(books));

  return {
    authorName: displayName,
    entity,
    works,
    artworks,
  };
}

/**
 * Canonical-thesaurus author load (GitHub #2250), gated by
 * AUTHOR_THESAURUS_READPATH. Resolves the slug to ONE canonical person via the
 * `authors` collection and returns the deduplicated book set. The second return
 * value is the canonical slug — when it differs from the requested slug, the
 * page 301-redirects so every variant URL collapses to one.
 */
async function loadCanonicalAuthorData(db: any, slug: string): Promise<{ // eslint-disable-line @typescript-eslint/no-explicit-any
  authorName: string;
  entity: AuthorEntity | null;
  works: Book[];
  artworks: Book[];
  canonicalSlug: string;
  nonPerson: NonPersonAuthor | null;
} | null> {
  const resolved = await resolveCanonicalAuthor(db, slug, BOOK_PROJECTION);
  if (!resolved || resolved.books.length === 0) return null;
  const { works, artworks } = partitionAuthorBooks(computeBooks(resolved.books));
  return {
    authorName: resolved.canonicalName,
    entity: (resolved.entity as AuthorEntity | null),
    works,
    artworks,
    canonicalSlug: resolved.canonicalSlug,
    // Only the thesaurus knows a heading is not a person; the legacy string
    // path below has no such record, so it renders as before.
    nonPerson: classifyNonPersonAuthor(resolved.doc),
  };
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  const { name } = await params;
  // Derive display name from slug — no DB call needed for metadata.
  // The page component does the real resolve; metadata just needs a title.
  const decoded = decodeURIComponent(name);
  const authorName = decoded !== name
    ? decoded
    : name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return {
    title: `${authorName} — Source Library`,
    description: `Browse works by ${authorName} in Source Library's collection of rare historical texts, digitized and translated with AI.`,
    alternates: {
      canonical: `/author/${name}`,
    },
    openGraph: {
      title: `${authorName} — Source Library`,
      description: `Works by ${authorName} in Source Library`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${authorName} — Source Library`,
      description: `Works by ${authorName} in Source Library`,
    },
  };
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  // Redirect old %20-style URLs to hyphenated slugs
  if (decoded !== name) {
    redirect(`/author/${authorSlug(decoded)}`);
  }

  const db = await getReadDb();

  // Canonical-thesaurus path (flag-gated): one URL per person, variant slugs 301
  // to the canonical slug. Falls back to the legacy entity/string path on a miss
  // so no author page regresses while the thesaurus tail is still being linked.
  let data: Awaited<ReturnType<typeof loadAuthorData>> = null;
  // Non-person headings (institutions, work titles, "Anonymous") come only from
  // the thesaurus, so this stays null on the legacy path — which is correct:
  // without a thesaurus doc there is no evidence the heading is not a person.
  let nonPerson: NonPersonAuthor | null = null;
  if (authorThesaurusReadpathEnabled()) {
    const canonical = await loadCanonicalAuthorData(db, name);
    if (canonical) {
      if (canonical.canonicalSlug && canonical.canonicalSlug !== name) {
        redirect(`/author/${canonical.canonicalSlug}`);
      }
      data = canonical;
      nonPerson = canonical.nonPerson;
    }
  }
  if (!data) data = await loadAuthorData(db, name);
  if (!data) notFound();

  const { authorName, entity, works, artworks } = data;

  // Stats and year range cover both works and artworks — the page is one
  // person's complete record set, just rendered in two surfaces.
  const allRecords = [...works, ...artworks];
  const years = allRecords.map(b => b.published).filter(Boolean).map(p => parseInt(p)).filter(y => !isNaN(y));
  const yearRange = years.length > 0
    ? years.length === 1 || Math.min(...years) === Math.max(...years)
      ? `${Math.min(...years)}`
      : `${Math.min(...years)}–${Math.max(...years)}`
    : null;

  // Life dates + portrait are a static read of the entity. Enrichment from
  // Wikidata happens OFFLINE (cron + link hook, see wikidata-enrichment.ts) —
  // never on render, since these are immutable facts.
  // A birth/death range is a claim about a human life. An entity row linked to a
  // non-person heading can still carry one (they are matched by name), so this
  // is gated on the thesaurus flag rather than on the dates being absent.
  const birthYear = entity?.wikidata_birth_date?.split('-')[0];
  const deathYear = entity?.wikidata_death_date?.split('-')[0];
  const lifeDates = !nonPerson && birthYear ? `${birthYear}–${deathYear || '?'}` : null;

  // Encyclopedia entry: use entity directly if we have one, otherwise regex
  // fallback. The pill only renders for published-tier entities (#4321) — a
  // below-the-line entry is a noindex page listing a mention or two, and the
  // one place we deliberately keep linking the tail is nowhere.
  const encyclopediaCandidate = entity || await db.collection('entities').findOne(
    { type: 'person', $or: [
      { name: { $regex: new RegExp(`^${authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      { aliases: { $regex: new RegExp(`^${authorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
    ]},
    { projection: { name: 1, book_count: 1, wikidata_id: 1, description: 1 } }
  );
  const encyclopediaEntity =
    encyclopediaCandidate && isPublishedEntity(encyclopediaCandidate as EntityPublishFields)
      ? encyclopediaCandidate
      : null;

  // Portrait image — static read (enriched offline; CSP-safe CDN URL).
  // Never for a non-person: a portrait is the strongest visual assertion the
  // page makes, and there is no face behind "Theatrum Chemicum".
  const portraitUrl = nonPerson ? null : (entity?.portrait_url ?? null);

  // Derive Wikipedia URL from entity
  const wikipediaUrl = entity?.wikipedia_url
    || (entity?.wikidata_id ? `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${entity.wikidata_id}` : null);

  // Collect distinct name variants from books (for "Also known as")
  const nameVariants = entity?.aliases?.length
    ? entity.aliases.filter(a => a.toLowerCase() !== authorName.toLowerCase())
    : [];
  // Also add unique author strings from records that differ from canonical
  const bookVariants = [...new Set(allRecords.map(b => b.author))]
    .filter(a => a && a !== authorName && !nameVariants.some(v => v.toLowerCase() === a.toLowerCase()));
  const allVariants = [...nameVariants, ...bookVariants].slice(0, 8);

  // Artist-page link surfaces whenever there are visual works. Tracks the
  // /artist/[slug] route's own definition (resource_type-based) so the link
  // doesn't dangle on records that haven't been backfilled to content_type.
  // "Artist page" reads the heading as a person who made pictures, so it is
  // suppressed for a non-person even when visual records are present.
  const hasVisualWorks = !nonPerson && (
    artworks.some(b => b.resource_type && VISUAL_RESOURCE_TYPES.includes(b.resource_type))
    || artworks.length > 0
  );

  // Language breakdown — texts only; artworks rarely carry a language and
  // the count would dilute the signal in the stats row.
  const langCounts = new Map<string, number>();
  for (const b of works) {
    if (b.language) langCounts.set(b.language, (langCounts.get(b.language) || 0) + 1);
  }
  const languages = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <AuthorSchema
        authorName={authorName}
        authorSlug={name}
        description={entity?.description}
        aliases={entity?.aliases}
        birthDate={entity?.wikidata_birth_date}
        deathDate={entity?.wikidata_death_date}
        wikipediaUrl={wikipediaUrl}
        wikidataId={entity?.wikidata_id}
        viafId={entity?.viaf_id}
        portraitUrl={portraitUrl}
        entityType={nonPerson ? nonPerson.schemaEntityType : 'Person'}
        workCount={works.length + artworks.length}
        sampleWorks={works.slice(0, 10).map(w => ({
          id: w.id,
          slug: w.slug,
          title: w.title,
          published: w.published,
        }))}
      />
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16 flex gap-8 items-start">
          {portraitUrl && (
            <div className="hidden sm:block shrink-0 w-28 h-36 rounded-lg overflow-hidden bg-stone-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={portraitUrl}
                alt={`Portrait of ${authorName}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
          <h1 className="text-3xl sm:text-4xl font-display font-bold">
            {authorName}
          </h1>
          {nonPerson && (
            <p className="text-stone-400 mt-2 text-sm">
              <span
                className="inline-block px-2 py-0.5 mr-2 rounded bg-stone-700/60 text-stone-300 text-xs uppercase tracking-wide"
              >
                {nonPerson.label}
              </span>
              {nonPerson.note}
            </p>
          )}
          {lifeDates && (
            <p className="text-stone-400 mt-1 text-lg">{lifeDates}</p>
          )}
          {/* "fl." is floruit — a person's active years. A non-person gets the
              plain span of the records instead. */}
          {!lifeDates && yearRange && (
            <p className="text-stone-400 mt-1">{nonPerson ? yearRange : `fl. ${yearRange}`}</p>
          )}
          {entity?.description && (
            <p className="text-stone-300 mt-3 text-sm max-w-2xl leading-relaxed">
              {entity.description}
            </p>
          )}
          {allVariants.length > 0 && (
            <p className="text-stone-500 mt-2 text-xs">
              Also known as: {allVariants.join(' · ')}
            </p>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-4 mt-5 text-sm">
            <span className="text-accent-gold font-medium">
              {works.length} work{works.length !== 1 ? 's' : ''}
              {artworks.length > 0 && ` · ${artworks.length} artwork${artworks.length !== 1 ? 's' : ''}`}
            </span>
            {languages.length > 0 && (
              <span className="text-stone-400">
                {languages.map(([lang]) => lang).join(', ')}
              </span>
            )}
          </div>

          {/* External links */}
          <div className="flex flex-wrap gap-2 mt-5">
            {hasVisualWorks && artistUrl(authorName) && (
              <Link
                href={artistUrl(authorName)!}
                className="inline-block px-3 py-1.5 text-sm bg-accent-rust/20 text-accent-gold hover:bg-accent-rust/30 rounded-full transition-colors"
              >
                Artist page
              </Link>
            )}
            {encyclopediaEntity && (
              // Says where it goes. This page lists what the author WROTE; the
              // encyclopedia entry lists books that mention them — a different
              // frame, and "Encyclopedia entry" sitting beside "Artist page" read
              // as more of the same, so readers clicked expecting works (#3361).
              <Link
                href={`/encyclopedia/${encodeURIComponent(encyclopediaEntity.name)}`}
                className="inline-block px-3 py-1.5 text-sm bg-accent-rust/20 text-accent-gold hover:bg-accent-rust/30 rounded-full transition-colors"
              >
                Mentions in other books
              </Link>
            )}
            {wikipediaUrl && (
              <a
                href={wikipediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 text-sm bg-stone-700/50 text-stone-300 hover:bg-stone-700 rounded-full transition-colors"
              >
                Wikipedia
              </a>
            )}
            {entity?.viaf_id && (
              <a
                href={`https://viaf.org/viaf/${entity.viaf_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 text-sm bg-stone-700/50 text-stone-300 hover:bg-stone-700 rounded-full transition-colors"
              >
                VIAF
              </a>
            )}
            {entity?.wikidata_id && (
              <a
                href={`https://www.wikidata.org/wiki/${entity.wikidata_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-3 py-1.5 text-sm bg-stone-700/50 text-stone-300 hover:bg-stone-700 rounded-full transition-colors"
              >
                Wikidata
              </a>
            )}
          </div>
          </div>{/* close flex-1 */}
        </div>
      </div>

      {/* Title page gallery — texts only; artworks render separately below. */}
      {(() => {
        const thumbBooks = works.filter(b => getBookThumbnailUrl(b));
        if (thumbBooks.length === 0) return null;
        const shown = thumbBooks.slice(0, 8);
        return (
          <div className="border-b" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}>
            <div className="max-w-6xl mx-auto px-6 md:px-12 py-6">
              <div className="flex gap-3 overflow-x-auto pb-1">
                {shown.map(book => (
                  <Link key={book.id} href={bookUrl(book)} className="shrink-0 group">
                    <div className="w-24 h-32 relative rounded overflow-hidden bg-stone-200">
                      <Image
                        src={getBookThumbnailUrl(book)!}
                        alt={book.display_title || book.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="96px"
                      />
                    </div>
                    <p className="text-[10px] mt-1 w-24 line-clamp-1" style={{ color: 'var(--text-faint)' }}>
                      {book.year || book.published || ''}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Content — bibliography with grid/list toggle (texts only) */}
      <main className="max-w-6xl mx-auto px-6 md:px-12 py-8 md:py-12 space-y-12">
        {works.length > 0 && (
          <AuthorBibliography books={works.map(b => ({
            ...b,
            display_title: b.display_title || undefined,
            thumbnail: getBookThumbnailUrl(b) || undefined,
            thumbnail_blob: b.thumbnail_blob || undefined,
          }))} />
        )}

        {artworks.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-xs uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>
                Artworks ({artworks.length})
              </h2>
              {artistUrl(authorName) && (
                <Link
                  href={artistUrl(authorName)!}
                  className="text-xs text-accent-rust hover:underline"
                >
                  See all on artist page →
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {artworks.slice(0, 12).map(art => {
                // Route through the resolver (size 'thumb') so artwork URL
                // normalization applies — reading image_thumb raw re-introduces
                // the 150px-upscaled blur if an import ever writes a small thumb.
                const thumb = getBookThumbnailUrl(art, 'thumb') || art.image_display;
                return (
                  <Link
                    key={art.id}
                    href={`/artwork/${art.slug || art.id}`}
                    className="group"
                  >
                    <div className="relative aspect-square rounded overflow-hidden bg-stone-200">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={art.display_title || art.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 17vw"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-stone-300 to-stone-400" />
                      )}
                    </div>
                    <p className="text-xs mt-1.5 line-clamp-2 leading-snug" style={{ color: 'var(--text-primary)' }}>
                      {art.display_title || art.title}
                    </p>
                    {art.year || art.published ? (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {art.year || art.published}
                      </p>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
