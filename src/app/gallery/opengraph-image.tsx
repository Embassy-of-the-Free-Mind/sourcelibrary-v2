import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';

export const alt = 'Image Gallery - Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

async function getFeaturedImages(): Promise<string[]> {
  try {
    const db = await getDb();
    const results = await db.collection('pages').aggregate([
      {
        $match: {
          'detected_images.0': { $exists: true },
          $or: [
            { cropped_photo: { $exists: true, $ne: '' } },
            { photo_original: { $exists: true, $ne: '' } },
            { photo: { $exists: true, $ne: '' } },
          ],
          detected_images: {
            $elemMatch: {
              bbox: { $exists: true },
              detection_source: { $in: ['vision_model', 'manual'] },
              gallery_quality: { $gte: 0.8 },
            },
          },
        },
      },
      { $unwind: '$detected_images' },
      {
        $match: {
          'detected_images.bbox': { $exists: true },
          'detected_images.gallery_quality': { $gte: 0.8 },
        },
      },
      { $sort: { 'detected_images.gallery_quality': -1 } },
      { $limit: 5 },
      {
        $project: {
          imageUrl: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] },
          bbox: '$detected_images.bbox',
        },
      },
    ]).toArray();

    return results.map((r) => {
      let url = r.imageUrl as string;
      if (url?.includes('/full/')) {
        url = url.replace(/\/full\/\d+,\//, '/full/800,/');
      }
      if (r.bbox) {
        const params = new URLSearchParams({
          url,
          x: String(r.bbox.x),
          y: String(r.bbox.y),
          w: String(r.bbox.width),
          h: String(r.bbox.height),
        });
        return `https://sourcelibrary.org/api/crop-image?${params}`;
      }
      return url;
    });
  } catch {
    return [];
  }
}

export default async function Image() {
  const images = await getFeaturedImages();

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1612 0%, #2d2520 50%, #1a1612 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
          position: 'relative',
        }}
      >
        {/* Decorative border */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 20,
            right: 20,
            bottom: 20,
            border: '2px solid rgba(201, 168, 108, 0.3)',
            borderRadius: 16,
            display: 'flex',
          }}
        />

        {/* Grid of featured images */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 40,
          }}
        >
          {images.length > 0
            ? images.map((url, i) => (
                <div
                  key={i}
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 8,
                    border: '1px solid rgba(201, 168, 108, 0.3)',
                    overflow: 'hidden',
                    display: 'flex',
                  }}
                >
                  <img
                    src={url}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>
              ))
            : [1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 100,
                    height: 100,
                    background: `rgba(201, 168, 108, ${0.08 + i * 0.04})`,
                    borderRadius: 8,
                    border: '1px solid rgba(201, 168, 108, 0.2)',
                    display: 'flex',
                  }}
                />
              ))}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 400,
            color: '#fdfcf9',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            letterSpacing: '-0.02em',
            marginBottom: 16,
            display: 'flex',
          }}
        >
          Image Gallery
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 22,
            color: '#c9a86c',
            fontFamily: 'Georgia, serif',
            textAlign: 'center',
            maxWidth: 700,
            lineHeight: 1.4,
            display: 'flex',
          }}
        >
          Illustrations from rare Hermetic, alchemical &amp; philosophical texts
        </div>

        {/* Source Library branding */}
        <div
          style={{
            position: 'absolute',
            bottom: 36,
            right: 48,
            fontSize: 18,
            color: 'rgba(253, 252, 249, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Source Library</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
