import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowLeft, BookOpen, Images, Library } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import CollectionSchema from '@/components/seo/CollectionSchema';
import CollectionAllBooks from '@/components/collections/CollectionAllBooks';
import ExhibitionLayout from '@/components/collections/ExhibitionLayout';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { bookUrl } from '@/lib/slugify';
import { bookTitle, sanitizeThumbnail, withTimeout } from '@/lib/collections-utils';
import { firstTranslationBadge } from '@/lib/first-translation-labels';

// ISR: rebuild at most every 10 minutes
export const revalidate = 600;
export const dynamicParams = true;
export const maxDuration = 60;
export async function generateStaticParams() {
  // Don't pre-render collections at build time — Atlas timeouts during build
  // cause hard failures. ISR will generate on first request instead.
  return [];
}

interface Props {
  params: Promise<{ id: string }>;
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const db = await Promise.race([
      getDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 5000)),
    ]);
    const collection = await db.collection('collections').findOne({ slug: id });

    if (!collection) {
      return { title: 'Collection Not Found - Source Library' };
    }

    const description = collection.description
      ? String(collection.description).slice(0, 200)
      : `Browse the ${collection.name} collection on Source Library.`;

    return {
      title: `${collection.name} - Source Library`,
      description,
      alternates: { canonical: `/collections/${id}` },
      openGraph: {
        title: `${collection.name} - Source Library`,
        description,
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${collection.name} - Source Library`,
        description,
      },
    };
  } catch {
    return { title: 'Collection - Source Library' };
  }
}

// ---------- Helpers ----------

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  categories?: string[];
  published?: string;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  resource_type?: string;
}

interface CuratedHighlight {
  book_id: string;
  rank: number;
  tier: number;
  note: string;
  title?: string;
  author?: string;
  year?: number;
  // Added during merge with book data
  slug?: string;
  thumbnail?: string;
  is_first_translation?: boolean;
  ft_disposition?: string;
  language?: string;
  id: string;
}

/** Auto-link book titles found in description text to their book pages.
 *  Explicit mentions (from collection.mentioned_books) take priority over auto-detection. */
function linkBookTitles(
  text: string,
  allBooks: BookItem[],
  explicitMentions?: { text: string; book_id: string }[],
): React.ReactNode {
  const matches: { start: number; end: number; title: string; id: string }[] = [];
  const usedRanges: [number, number][] = [];

  // 1. Explicit mentions first (highest priority — exact text from description)
  if (explicitMentions?.length) {
    // Sort longest first to avoid partial matches
    const sorted = [...explicitMentions].sort((a, b) => b.text.length - a.text.length);
    for (const { text: mentionText, book_id } of sorted) {
      const escaped = mentionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const regex = new RegExp(escaped, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (!usedRanges.some(([s, e]) => start < e && end > s)) {
            matches.push({ start, end, title: match[0], id: book_id });
            usedRanges.push([start, end]);
          }
        }
      } catch { /* skip bad regex */ }
    }
  }

  // 2. Auto-detect from book titles (fills gaps not covered by explicit mentions)
  const titleMap: { title: string; id: string }[] = [];
  for (const book of allBooks) {
    const id = book.id;
    const dt = book.display_title;
    const t = book.title;
    if (dt && dt !== 'None') titleMap.push({ title: dt, id });
    if (t && t !== dt) titleMap.push({ title: t, id });
  }
  titleMap.sort((a, b) => b.title.length - a.title.length);

  for (const { title, id } of titleMap.filter(t => t.title.length >= 8)) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, title: match[0], id });
        usedRanges.push([start, end]);
      }
    }
  }

  if (matches.length === 0) return text;
  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const m of matches) {
    if (m.start > lastIdx) parts.push(text.slice(lastIdx, m.start));
    parts.push(
      <Link key={m.id + '-' + m.start} href={`/book/${m.id}`} className="text-accent-rust hover:underline italic">
        {m.title}
      </Link>
    );
    lastIdx = m.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return <>{parts}</>;
}

// ---------- Data fetching ----------

const COMPACT_LIMIT = 14;

/** Sanitize thumbnail URLs: unwrap /api/image?url= wrappers, reject non-http URLs.
 *  The /api/image wrapper crashes Next.js Image during SSR. */

async function fetchCollectionData(id: string) {
  // Wrap getDb() in a timeout — when MongoDB Atlas is overloaded, the connection
  // itself can hang for 60+ seconds. Better to fail fast and let ISR retry.
  const db = await withTimeout(getDb(), 10000, null as unknown as Awaited<ReturnType<typeof getDb>>);
  if (!db) throw new Error('DB connection timeout');

  const collection = await withTimeout(
    db.collection('collections').findOne({ slug: id }),
    8000, null,
  );
  if (!collection) return null;

  const isArtCollection = collection.collection_type === 'visual_art';

  const filter: Record<string, unknown> = isArtCollection
    ? { collections: id, resource_type: { $exists: true } }
    : {
        collections: id,
        $or: [
          { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } },
          { resource_type: { $exists: true } },
        ],
      };

  const projection = {
    _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1,
    photo: 1, categories: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
    resource_type: 1, commons_width: 1, commons_height: 1,
    is_first_translation: 1, ft_disposition: 1,
  };

  // Extract curated highlights from collection document
  const curatedHighlights: CuratedHighlight[] = collection.highlighted_books || [];
  const curatedBookIds = curatedHighlights.map((h: CuratedHighlight) => h.book_id);

  const mentionedBookIds = (collection.mentioned_books || [])
    .map((m: { book_id: string }) => m.book_id)
    .filter(Boolean);

  // Use cached book_count — sync-page-counts cron updates this every 6h
  // to reflect only translated books (pages_translated > 0).
  const total = collection.book_count || 0;

  // Track gallery collection slug for linking (captured in the gallery query below)
  let galleryCollectionSlug: string | null = null;
  let galleryTotalCount: number | null = null; // real total from thematic gallery (not capped)

  // All queries run in parallel with timeouts. Cold MongoDB connections from
  // Mumbai→Virginia can take 15-20s, so even "critical" queries need protection.
  // Fetch artworks for mixed collections (book collections that also contain artworks)
  const artworksPromise = !isArtCollection
    ? withTimeout(
        db.collection('books')
          .find(
            { collections: id, resource_type: { $exists: true } },
            {
              projection: {
                _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
                resource_type: 1, medium: 1, thumbnail: 1, thumbnail_blob: 1,
                'enrichment.subject': 1, 'enrichment.genre': 1,
                commons_width: 1, commons_height: 1,
              },
              maxTimeMS: 8000,
            },
          )
          .sort({ author: 1, title: 1 })
          .limit(60)
          .toArray(),
        8000, [],
      )
    : Promise.resolve([]);

  const [books, highlights, galleryImages, mentionedBooks] = await Promise.all([
    withTimeout(
      db.collection('books')
        .find(filter, { projection: { ...projection, collection_scores: 1 }, maxTimeMS: 8000 })
        .sort({ read_count: -1, title: 1 })
        .limit(COMPACT_LIMIT)
        .toArray()
        .then(docs => {
          // Re-sort by collection relevance score if available
          return docs.sort((a, b) => {
            const aScore = a.collection_scores?.[id]?.relevance ?? 0;
            const bScore = b.collection_scores?.[id]?.relevance ?? 0;
            if (bScore !== aScore) return bScore - aScore;
            return (b.read_count || 0) - (a.read_count || 0);
          }).map(({ collection_scores, ...rest }) => rest);
        }),
      15000, [],
    ),
    curatedBookIds.length > 0
      ? withTimeout(
          db.collection('books')
            .find(
              { id: { $in: curatedBookIds }, visible: true },
              { projection: { ...projection, is_first_translation: 1, 'translation_verification.disposition': 1 } },
            )
            .toArray(),
          8000, [],
        )
      : Promise.resolve([]),
    // Gallery: prefer thematic gallery collection (materialized), then curated, then dynamic query
    withTimeout(
      db.collection('gallery_collections')
        .findOne({ book_collection_slug: id, type: 'thematic' })
        .then(async (thematicCol) => {
          if (thematicCol?.slug) {
            galleryCollectionSlug = thematicCol.slug as string;
          }
          const thematicIds = thematicCol?.image_ids as string[] | undefined;
          if (thematicIds && thematicIds.length > 0) {
            galleryTotalCount = thematicIds.length;
            // Resolve a sample of image IDs for rendering (full set available via gallery page)
            return db.collection('gallery_images')
              .find({ id: { $in: thematicIds.slice(0, 60) } })
              .toArray();
          }
          if (collection.curated_gallery_images?.length > 0) {
            return collection.curated_gallery_images;
          }
          // Fallback: dynamic query (before thematic collections are seeded)
          const bookDocs = await db.collection('books')
            .find({ collections: id, visible: true }, { projection: { id: 1 }, maxTimeMS: 5000 })
            .toArray();
          const bookIds = bookDocs.map(d => d.id);
          if (bookIds.length === 0) return [];
          return db.collection('gallery_images')
            .find({
              book_id: { $in: bookIds },
              gallery_quality: { $gte: 0.8 },
              type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'printer_mark', 'ornament', 'border'] },
            })
            .sort({ gallery_quality: -1 })
            .limit(60)
            .toArray();
        }),
      8000, [],
    ),
    mentionedBookIds.length > 0
      ? withTimeout(
          db.collection('books')
            .find({ id: { $in: mentionedBookIds }, pages_translated: { $gt: 0 } }, { projection })
            .toArray(),
          8000, [],
        )
      : Promise.resolve([]),
  ]);

  const artworks = await artworksPromise;

  // Fetch parent collection if this is a subcollection
  let parentCollection: { slug: string; name: string } | null = null;
  if (collection.parent) {
    const parentDoc = await withTimeout(
      db.collection('collections').findOne(
        { slug: collection.parent },
        { projection: { slug: 1, name: 1 } },
      ),
      5000, null,
    );
    if (parentDoc) {
      parentCollection = { slug: parentDoc.slug, name: parentDoc.name };
    }
  }

  // Fetch child collections if this is a parent collection
  const childCollections = await withTimeout(
    db.collection('collections')
      .find({ parent: id, visible: true })
      .sort({ book_count: -1 })
      .project({ slug: 1, name: 1, subtitle: 1, book_count: 1, featured_images: 1 })
      .toArray(),
    8000, [],
  );

  const { _id, ...collectionClean } = collection;

  // Sanitize thumbnails to prevent /api/image wrapper URLs from crashing Next.js Image
  const sanitizeBookThumbs = (items: Record<string, unknown>[]) =>
    items.map(b => ({ ...b, thumbnail: sanitizeThumbnail(b.thumbnail as string) }));

  // Merge curated highlights with live book data (thumbnails, slugs, first-translation status)
  const curatedBookMap = new Map(
    (highlights as Record<string, unknown>[]).map(b => [b.id as string, b]),
  );
  const mergedHighlights = curatedHighlights
    .filter((h: CuratedHighlight) => curatedBookMap.has(h.book_id))
    .map((h: CuratedHighlight) => {
      const book = curatedBookMap.get(h.book_id) as Record<string, unknown>;
      return {
        ...h,
        title: (book.display_title as string) || (book.title as string) || h.title,
        author: (book.author as string) || h.author,
        year: (book.year as number) || h.year,
        slug: book.slug as string | undefined,
        thumbnail: sanitizeThumbnail(book.thumbnail as string),
        is_first_translation: book.is_first_translation as boolean | undefined,
        ft_disposition: (book.translation_verification as Record<string, unknown> | undefined)?.disposition as string | undefined,
        language: book.language as string | undefined,
        id: h.book_id,
      };
    });

  // Fetch curated exhibition data (if available)
  const curationDraft = await withTimeout(
    db.collection('curation_drafts').findOne(
      { collection_slug: id, status: 'draft' },
      { projection: { curation: 1 } },
    ),
    5000, null,
  );

  // Resolve book references in curation layout — attach thumbnails and slugs
  let exhibitionBooks: BookItem[] = [];
  if (curationDraft?.curation?.layout) {
    const allBookIds = new Set<string>();
    for (const block of curationDraft.curation.layout) {
      if (block.component === 'sections') {
        for (const s of block.sections || []) {
          for (const b of s.books || []) allBookIds.add(b.id);
        }
      }
      if (block.component === 'reading_paths') {
        for (const p of block.paths || []) {
          for (const step of p.steps || []) allBookIds.add(step.book_id);
        }
      }
      if (block.component === 'key_figures') {
        for (const f of block.figures || []) {
          if (f.key_book_id) allBookIds.add(f.key_book_id);
        }
      }
      if (block.component === 'timeline') {
        for (const h of block.highlights || []) {
          if (h.book_id) allBookIds.add(h.book_id);
        }
      }
    }
    if (allBookIds.size > 0) {
      const exBooks = await withTimeout(
        db.collection('books').find(
          { id: { $in: [...allBookIds] }, visible: true },
          { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, thumbnail: 1, thumbnail_blob: 1, is_first_translation: 1, 'translation_verification.disposition': 1 } },
        ).toArray(),
        8000, [],
      );
      exhibitionBooks = exBooks.map(b => ({
        ...b,
        thumbnail: sanitizeThumbnail(b.thumbnail as string) || sanitizeThumbnail(b.thumbnail_blob as string),
        ft_disposition: (b.translation_verification as Record<string, unknown> | undefined)?.disposition as string | undefined,
      })) as unknown as BookItem[];
    }
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collection: collectionClean as any,
    books: sanitizeBookThumbs(books) as unknown as BookItem[],
    highlights: mergedHighlights,
    total,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: galleryImages as any[],
    mentionedBooks: sanitizeBookThumbs(mentionedBooks) as unknown as BookItem[],
    parentCollection,
    galleryCollectionSlug,
    galleryTotalCount,
    exhibition: curationDraft?.curation || null,
    exhibitionBooks,
    childCollections: childCollections.map(({ _id, ...rest }) => rest) as { slug: string; name: string; subtitle?: string; book_count?: number; featured_images?: { extracted_url?: string; image_url?: string; thumbnail_url?: string }[] }[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artworks: artworks as any[],
  };
}

// ---------- Page ----------

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params;

  let data;
  try {
    data = await fetchCollectionData(id);
  } catch (err) {
    console.error('[Collection page] fetchCollectionData failed:', err instanceof Error ? err.message : err);
    // Don't re-throw — a crash here kills the build and blocks all deploys.
    // ISR will regenerate with real data on next revalidation.
    notFound();
  }
  if (!data) notFound();

  const { collection, books, highlights: curatedHighlightsData, galleryImages, total, mentionedBooks, parentCollection, galleryCollectionSlug, galleryTotalCount, exhibition, exhibitionBooks, childCollections, artworks } = data;
  const languages = (collection.languages || []).filter((l: { count: number }) => l.count > 2);
  const isArtCollection = collection.collection_type === 'visual_art';
  const itemLabel = isArtCollection ? 'works' : 'books';

  // Group curated highlights by tier — cap each to avoid heavy pages crashing mobile Safari
  const tier1 = curatedHighlightsData.filter((h: { tier: number }) => h.tier === 1).slice(0, 6);
  const tier2 = curatedHighlightsData.filter((h: { tier: number }) => h.tier === 2).slice(0, 9);
  const tier3 = curatedHighlightsData.filter((h: { tier: number }) => h.tier === 3).slice(0, 8);
  const hasCuratedHighlights = curatedHighlightsData.length > 0;

  // Build a diverse pool of ~50 top images (max 2 per book), then randomly pick 9 for display
  const imagePool: typeof galleryImages = [];
  const bookImageCounts = new Map<string, number>();
  for (const img of galleryImages) {
    const thumb = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
    if (!thumb) continue;
    const bid = img.book_id || img.bookId;
    const count = bookImageCounts.get(bid) || 0;
    if (count >= 2) continue;
    bookImageCounts.set(bid, count + 1);
    imagePool.push(img);
    if (imagePool.length >= 50) break;
  }

  // Fisher-Yates shuffle for randomized selection each ISR build
  const shuffled = [...imagePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const diverseGalleryImages = shuffled.slice(0, 9);
  const heroImages = shuffled.slice(0, 6);

  // Fallback hero: use collection.hero_image or first featured_image when no gallery images
  const fallbackHeroUrl = !heroImages.length
    ? (collection.hero_image as string | undefined)
      || (() => {
        const fi = (collection.featured_images as { extracted_url?: string; image_url?: string; thumbnail_url?: string }[] | undefined);
        const first = fi?.find(img => img.extracted_url || img.image_url || img.thumbnail_url);
        return first?.extracted_url || first?.image_url || first?.thumbnail_url;
      })()
      || null
    : null;
  // For art collections, build artwork preview from the books array (which ARE artworks)
  type ArtPreview = { id: string; slug?: string; title: string; display_title?: string; author?: string; thumbnail?: string; thumbnail_blob?: string; resource_type?: string; enrichment?: { subject?: string }; commons_width?: number; commons_height?: number };
  let artworkPreviewImages: ArtPreview[] = [];
  if (isArtCollection && diverseGalleryImages.length === 0) {
    const artPool = (books as ArtPreview[]).filter(a => sanitizeThumbnail(a.thumbnail_blob || a.thumbnail || ''));
    // Shuffle for variety on each ISR build
    for (let i = artPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [artPool[i], artPool[j]] = [artPool[j], artPool[i]];
    }
    artworkPreviewImages = artPool.slice(0, 9);
  }

  // Count total images and unique source books for gallery label
  // Use the real thematic total if available; otherwise fall back to fetched count
  const galleryTotalImages = galleryTotalCount ?? galleryImages.length;
  const galleryUniqueBooks = new Set(galleryImages.map((img: { book_id?: string; bookId?: string }) => img.book_id || img.bookId)).size;
  const allBooksForLinking = [
    ...curatedHighlightsData.map((h: { book_id: string; slug?: string; title?: string }) => ({
      id: h.book_id,
      slug: h.slug,
      title: h.title || '',
      display_title: h.title,
    })),
    ...books,
    ...mentionedBooks,
  ] as BookItem[];
  const explicitMentions: { text: string; book_id: string }[] = collection.mentioned_books || [];

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />
      <CollectionSchema
        slug={id}
        name={collection.name}
        description={collection.expanded_description || collection.description}
        bookCount={total}
        parentCollection={parentCollection}
        books={books.map(b => ({
          id: b.id,
          slug: b.slug,
          title: bookTitle(b),
          author: b.author,
          year: b.year,
        }))}
      />
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        {heroImages.length > 0 ? (
          <div className={`absolute inset-0 grid opacity-30 ${
            heroImages.length <= 2 ? 'grid-cols-2' :
            heroImages.length <= 3 ? 'grid-cols-3' :
            heroImages.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' :
            'grid-cols-3 sm:grid-cols-6'
          }`}>
            {heroImages.map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string }) => {
              const src = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
              const key = `${img.pageId || img.page_id}-${img.detectionIndex ?? img.detection_index}`;
              if (!src) return null;
              return (
                <div key={key} className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
              );
            })}
          </div>
        ) : artworkPreviewImages.length > 0 ? (
          <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6 opacity-30">
            {artworkPreviewImages.slice(0, 6).map((art) => {
              const src = sanitizeThumbnail(art.thumbnail_blob || art.thumbnail || '');
              if (!src) return null;
              return (
                <div key={art.id} className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
              );
            })}
          </div>
        ) : fallbackHeroUrl && (
          <div className="absolute inset-0 opacity-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fallbackHeroUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />

        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href={parentCollection ? `/collections/${parentCollection.slug}` : '/#library'}
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {parentCollection ? parentCollection.name : 'Library'}
          </Link>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display"
          >
            {collection.name}
          </h1>

          {collection.subtitle && (
            <p className="text-lg sm:text-xl text-white/70 max-w-3xl leading-relaxed mb-4">
              {collection.subtitle}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <a
              href="#collection-all-books"
              className="hover:text-white/80 transition-colors underline underline-offset-2 decoration-white/30"
            >
              {total.toLocaleString('en-US')} {itemLabel}
            </a>
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.map((l: { lang: string }) => l.lang).join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-collections grid */}
      {childCollections.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-8">
            <h2 className="text-2xl sm:text-3xl text-primary mb-5 font-display">
              Sub-collections
            </h2>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              {childCollections.map((child) => {
                const hero = child.featured_images?.find(
                  (img) => img.extracted_url || img.image_url || img.thumbnail_url
                );
                const heroUrl = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url;
                return (
                  <Link
                    key={child.slug}
                    href={`/collections/${child.slug}`}
                    className="group relative block overflow-hidden rounded-lg aspect-[4/3]"
                  >
                    {heroUrl ? (
                      <Image
                        src={heroUrl}
                        alt={`Illustration from ${child.name}`}
                        fill
                        sizes="(max-width: 640px) 50vw, 25vw"
                        className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        unoptimized
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#3d3529] to-[#2a2318] flex flex-col items-center justify-center gap-2">
                        <Library className="w-8 h-8 text-white/30" />
                        <span className="text-white/20 text-xs font-display">{child.book_count ? `${child.book_count} ${itemLabel}` : ''}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
                    <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
                      {child.book_count ? (
                        <p className="text-white/50 text-xs mb-1 hidden sm:block">
                          {child.book_count.toLocaleString()} {itemLabel}
                        </p>
                      ) : null}
                      <h3 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
                        {child.name}
                      </h3>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Featured Book — the #1 curated highlight, shown prominently to get visitors into a book fast */}
      {tier1.length > 0 && !exhibition?.layout && (() => {
        const featured = tier1[0];
        return (
          <div className="bg-warm border-b border-border-light">
            <div className="max-w-7xl mx-auto px-6 py-8">
              <Link
                href={bookUrl({ id: featured.id, slug: featured.slug })}
                className="group flex flex-col sm:flex-row gap-6 sm:gap-8"
              >
                <div className="w-40 sm:w-48 flex-shrink-0 mx-auto sm:mx-0">
                  <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-lg group-hover:shadow-xl transition-shadow">
                    {featured.thumbnail ? (
                      <Image
                        src={featured.thumbnail}
                        alt={featured.title || ''}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="192px"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookOpen className="w-12 h-12 text-muted" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-accent-rust mb-2">Start here</p>
                  <h2 className="text-2xl sm:text-3xl font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight mb-2 font-display">
                    {featured.title}
                  </h2>
                  <p className="text-base text-muted mb-3">
                    {featured.author}{featured.year ? `, ${featured.year}` : ''}
                    {featured.is_first_translation && (
                      <span className="ml-2 text-[10px] font-medium bg-accent-rust/10 text-accent-rust px-1.5 py-0.5 rounded">
                        {firstTranslationBadge(featured.ft_disposition, featured.language)}
                      </span>
                    )}
                  </p>
                  <p className="text-secondary leading-relaxed max-w-2xl">
                    {featured.note}
                  </p>
                </div>
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Gallery — labeled illustrations from this collection (or artwork previews for art collections) */}
      {diverseGalleryImages.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Illustrations
              </h2>
              <Link
                href={galleryCollectionSlug ? `/gallery/collections/${galleryCollectionSlug}` : `/gallery?collection=${id}`}
                className="text-sm text-muted hover:text-accent-rust transition-colors flex items-center gap-1.5"
              >
                <Images className="w-4 h-4" />
                Browse all
              </Link>
            </div>
            <p className="text-sm text-muted mb-5">
              {galleryTotalImages.toLocaleString()} images extracted{galleryTotalCount ? '' : ` from ${galleryUniqueBooks.toLocaleString()} ${itemLabel}`}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-4">
              {diverseGalleryImages.map((img: { pageId?: string; page_id?: string; bookId?: string; book_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string; museumDescription?: string; museum_description?: string; description?: string; bookTitle?: string; book_title?: string; type?: string }) => {
                const thumb = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
                const pageId = img.pageId || img.page_id;
                const bookId = img.bookId || img.book_id;
                const detIdx = img.detectionIndex ?? img.detection_index;
                const galleryId = `${pageId}-${detIdx}`;
                const label = img.museumDescription || img.museum_description || img.description || img.bookTitle || img.book_title;
                return (
                  <Link
                    key={galleryId}
                    href={`/book/${bookId}/page/${pageId}`}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={label}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || img.book_title || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(min-width: 1024px) 200px, (min-width: 640px) 160px, 120px"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full bg-cream flex items-center justify-center">
                        <Images className="w-6 h-6 text-muted" />
                      </div>
                    )}
                    {/* Label overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[11px] text-white leading-tight line-clamp-2">
                        {label}
                      </p>
                    </div>
                    {img.type && (
                      <span className="absolute top-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize leading-none">
                        {img.type}
                      </span>
                    )}
                  </Link>
                );
              })}
              {/* "View all" CTA card as last panel */}
              {galleryTotalImages > diverseGalleryImages.length && (
                <Link
                  href={galleryCollectionSlug ? `/gallery/collections/${galleryCollectionSlug}` : `/gallery?collection=${id}`}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream flex flex-col items-center justify-center gap-2 text-center"
                >
                  <Images className="w-8 h-8 text-muted group-hover:text-accent-rust transition-colors" />
                  <span className="text-sm font-medium text-muted group-hover:text-accent-rust transition-colors px-3">
                    View all {galleryTotalImages.toLocaleString()} illustrations
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Artwork preview — for art collections without gallery images */}
      {artworkPreviewImages.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Featured Works
              </h2>
            </div>
            <p className="text-sm text-muted mb-5">
              {total.toLocaleString()} works in this collection
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-4">
              {artworkPreviewImages.map((art) => {
                const thumb = sanitizeThumbnail(art.thumbnail_blob || art.thumbnail || '');
                return (
                  <Link
                    key={art.id}
                    href={`/artwork/${art.slug || art.id}`}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={art.display_title || art.title}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={art.display_title || art.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(min-width: 1024px) 200px, (min-width: 640px) 160px, 120px"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full bg-cream flex items-center justify-center">
                        <Images className="w-6 h-6 text-muted" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[11px] text-white leading-tight line-clamp-2">
                        {art.display_title || art.title}
                      </p>
                    </div>
                    {art.resource_type && (
                      <span className="absolute top-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize leading-none">
                        {art.resource_type}
                      </span>
                    )}
                  </Link>
                );
              })}
              {total > artworkPreviewImages.length && (
                <Link
                  href={`/collections/${id}#all-books`}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream flex flex-col items-center justify-center gap-2 text-center"
                >
                  <Images className="w-8 h-8 text-muted group-hover:text-accent-rust transition-colors" />
                  <span className="text-sm font-medium text-muted group-hover:text-accent-rust transition-colors px-3">
                    View all {total.toLocaleString()} works
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Visual Art — artworks tagged to this collection */}
      {artworks.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Visual Art
              </h2>
              <Link
                href="/artwork"
                className="text-sm text-muted hover:text-accent-rust transition-colors"
              >
                Browse all art &rarr;
              </Link>
            </div>
            <p className="text-sm text-muted mb-5">
              {artworks.length} {artworks.length === 1 ? 'work' : 'works'} of visual art in this collection
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {artworks.slice(0, 15).map((art: { id: string; slug?: string; title: string; display_title?: string; author?: string; published?: string; resource_type?: string; medium?: string; thumbnail?: string; thumbnail_blob?: string; enrichment?: { subject?: string; genre?: string }; commons_width?: number; commons_height?: number }) => {
                const thumb = sanitizeThumbnail(art.thumbnail_blob || art.thumbnail || '');
                const isPortrait = (art.commons_height || 0) > (art.commons_width || 0);
                return (
                  <Link
                    key={art.id}
                    href={`/artwork/${art.slug || art.id}`}
                    className="group block"
                  >
                    <div className="rounded-lg border border-border-light hover:border-accent-rust/40 hover:shadow-lg transition-[border-color,box-shadow] overflow-hidden bg-white">
                      <div className={`relative ${isPortrait ? 'aspect-[3/4]' : 'aspect-[4/3]'} bg-stone-100 overflow-hidden`}>
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={thumb}
                            alt={art.display_title || art.title}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Images className="w-8 h-8 text-muted" />
                          </div>
                        )}
                        {art.resource_type && art.resource_type !== 'printed_book' && (
                          <span className="absolute top-2 left-2 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize">
                            {art.resource_type}
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <h3
                          className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight line-clamp-2 mb-1"
                          style={{ fontFamily: 'var(--font-serif)' }}
                        >
                          {art.display_title || art.title}
                        </h3>
                        {art.author && (
                          <p className="text-xs text-muted line-clamp-1">{art.author}</p>
                        )}
                        {art.enrichment?.subject && (
                          <p className="text-xs text-secondary mt-1 line-clamp-2 leading-relaxed">
                            {art.enrichment.subject}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
              {artworks.length > 15 && (
                <Link
                  href={`/artwork`}
                  className="flex items-center justify-center rounded-lg border border-dashed border-border-light hover:border-accent-rust/40 hover:bg-warm transition-all aspect-[4/3] text-sm text-muted hover:text-accent-rust"
                >
                  +{artworks.length - 15} more works
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overview description */}
      {!exhibition?.layout && (collection.expanded_description || collection.description) && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="max-w-4xl">
              {(collection.expanded_description || collection.description)!.split('\n\n').map((para: string, i: number) => (
                <p key={i} className="text-secondary text-lg leading-relaxed mb-4 last:mb-0 font-body">
                  {linkBookTitles(para, allBooksForLinking, explicitMentions)}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Exhibition Layout — renders curated components if available */}
        {exhibition?.layout && (
          <div className="mb-12">
            {exhibition.subtitle && (
              <p className="text-lg text-muted italic mb-6 font-display">{exhibition.subtitle}</p>
            )}
            <ExhibitionLayout
              layout={exhibition.layout}
              books={exhibitionBooks as any[]}
              images={galleryImages}
              collectionSlug={id}
            />
          </div>
        )}

        {/* Curated Highlights — remaining tier 1 + tiers 2 & 3 (hidden when exhibition is present) */}
        {hasCuratedHighlights && !exhibition?.layout && (
          <div className="mb-12">
            {/* Tier 1: Essential Reading (skip first, already shown as featured) */}
            {tier1.length > 1 && (
              <div className="mb-10">
                <h2 className="text-2xl sm:text-3xl text-primary mb-2 font-display">
                  Essential Reading
                </h2>
                <p className="text-sm text-muted mb-6">The foundational texts of this tradition</p>
                <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2">
                  {tier1.slice(1).map((h: CuratedHighlight) => (
                    <Link
                      key={h.book_id}
                      href={bookUrl({ id: h.id, slug: h.slug })}
                      className="group flex gap-4 p-4 rounded-xl bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
                    >
                      <div className="w-20 sm:w-24 flex-shrink-0">
                        <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-warm">
                          {h.thumbnail ? (
                            <Image
                              src={h.thumbnail}
                              alt={h.title || ''}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              sizes="96px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-8 h-8 text-muted" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 py-1">
                        <h3 className="font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-1 font-display">
                          {h.title}
                        </h3>
                        <p className="text-sm text-muted mb-2">
                          {h.author}{h.year ? `, ${h.year}` : ''}
                          {h.is_first_translation && (
                            <span className="ml-2 text-[10px] font-medium bg-accent-rust/10 text-accent-rust px-1.5 py-0.5 rounded">
                              {firstTranslationBadge(h.ft_disposition, h.language)}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-secondary leading-relaxed line-clamp-3">
                          {h.note}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tier 2: Important Works */}
            {tier2.length > 0 && (
              <div className="mb-10">
                <h2 className="text-xl sm:text-2xl text-primary mb-2 font-display">
                  Important Works
                </h2>
                <p className="text-sm text-muted mb-5">Significant texts that deepen understanding</p>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {tier2.map((h: CuratedHighlight) => (
                    <Link
                      key={h.book_id}
                      href={bookUrl({ id: h.id, slug: h.slug })}
                      className="group flex gap-3 p-3 rounded-xl bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
                    >
                      <div className="w-14 flex-shrink-0">
                        <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-warm">
                          {h.thumbnail ? (
                            <Image
                              src={h.thumbnail}
                              alt={h.title || ''}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              sizes="56px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-5 h-5 text-muted" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 py-0.5">
                        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-0.5">
                          {h.title}
                        </h3>
                        <p className="text-xs text-muted mb-1">
                          {h.author}{h.year ? `, ${h.year}` : ''}
                          {h.is_first_translation && (
                            <span className="ml-1.5 text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                              {firstTranslationBadge(h.ft_disposition, h.language)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-secondary leading-relaxed line-clamp-2">
                          {h.note}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Tier 3: Also Notable */}
            {tier3.length > 0 && (
              <div className="mb-10">
                <h2 className="text-lg sm:text-xl text-primary mb-4 font-display">
                  Also Notable
                </h2>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {tier3.map((h: CuratedHighlight) => (
                    <Link
                      key={h.book_id}
                      href={bookUrl({ id: h.id, slug: h.slug })}
                      className="group flex items-center gap-3 p-2.5 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-sm transition-all"
                    >
                      <div className="w-10 flex-shrink-0">
                        <div className="aspect-[3/4] relative rounded overflow-hidden bg-warm">
                          {h.thumbnail ? (
                            <Image
                              src={h.thumbnail}
                              alt={h.title || ''}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-3.5 h-3.5 text-muted" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors truncate">
                          {h.title}
                        </h4>
                        <p className="text-xs text-muted truncate">
                          {h.author}{h.year ? `, ${h.year}` : ''}
                          {h.is_first_translation && (
                            <span className="ml-1.5 text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                              {firstTranslationBadge(h.ft_disposition, h.language)}
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* All Books — client component handles compact → expanded transition */}
        <CollectionAllBooks
          collectionId={id}
          compactBooks={books.filter(b => !b.resource_type)}
          total={total}
          languages={languages}
          collectionType={collection.collection_type}
        />
      </div>
      <SignUpCTA />
    </div>
  );
}
