/**
 * Layout for Single Image Pages
 *
 * INTENT:
 * Provides metadata for SEO and social sharing.
 * Each image becomes a citable, shareable, discoverable unit.
 */

import { cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import GalleryImageSchema from '@/components/seo/GalleryImageSchema';

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

    const db = await getDb();
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

    return { page, detection: detections[index], detectionIndex: index };
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
  const data = await getImageData(id);

  // Normalize ID to use - separator for canonical URLs
  const urlSafeId = decodeURIComponent(id).replace(/:(\d+)$/, '-$1');

  if (!data) {
    return {
      title: 'Image | Source Library',
      description: 'Explore historical illustrations from early modern texts.',
      alternates: {
        canonical: `/gallery/image/${urlSafeId}`,
      },
      openGraph: {
        title: 'Image',
        description: 'Explore historical illustrations from early modern texts.',
        siteName: 'Source Library',
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Image',
        description: 'Explore historical illustrations from early modern texts.',
      },
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
    openGraph: {
      title: ogTitle,
      description,
      type: 'article',
      siteName: 'Source Library',
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
  const data = await getImageData(id);
  const urlSafeId = decodeURIComponent(id).replace(/:(\d+)$/, '-$1');

  if (!data) return <div className="min-h-screen bg-black">{children}</div>;

  const { page, detection } = data;
  const imageUrl = page.cropped_photo || page.archived_photo || page.photo;

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
