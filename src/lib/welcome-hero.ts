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

export async function getWelcomeHero(): Promise<WelcomeHero> {
  try {
    const db = await getReadDb();
    const doc = await db.collection('gallery_images').findOne(
      { image_url: HERO_IMAGE_URL },
      { projection: { _id: 0, image_url: 1, book_title: 1, book_year: 1, description: 1 } }
    );
    return {
      imageUrl: HERO_IMAGE_URL,
      bookTitle: doc?.book_title ? String(doc.book_title).trim() : null,
      bookYear: doc?.book_year ?? null,
      description: doc?.description ?? null,
    };
  } catch {
    return { imageUrl: HERO_IMAGE_URL };
  }
}
