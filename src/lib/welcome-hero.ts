import { getReadDb } from '@/lib/mongodb';

export type WelcomeHero = {
  imageUrl: string;
  bookTitle?: string | null;
  bookYear?: number | null;
  description?: string | null;
};

// Locked hero — single chosen image for the welcome page. Metadata is fetched
// from the gallery_images collection by URL so the attribution stays accurate.
const HERO_IMAGE_URL = 'https://images.sourcelibrary.org/archived/69b525af95677df8153c6f62/66.jpg';

// The archival original is a 26 MB full-resolution scan, and the welcome page
// renders it full-bleed with `unoptimized` (the house convention — 27 other files
// do the same, keeping R2 images off Vercel's image-optimization bill). So nothing
// was resizing it: the browser pulled all 26 MB and the page sat as a bare dark
// rectangle for ~10s on desktop ethernet, far worse on a phone. This is the first
// screen 3,850 existing readers see exactly once, so it mattered more than usual.
//
// Route it through the house resizer instead — measured 626 KB at w=1920/q=80,
// served in 1.8s. The raw URL stays the gallery_images lookup key; only the
// rendered URL changes.
const HERO_DISPLAY_WIDTH = 1920;
const HERO_DISPLAY_QUALITY = 80;

export function heroDisplayUrl(sourceUrl: string): string {
  return `/api/image?url=${encodeURIComponent(sourceUrl)}&w=${HERO_DISPLAY_WIDTH}&q=${HERO_DISPLAY_QUALITY}`;
}

export async function getWelcomeHero(): Promise<WelcomeHero> {
  try {
    const db = await getReadDb();
    const doc = await db.collection('gallery_images').findOne(
      { image_url: HERO_IMAGE_URL },
      { projection: { _id: 0, image_url: 1, book_title: 1, book_year: 1, description: 1 } }
    );
    return {
      imageUrl: heroDisplayUrl(HERO_IMAGE_URL),
      bookTitle: doc?.book_title ? String(doc.book_title).trim() : null,
      bookYear: doc?.book_year ?? null,
      description: doc?.description ?? null,
    };
  } catch {
    return { imageUrl: heroDisplayUrl(HERO_IMAGE_URL) };
  }
}
