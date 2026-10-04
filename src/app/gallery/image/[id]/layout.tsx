/**
 * Layout for Single Image Pages
 *
 * INTENT:
 * Provides metadata for SEO and social sharing.
 * Each image becomes a citable, shareable, discoverable unit.
 */

import { cache } from 'react';
import { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { galleryPageWithBookPipeline } from '@/lib/gallery-page-lookup';
import GalleryImageSchema from '@/components/seo/GalleryImageSchema';

/** True if `books` has a doc for this id (string `id` field or Mongo `_id`). */
const bookExists = cache(async (bookId: string): Promise<boolean> => {
  try {
    const db = await getReadDb();
    const or: Record<string, unknown>[] = [{ id: bookId }];
    if (/^[a-f0-9]{24}$/i.test(bookId)) or.push({ _id: new ObjectId(bookId) });
    const doc = await db.collection('books').findOne({ $or: or }, { projection: { _id: 1 } });
    return !!doc;
  } catch {
    // Fail open on a transient DB error — never turn one into a 404.
    return true;
  }
});

/**
 * True if the bare viewer id `<pageId>-<n>` resolves to an image the API would
 * actually serve — a live page detection OR a `gallery_images` fallback row
 * (orphaned page / stale index), excluding hidden books. Mirrors
 * /api/gallery/image/[id] so the 404 gate matches exactly what the client can
 * render; without the gallery_images leg we would wrongly 404 orphaned-page
 * images that resolve only through it (#3049).
 */
const imageResolves = cache(async (id: string): Promise<boolean> => {
  try {
    const decodedId = decodeURIComponent(id);
    const match = decodedId.match(/^(.+)[:\-](\d+)$/);
    if (!match) return false;
    const [, pageId, indexStr] = match;
    const index = parseInt(indexStr, 10);
    const db = await getReadDb();

    const pages = await db.collection('pages').aggregate(galleryPageWithBookPipeline({ id: pageId })).toArray();

    if (pages.length) {
      const p = pages[0] as { book?: { hidden?: boolean }; detected_images?: unknown[] };
      if (p.book?.hidden === true) return false;
      const detections = p.detected_images || [];
      if (index >= 0 && index < detections.length && detections[index]) return true;
    }

    const galleryDoc = await db.collection('gallery_images').findOne({ id: `${pageId}-${index}` });
    return !!galleryDoc;
  } catch {
    // Fail open — a transient DB error must not render as a 404.
    return true;
  }
});

/**
 * Rescue (or reject) non-viewer ids that leaked into /gallery/image/ links.
 *
 * Several producers (clip_embeddings rows, the merged gallery browse) use
 * prefixed id namespaces that are NOT viewer ids:
 *   - artwork-<bookId>[-<n>]  — standalone artwork (books collection)
 *   - cover-<bookId>[-<n>]    — book cover clip row
 *   - gallery-<pageId>-<n>    — clip row for a real gallery image
 * The viewer only resolves bare `<pageId>-<n>`, so these all soft-404.
 * Redirect them to where the content actually lives — but only if it exists.
 * An artwork/cover id whose book has been deleted (or never existed) must NOT
 * be redirected into another dead `/book/<id>` page; render a clean 404 (#3049).
 */
async function resolveLeakedId(id: string): Promise<void> {
  const decoded = decodeURIComponent(id);
  const prefixed = decoded.match(/^(artwork|cover|gallery)-(.+)$/);
  if (!prefixed) return;
  const [, prefix, rest] = prefixed;
  if (prefix === 'gallery') {
    // Canonicalize to the bare viewer id; that page's own gate 404s if it too
    // resolves to nothing.
    permanentRedirect(`/gallery/image/${rest}`);
  }
  // artwork/cover: the payload is a book id, sometimes with a synthetic
  // detection-index suffix (`artwork-<bookId>-0` from the merged browse).
  const bookId = rest.replace(/-\d+$/, '');
  if (await bookExists(bookId)) permanentRedirect(`/book/${bookId}`);
  notFound();
}

interface PageWithBook {
  id: string;
  book_id: string;
  page_number: number;
  photo?: string;
  archived_photo?: string;
  cropped_photo?: string;
  detected_images?: Array<{
    description: string;
    type?: string;
    museum_description?: string;
    metadata?: {
      subjects?: string[];
      figures?: string[];
      symbols?: string[];
      style?: string;
      technique?: string;
    };
  }>;
  book?: {
    id: string;
    slug?: string;
    title?: string;
    display_title?: string;
    author?: string;
    published?: string;
    license?: string;
    image_source?: {
      provider?: string;
      license?: string;
      attribution?: string;
    };
  };
}

interface Detection {
  description: string;
  type?: string;
  /** Cropped + rotated plate JPEG in R2 (see DetectedImage in lib/types/page). */
  extracted_url?: string;
  museum_description?: string;
  metadata?: {
    subjects?: string[];
    figures?: string[];
    symbols?: string[];
    style?: string;
    technique?: string;
  };
}

const getImageData = cache(async (id: string): Promise<{ page: PageWithBook; detection: Detection; detectionIndex: number } | null> => {
  try {
    const decodedId = decodeURIComponent(id);
    // Accept both : and - as separators (- for URLs, : for legacy)
    const match = decodedId.match(/^(.+)[:\-](\d+)$/);
    if (!match) return null;
    const [, pageId, indexStr] = match;
    const index = parseInt(indexStr, 10);

    const db = await getReadDb();
    const pages = await db.collection('pages').aggregate(galleryPageWithBookPipeline({ id: pageId })).toArray();

    if (!pages.length) return null;

    const page = pages[0] as unknown as PageWithBook;
    const detections = page.detected_images || [];

    if (index < 0 || index >= detections.length) return null;

    const detection = detections[index];
    if (!detection) return null;

    return { page, detection, detectionIndex: index };
  } catch {
    return null;
  }
});

/**
 * The image this page is about: the plate's own cut-out (`extracted_url`, a
 * cropped + rotated JPEG in R2, present on ~99.6% of public gallery images),
 * falling back to the whole page scan. Search engines index whatever this
 * returns — og:image, the ImageObject contentUrl, and the crawler-visible
 * <img> — so the full-page fallback meant Google Images was offered a page of
 * text with a small woodcut in the corner instead of the woodcut.
 */
function plateImageUrl(page: PageWithBook, detection: Detection): string | undefined {
  return detection.extracted_url
    || (page as { enhanced_photo?: string }).enhanced_photo
    || page.cropped_photo
    || page.archived_photo
    || page.photo;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  await resolveLeakedId(id);
  let data;
  try {
    data = await getImageData(id);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  // Normalize ID to use - separator for canonical URLs
  const urlSafeId = decodeURIComponent(id).replace(/:(\d+)$/, '-$1');

  if (!data) {
    return {
      title: 'Image Not Found | Source Library',
      robots: { index: false, follow: true },
    };
  }

  const { page, detection } = data;
  const bookTitle = page.book?.display_title || page.book?.title || 'Unknown';
  const author = page.book?.author;
  const year = page.book?.published;
  const description = detection.description || 'Historical illustration';
  const plateUrl = plateImageUrl(page, detection);

  // Short title: first sentence (up to 70 chars) for social card headline
  const firstSentence = description.split(/\.\s/)[0].replace(/[.\s]+$/, '');
  const shortTitle = firstSentence.length > 70
    ? firstSentence.slice(0, 68).replace(/\s+\S*$/, '') + '\u2026'
    : firstSentence;

  // Attribution line for context
  const attribution = `${bookTitle}${author ? ` by ${author}` : ''}${year ? ` (${year})` : ''}`;

  // OG title: short description + book info
  const ogTitle = `${shortTitle} — ${attribution}`;

  // `absolute`: the /gallery layout template would append "| Source Library
  // Gallery" after our own suffix. Book and author belong in the title — it is
  // what a search for "<book>" or "<author>" matches against.
  const bookAttribution = `${bookTitle}${author && author !== 'Various' ? `, ${author}` : ''}${year ? ` (${year})` : ''}`;
  const title = { absolute: `${shortTitle} \u2014 ${bookAttribution} | Source Library` };

  return {
    title,
    description: `${description.replace(/[.\s]+$/, '')}. From "${attribution}".`,
    alternates: {
      canonical: `/gallery/image/${urlSafeId}`,
    },
    other: {
      'pinterest-rich-pin': 'true',
    },
    openGraph: {
      title: ogTitle,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      // The actual scan, not the generated template card: a 200k-image
      // collection was presenting the same card in every link preview and to
      // every og-reading crawler (#4286). When no image resolves, omit the key
      // so the file-convention opengraph-image card fills in.
      ...(plateUrl ? { images: [{ url: plateUrl, alt: `${shortTitle} \u2014 ${bookAttribution}` }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      // Per the shallow-merge invariant, X reads twitter.images (the root
      // layout's generic logo would win without this).
      ...(plateUrl ? { images: [plateUrl] } : {}),
    },
  };
}

export default async function ImageLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  await resolveLeakedId(id);
  const data = await getImageData(id);
  const urlSafeId = decodeURIComponent(id).replace(/:(\d+)$/, '-$1');

  if (!data) {
    // getImageData only checks page detections; the API also serves orphaned
    // images from gallery_images. 404 only when neither resolves — otherwise
    // render the shell so the client can fetch the gallery_images fallback.
    if (!(await imageResolves(id))) notFound();
    return <div className="min-h-screen bg-black">{children}</div>;
  }

  const { page, detection } = data;
  const imageUrl = plateImageUrl(page, detection);
  const bookTitle = page.book?.display_title || page.book?.title || 'the source volume';
  const authorName = page.book?.author && page.book.author !== 'Various' ? page.book.author : '';
  const year = page.book?.published;
  const bookHref = `/book/${page.book?.slug || page.book?.id || page.book_id}?page=${page.page_number}`;
  const altText = `${detection.description || 'Historical illustration'} \u2014 from ${bookTitle}${authorName ? ` by ${authorName}` : ''}${year ? ` (${year})` : ''}`;

  return (
    <div className="min-h-screen bg-black">
      <GalleryImageSchema
        imageId={urlSafeId}
        description={detection.description}
        museumDescription={detection.museum_description}
        type={detection.type}
        metadata={detection.metadata}
        imageUrl={imageUrl}
        book={page.book}
      />
      {children}
      {/* Server-rendered content for crawlers (#4286). The viewer is a client
          component, so the served HTML would otherwise carry nav, footer and
          meta tags but no heading, caption or book link. This is the page's
          only <h1> (the viewer's headings are h2) and it is visible: a caption
          naming the book, author and year, linking to the book. */}
      <section className="max-w-3xl mx-auto px-6 py-8 text-stone-200" aria-label="Image details">
        <h1 className="text-xl sm:text-2xl font-serif text-white leading-snug">
          {detection.description || 'Historical illustration'}
        </h1>
        <p className="mt-3 text-sm sm:text-base text-stone-300">
          {detection.type ? `${detection.type.charAt(0).toUpperCase()}${detection.type.slice(1)} from ` : 'From '}
          <a href={bookHref} className="underline text-accent-gold">{bookTitle}</a>
          {authorName ? <>, by {authorName}</> : null}
          {year ? <> ({year})</> : null}
          {page.page_number != null ? <>, page {page.page_number}</> : null}.
        </p>
        {detection.museum_description && (
          <p className="mt-3 text-sm text-stone-400">{detection.museum_description}</p>
        )}
        <noscript>
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={altText} style={{ maxWidth: '100%', height: 'auto' }} />
          )}
        </noscript>
      </section>
    </div>
  );
}
