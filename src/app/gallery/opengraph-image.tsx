import { ImageResponse } from 'next/og';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const alt = 'Image Gallery - Source Library';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

/**
 * Fetch high-quality gallery images that have pre-extracted URLs.
 * Never use /api/crop-image here — it's unreliable during OG generation
 * and produces garbled previews on social platforms.
 */
async function getFeaturedImages(): Promise<string[]> {
  try {
    const db = await getDb();
    const results = await db.collection('pages').aggregate([
      {
        $match: {
          'detected_images': {
            $elemMatch: {
              extracted_url: { $exists: true, $ne: '' },
              gallery_quality: { $gte: 0.85 },
            },
          },
        },
      },
      { $unwind: '$detected_images' },
      {
        $match: {
          'detected_images.extracted_url': { $exists: true, $ne: '' },
          'detected_images.gallery_quality': { $gte: 0.85 },
        },
      },
      { $sort: { 'detected_images.gallery_quality': -1 } },
      { $limit: 3 },
      {
        $project: {
          _id: 0,
          url: '$detected_images.extracted_url',
        },
      },
    ]).toArray();

    return results.map((r) => r.url as string).filter(Boolean);
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
          padding: '40px 60px',
          position: 'relative',
          fontFamily: 'Georgia, serif',
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

        {/* Featured images — 3 large images instead of 5 tiny ones */}
        <div
          style={{
            display: 'flex',
            gap: 20,
            marginBottom: 36,
          }}
        >
          {images.length > 0
            ? images.map((url, i) => (
                <div
                  key={i}
                  style={{
                    width: 180,
                    height: 220,
                    borderRadius: 8,
                    border: '1px solid rgba(201, 168, 108, 0.3)',
                    overflow: 'hidden',
                    display: 'flex',
                    background: 'rgba(0,0,0,0.3)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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
            : [1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 180,
                    height: 220,
                    background: `rgba(201, 168, 108, ${0.06 + i * 0.04})`,
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
