import { generateBrandedOGImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-image';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';

export const alt = 'Category - Source Library';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const category = LIBRARY_CATEGORIES.find(c => c.id === id);

  if (!category) {
    return generateBrandedOGImage({ title: 'Category', subtitle: 'Source Library' });
  }

  return generateBrandedOGImage({
    title: category.name,
    subtitle: category.description,
  });
}
