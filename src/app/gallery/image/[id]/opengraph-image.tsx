/**
 * Open Graph Image for Gallery Items
 *
 * INTENT:
 * When someone shares a gallery image link on Twitter/Facebook/etc,
 * this generates the preview card. It should:
 * - Show the image prominently
 * - Include minimal context (book title, description)
 * - Look beautiful and shareable
 * - Make people want to click through
 *
 * This is the social media growth hook for the visual encyclopedia.
 */

import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';

export const alt = 'Image from Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

interface PageWithBook {
  id: string;
  book_id: string;
  page_number: number;
  photo: string;
  photo_original?: string;
  cropped_photo?: string;
  detected_images?: Array<{
    description: string;
    type?: string;
    bbox?: { x: number; y: number; width: number; height: number };
  }>;
  book?: {
    title?: string;
    display_title?: string;
    author?: string;
  };
}

interface Detection {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
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

export default async function Image({ params }: { params: { id: string } }) {
  const data = await getImageData(params.id);

  if (!data) {
    // Fallback for missing images
    return new ImageResponse(
      (
        <div
          style={{
            background: '#1c1917',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a8a29e',
            fontSize: 32,
          }}
        >
          Image not found
        </div>
      ),
      { ...size }
    );
  }

  const { page, detection } = data;
  const imageUrl = page.cropped_photo || page.photo_original || page.photo;
  const bookTitle = page.book?.display_title || page.book?.title || 'Unknown';
  const description = detection.description || '';

  // Build cropped image URL if bbox exists
  let displayUrl = imageUrl;
  if (detection.bbox && imageUrl) {
    // For OG images, we need absolute URL to crop API
    // Since we can't easily get the host here, use the full page image
    // The crop will happen client-side or we serve full image
    displayUrl = imageUrl;
  }

  return new ImageResponse(
    (
      <div
        style={{
          background: '#1c1917',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* Image - takes most of the space */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            paddingBottom: 100,
          }}
        >
          {displayUrl && (
            <img
              src={displayUrl}
              alt={description}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 8,
              }}
            />
          )}
        </div>

        {/* Bottom bar with metadata */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
            padding: '48px 32px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Description */}
          <div
            style={{
              color: '#fafaf9',
              fontSize: 24,
              fontFamily: 'serif',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {description.length > 100 ? description.slice(0, 100) + '...' : description}
          </div>

          {/* Book info */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              color: '#d6d3d1',
              fontSize: 16,
            }}
          >
            <span style={{ color: '#f59e0b' }}>Source Library</span>
            <span>•</span>
            <span>{bookTitle}</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
