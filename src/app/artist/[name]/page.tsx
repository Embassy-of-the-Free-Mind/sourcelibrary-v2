import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import { bookUrl, authorSlug, authorUrl } from '@/lib/slugify';
import { VISUAL_RESOURCE_TYPES } from '@/lib/books-catalog';
import { ObjectId, type Db } from 'mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';

export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

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
  resource_type?: string;
  source_url?: string;
}

interface GalleryImage {
  _id: string;
  page_id: string;
  book_id: string;
  page_number: number;
  image_url?: string;
  thumbnail_url?: string;
  extracted_url?: string;
  description?: string;
  type?: string;
  gallery_quality?: number;
  book_title?: string;
  book_year?: number;
  extracted_width?: number;
  extracted_height?: number;
}

interface ArtistEntity {
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
}

interface ArtistPageProps {
  params: Promise<{ name: string }>;
}

const BOOK_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
  author_entity_id: 1, language: 1, published: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  pages_count: 1, year: 1, resource_type: 1, source_url: 1,
};

async function loadArtistData(db: Db, slug: string): Promise<{
  artistName: string;
  entity: ArtistEntity | null;
  books: Book[];
  totalWorks: number;
  galleryImages: GalleryImage[];
  hasAuthorPage: boolean;
} | null> {
  // Look up from system_config author_slugs cache (artists share the same slug space)
  const config = await db.collection('system_config').findOne(
    { _id: 'author_slugs' as any },
    { projection: { slugs: 1 } }
  );

  let artistName: string | undefined;
  if (config?.slugs?.[slug]) {
    artistName = config.slugs[slug];
  } else {
    const guess = slug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const check = await db.collection('books').findOne(
      { author: guess, visible: true },
      { projection: { _id: 1 } }
    );
    if (check) artistName = guess;
  }

  if (!artistName) return null;

  // Count visual works to verify this is an artist
  const visualCount = await db.collection('books').countDocuments(
    { author: artistName, visible: true, resource_type: { $in: VISUAL_RESOURCE_TYPES } },
    { maxTimeMS: 10000 }
  );

  if (visualCount === 0) return null;

  // Fetch visual works (limited to 60 for performance)
  const visualBooks = await db.collection('books').find(
    { author: artistName, visible: true, resource_type: { $in: VISUAL_RESOURCE_TYPES } },
    { projection: BOOK_PROJECTION }
  ).sort({ year: 1, title: 1 }).limit(60).toArray() as unknown as (Book & { author_entity_id?: string })[];

  // Check if this author also has text works (for cross-link)
  const textCount = await db.collection('books').countDocuments(
    { author: artistName, visible: true, $or: [{ resource_type: { $exists: false } }, { resource_type: { $nin: VISUAL_RESOURCE_TYPES } }] },
    { maxTimeMS: 10000 }
  );

  // Resolve entity
  let entity: ArtistEntity | null = null;
  const entityBookId = visualBooks.find((b: any) => b.author_entity_id)?.author_entity_id;
  if (entityBookId) {
    try {
      entity = await db.collection('entities').findOne(
        { _id: new ObjectId(String(entityBookId)) },
        { projection: { name: 1, canonical_name: 1, description: 1, aliases: 1, viaf_id: 1, wikidata_id: 1, wikipedia_url: 1, wikidata_birth_date: 1, wikidata_death_date: 1, portrait_url: 1 } }
      ) as ArtistEntity | null;
    } catch { /* invalid ObjectId */ }
  }

  // Fetch gallery images for this artist's books
  const bookIds = visualBooks.map(b => b.id);
  const galleryImages = await db.collection('gallery_images').find(
    { book_id: { $in: bookIds }, book_visible: true, extracted_url: { $exists: true, $ne: null } },
    { projection: { page_id: 1, book_id: 1, page_number: 1, image_url: 1, thumbnail_url: 1, extracted_url: 1, description: 1, type: 1, gallery_quality: 1, book_title: 1, book_year: 1, extracted_width: 1, extracted_height: 1 } }
  ).sort({ gallery_quality: -1 }).limit(60).toArray() as unknown as GalleryImage[];

  const displayName = entity?.canonical_name || entity?.name || artistName;

  return {
    artistName: displayName,
    entity,
    books: visualBooks as Book[],
    totalWorks: visualCount,
    galleryImages,
    hasAuthorPage: textCount > 0,
  };
}

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const artistName = decoded !== name
    ? decoded
    : name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return {
    title: `${artistName} — Artist — Source Library`,
    description: `Visual works by ${artistName} in Source Library's collection of rare historical prints, paintings, and drawings, digitized and catalogued with AI.`,
    alternates: { canonical: `/artist/${name}` },
    openGraph: {
      images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
      title: `${artistName} — Artist — Source Library`,
      description: `Visual works by ${artistName} in Source Library`,
    },
  };
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  if (decoded !== name) {
    redirect(`/artist/${authorSlug(decoded)}`);
  }

  const db = await getReadDb();
  const data = await loadArtistData(db, name);
  if (!data) notFound();

  const { artistName, entity, books, totalWorks, galleryImages, hasAuthorPage } = data;

  const years = books.map(b => b.published).filter(Boolean).map(p => parseInt(p)).filter(y => !isNaN(y));
  const yearRange = years.length > 0
    ? years.length === 1 || Math.min(...years) === Math.max(...years)
      ? `${Math.min(...years)}`
      : `${Math.min(...years)}–${Math.max(...years)}`
    : null;

  // Life dates + portrait are a static read of the entity. Enrichment from
  // Wikidata happens OFFLINE (cron + link hook) — never on render.
  const birthYear = entity?.wikidata_birth_date?.split('-')[0];
  const deathYear = entity?.wikidata_death_date?.split('-')[0];
  const lifeDates = birthYear ? `${birthYear}–${deathYear || '?'}` : null;

  const portraitUrl = entity?.portrait_url ?? null;

  const wikipediaUrl = entity?.wikipedia_url
    || (entity?.wikidata_id ? `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${entity.wikidata_id}` : null);

  const nameVariants = entity?.aliases?.length
    ? entity.aliases.filter(a => a.toLowerCase() !== artistName.toLowerCase())
    : [];
  const bookVariants = [...new Set(books.map(b => b.author))]
    .filter(a => a && a !== artistName && !nameVariants.some(v => v.toLowerCase() === a.toLowerCase()));
  const allVariants = [...nameVariants, ...bookVariants].slice(0, 8);

  // Medium breakdown
  const mediaCounts = new Map<string, number>();
  for (const b of books) {
    if (b.resource_type) mediaCounts.set(b.resource_type, (mediaCounts.get(b.resource_type) || 0) + 1);
  }
  const media = [...mediaCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Artists', href: '/browse/artists' }]} />

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16 flex gap-8 items-start">
          {portraitUrl && (
            <div className="hidden sm:block shrink-0 w-28 h-36 rounded-lg overflow-hidden bg-stone-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={portraitUrl}
                alt={`Portrait of ${artistName}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Artist</p>
            <h1 className="text-3xl sm:text-4xl font-display font-bold">
              {artistName}
            </h1>
            {lifeDates && (
              <p className="text-stone-400 mt-1 text-lg">{lifeDates}</p>
            )}
            {!lifeDates && yearRange && (
              <p className="text-stone-400 mt-1">fl. {yearRange}</p>
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
                {totalWorks} work{totalWorks !== 1 ? 's' : ''}
              </span>
              {galleryImages.length > 0 && (
                <span className="text-stone-400">
                  {galleryImages.length} extracted image{galleryImages.length !== 1 ? 's' : ''}
                </span>
              )}
              {media.length > 0 && (
                <span className="text-stone-400">
                  {media.map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`).join(', ')}
                </span>
              )}
            </div>

            {/* External links */}
            <div className="flex flex-wrap gap-2 mt-5">
              {hasAuthorPage && (
                <Link
                  href={authorUrl(artistName) || '#'}
                  className="inline-block px-3 py-1.5 text-sm bg-accent-rust/20 text-accent-gold hover:bg-accent-rust/30 rounded-full transition-colors"
                >
                  Author page
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
          </div>
        </div>
      </div>

      {/* Gallery grid of extracted images */}
      {galleryImages.length > 0 && (
        <div className="border-b" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}>
          <div className="max-w-6xl mx-auto px-6 md:px-12 py-8">
            <h2 className="text-lg font-display mb-4" style={{ color: 'var(--text-primary)' }}>
              Images
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {galleryImages.map(img => {
                const src = img.extracted_url || img.thumbnail_url || img.image_url;
                if (!src) return null;
                return (
                  <Link
                    key={img._id?.toString()}
                    href={`/book/${img.book_id}?page=${img.page_number}`}
                    className="group"
                  >
                    <div className="relative aspect-square rounded overflow-hidden bg-stone-200">
                      <Image
                        src={src}
                        alt={img.description || `Image from ${img.book_title || 'unknown'}`}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                      />
                    </div>
                    {img.description && (
                      <p className="text-[11px] mt-1 line-clamp-2 leading-snug" style={{ color: 'var(--text-faint)' }}>
                        {img.description}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Works bibliography */}
      {(() => {
        const shown = books.slice(0, 60);
        const remaining = books.length - shown.length;
        return (
          <main className="max-w-6xl mx-auto px-6 md:px-12 py-8 md:py-12">
            <h2 className="text-lg font-display mb-4" style={{ color: 'var(--text-primary)' }}>
              Works in Collection
              {remaining > 0 && (
                <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-muted)' }}>
                  showing {shown.length} of {books.length}
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {shown.map(book => {
                const isStub = !book.pages_count;
                const href = isStub && book.source_url ? book.source_url : bookUrl(book);
                const isExternal = isStub && book.source_url;
                const LinkOrA = isExternal ? 'a' : Link;
                const extraProps = isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {};
                return (
                  <LinkOrA key={book.id} href={href} className="group" {...extraProps}>
                    <div className="aspect-[3/4] relative rounded overflow-hidden bg-stone-200">
                      {getBookThumbnailUrl(book) ? (
                        <Image
                          src={getBookThumbnailUrl(book)!}
                          alt={book.display_title || book.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center p-3">
                          <p className="text-[10px] text-center" style={{ color: 'var(--text-faint)' }}>
                            {book.display_title || book.title}
                          </p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs mt-1.5 font-medium line-clamp-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-serif)' }}>
                      {book.display_title || book.title}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {book.year || book.published || ''}
                      {book.resource_type && <span className="ml-1 opacity-60">· {book.resource_type}</span>}
                    </p>
                  </LinkOrA>
                );
              })}
            </div>
          </main>
        );
      })()}
    </div>
  );
}
