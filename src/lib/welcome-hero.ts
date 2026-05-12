import { getReadDb } from '@/lib/mongodb';

export type WelcomeHero = {
  imageUrl: string;
  bookTitle?: string | null;
  bookYear?: number | null;
  description?: string | null;
};

const FALLBACK: WelcomeHero = {
  imageUrl: 'https://images.sourcelibrary.org/archived/69b525942379d2fed6c291f6/45.jpg',
  bookTitle: 'Toonneel des aerdrycks',
  bookYear: 1635,
  description: 'A celestial map from the collection.',
};

// Curated pool of beautiful landscape illustrations. Server-fetched, rotated per render.
// Filters: top-quality, large landscape orientation, well-ranked books.
export async function getWelcomeHero(): Promise<WelcomeHero> {
  try {
    const db = await getReadDb();
    const candidates = await db.collection('gallery_images').aggregate([
      {
        $match: {
          gallery_quality: { $gte: 0.9 },
          book_rank: { $lte: 1 },
          extracted_width: { $gte: 1400 },
          extracted_height: { $gte: 800 },
          $expr: { $gt: ['$extracted_width', { $multiply: ['$extracted_height', 1.05] }] },
        },
      },
      { $sample: { size: 1 } },
      { $project: { _id: 0, image_url: 1, book_title: 1, book_year: 1, description: 1 } },
    ]).toArray();
    const pick = candidates[0];
    if (!pick?.image_url) return FALLBACK;
    return {
      imageUrl: pick.image_url,
      bookTitle: pick.book_title ? String(pick.book_title).trim() : null,
      bookYear: pick.book_year ?? null,
      description: pick.description ?? null,
    };
  } catch {
    return FALLBACK;
  }
}
