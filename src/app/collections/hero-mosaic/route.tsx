import { ImageResponse } from 'next/og';
import { getReadDb } from '@/lib/mongodb';
import { sanitizeThumbnail, coverOverride } from '@/lib/collections-utils';

// Cache the composited mosaic hard — it changes rarely and is expensive to
// build (Satori fetches every tile server-side). One image reaches the browser.
export const revalidate = 86400;
export const runtime = 'nodejs';

// 3 rows tall — the hero renders this at background-size "auto 100%" so all 3
// rows are always visible (never cropped top/bottom) and the strip repeats
// horizontally. Wide enough (16 cols) that the repeat seam is off-screen on
// typical desktops.
const WIDTH = 2560;
const HEIGHT = 480;
const TILE = 160;
const COLS = WIDTH / TILE; // 16
const ROWS = HEIGHT / TILE; // 3
const COUNT = COLS * ROWS; // 48 tiles

interface FeaturedImage {
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
}

/** One representative thumbnail per visible collection, in a stable order, so
 *  the mosaic is varied (not 30 tiles from the same collection). */
async function getTileUrls(): Promise<string[]> {
  try {
    const db = await getReadDb();
    const docs = await db
      .collection('collections')
      .find(
        { visible: true, featured_images: { $exists: true, $ne: [] } },
        { projection: { slug: 1, featured_images: 1, order: 1 } },
      )
      .sort({ order: 1 })
      .limit(120)
      .toArray();

    const urls: string[] = [];
    for (const d of docs) {
      // Curated cover wins; otherwise first usable featured image.
      const override = sanitizeThumbnail(coverOverride(d.slug as string | undefined));
      if (override && !urls.includes(override)) {
        urls.push(override);
        if (urls.length >= COUNT) break;
        continue;
      }
      const imgs = d.featured_images as Array<FeaturedImage | string> | undefined;
      if (!Array.isArray(imgs)) continue;
      for (const img of imgs) {
        const raw = typeof img === 'string' ? img : img.thumbnail_url || img.extracted_url || img.image_url;
        const u = sanitizeThumbnail(raw);
        if (u && !urls.includes(u)) {
          urls.push(u);
          break; // one tile per collection
        }
      }
      if (urls.length >= COUNT) break;
    }
    return urls;
  } catch {
    return [];
  }
}

export async function GET() {
  const urls = await getTileUrls();
  // Tile the grid completely even if fewer than COUNT collections resolve.
  const tiles = urls.length ? Array.from({ length: COUNT }, (_, i) => urls[i % urls.length]) : [];

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          width: WIDTH,
          height: HEIGHT,
          background: '#1a1612',
        }}
      >
        {tiles.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img key={i} src={u} width={TILE} height={TILE} style={{ objectFit: 'cover' }} />
        ))}
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}
