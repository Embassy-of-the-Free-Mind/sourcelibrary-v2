/**
 * Layout for Single Image Pages
 *
 * INTENT:
 * Provides metadata for SEO and social sharing.
 * Each image becomes a citable, shareable, discoverable unit.
 */

import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';

interface PageWithBook {
  id: string;
  book_id: string;
  page_number: number;
  detected_images?: Array<{
    description: string;
    type?: string;
  }>;
  book?: {
    title?: string;
    display_title?: string;
    author?: string;
    published?: number;
  };
}

interface Detection {
  description: string;
  type?: string;
}

async function getImageData(id: string): Promise<{ page: PageWithBook; detection: Detection } | null> {
  try {
    const [pageId, indexStr] = id.split(':');
    const index = parseInt(indexStr, 10);

    if (!pageId || isNaN(index)) return null;

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

    return { page, detection: detections[index] };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getImageData(id);

  if (!data) {
    return {
      title: 'Image | Source Library',
      description: 'Explore historical illustrations from early modern texts.',
    };
  }

  const { page, detection } = data;
  const bookTitle = page.book?.display_title || page.book?.title || 'Unknown';
  const author = page.book?.author;
  const year = page.book?.published;
  const description = detection.description || 'Historical illustration';

  const title = `${description.slice(0, 60)}${description.length > 60 ? '...' : ''} | Source Library`;

  const fullDescription = `${description}. From "${bookTitle}"${author ? ` by ${author}` : ''}${year ? ` (${year})` : ''}.`;

  return {
    title,
    description: fullDescription,
    openGraph: {
      title: description,
      description: fullDescription,
      type: 'article',
      siteName: 'Source Library',
    },
    twitter: {
      card: 'summary_large_image',
      title: description,
      description: fullDescription,
    },
  };
}

export default function ImageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
