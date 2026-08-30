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

    const pages = await db.collection('pages').aggregate([
      { $match: { id: pageId } },
      { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    ]).toArray();

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
    const pages = await db.collection('pages').aggregate([
      { $match: { id: pageId } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
    ]).toArray();

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
  const plateUrl = (page as { enhanced_photo?: string }).enhanced_photo || page.cropped_photo || page.archived_photo || page.photo;

  // Short title: first sentence (up to 70 chars) for social card headline
  const firstSentence = description.split(/\.\s/)[0];
  const shortTitle = firstSentence.length > 70
    ? firstSentence.slice(0, 67) + '...'
    : firstSentence;

  // Attribution line for context
  const attribution = `${bookTitle}${author ? ` by ${author}` : ''}${year ? ` (${year})` : ''}`;

  // OG title: short description + book info
  const ogTitle = `${shortTitle} — ${attribution}`;

  const title = `${shortTitle} | Source Library`;

  return {
    title,
    description: `${description}. From "${attribution}".`,
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
      ...(plateUrl ? { images: [{ url: plateUrl, alt: shortTitle }] } : {}),
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
  const imageUrl = (page as any).enhanced_photo || page.cropped_photo || page.archived_photo || page.photo;

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
      {/* Server-rendered content for non-JS consumers (#4286). The viewer is a
          client component, so without this the served HTML carried nav, footer
          and meta tags but no image, caption, or book link — crawlers and LLM
          retrieval bots (which fetch raw HTML and do not run JS) saw an empty
          body on the canonical citable page for every plate. noscript keeps it
          out of the JS-rendered view; the markup itself is what raw-HTML
          fetchers read. */}
      <noscript>
        <figure className="max-w-3xl mx-auto p-6 text-white">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={detection.description || 'Historical illustration'} style={{ maxWidth: '100%', height: 'auto' }} />
          )}
          <figcaption className="mt-4 space-y-2 text-sm">
            <p>{detection.description}</p>
            {detection.museum_description && <p>{detection.museum_description}</p>}
            <p>
              From{' '}
              <a href={`/book/${page.book?.slug || page.book?.id || page.book_id}?page=${page.page_number}`} className="underline">
                {page.book?.display_title || page.book?.title || 'the source volume'}
                {page.book?.author ? ` by ${page.book.author}` : ''}
                {page.book?.published ? ` (${page.book.published})` : ''}
              </a>
              , page {page.page_number}.
            </p>
          </figcaption>
        </figure>
      </noscript>
      {children}
    </div>
  );
}
