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
  extracted_url?: string;
  rotation?: number;
}

async function getImageData(id: string): Promise<{ page: PageWithBook; detection: Detection } | null> {
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

    return { page, detection: detections[index] };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getImageData(id);

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
  let imageUrl = page.cropped_photo || page.photo_original || page.photo;
  const description = detection.description || '';

  // Upgrade IIIF URLs to higher resolution for sharper OG images
  if (imageUrl?.includes('/full/')) {
    imageUrl = imageUrl.replace(/\/full\/\d+,\//, '/full/2000,/');
  }

  // Prefer pre-generated extracted_url, fall back to on-the-fly crop
  let displayUrl = imageUrl;
  if (detection.extracted_url) {
    displayUrl = detection.extracted_url;
  } else if (detection.bbox && imageUrl) {
    const params = new URLSearchParams({
      url: imageUrl,
      x: String(detection.bbox.x),
      y: String(detection.bbox.y),
      w: String(detection.bbox.width),
      h: String(detection.bbox.height),
    });
    if (detection.rotation) params.set('rotation', String(detection.rotation));
    displayUrl = `https://sourcelibrary.org/api/crop-image?${params}`;
  }

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
            }}
          />
        )}
      </div>
    ),
    { ...size }
  );
}
