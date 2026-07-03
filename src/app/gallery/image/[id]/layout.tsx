/**
 * Layout for Single Image Pages
 *
 * INTENT:
 * Provides metadata for SEO and social sharing.
 * Each image becomes a citable, shareable, discoverable unit.
 */

import { cache } from 'react';
import { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import GalleryImageSchema from '@/components/seo/GalleryImageSchema';

/**
 * Rescue non-viewer ids that leaked into /gallery/image/ links.
 *
 * Several producers (clip_embeddings rows, the merged gallery browse) use
 * prefixed id namespaces that are NOT viewer ids:
 *   - artwork-<bookId>[-<n>]  — standalone artwork (books collection)
 *   - cover-<bookId>[-<n>]    — book cover clip row
 *   - gallery-<pageId>-<n>    — clip row for a real gallery image
 * The viewer only resolves bare `<pageId>-<n>`, so these all soft-404.
 * Redirect them to where the content actually lives instead.
 */
function redirectLeakedId(id: string): void {
  const decoded = decodeURIComponent(id);
  const prefixed = decoded.match(/^(artwork|cover|gallery)-(.+)$/);
  if (!prefixed) return;
  const [, prefix, rest] = prefixed;
  if (prefix === 'gallery') {
    permanentRedirect(`/gallery/image/${rest}`);
  }
  // artwork/cover: the payload is a book id, sometimes with a synthetic
  // detection-index suffix (`artwork-<bookId>-0` from the merged browse).
  const bookId = rest.replace(/-\d+$/, '');
  permanentRedirect(`/book/${bookId}`);
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
  redirectLeakedId(id);
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
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
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
  redirectLeakedId(id);
  const data = await getImageData(id);
  const urlSafeId = decodeURIComponent(id).replace(/:(\d+)$/, '-$1');

  if (!data) return <div className="min-h-screen bg-black">{children}</div>;

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
      {children}
    </div>
  );
}
