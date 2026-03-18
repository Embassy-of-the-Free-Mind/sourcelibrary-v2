import { getDb } from '@/lib/mongodb';
import { generateBrandedOGImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-image';

export const alt = 'Collection - Source Library';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const db = await Promise.race([
      getDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    const collection = await db.collection('collections').findOne(
      { slug: id },
      { projection: { name: 1, description: 1, book_count: 1 } }
    );

    if (!collection) {
      return generateBrandedOGImage({ title: 'Collection', subtitle: 'Source Library' });
    }

    const desc = collection.description
      ? String(collection.description).slice(0, 120)
      : undefined;
    const detail = collection.book_count
      ? `${collection.book_count} books`
      : undefined;

    return generateBrandedOGImage({
      title: String(collection.name),
      subtitle: desc,
      detail,
    });
  } catch {
    return generateBrandedOGImage({ title: 'Collection', subtitle: 'Source Library' });
  }
}
