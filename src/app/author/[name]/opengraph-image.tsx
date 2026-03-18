import { generateBrandedOGImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-image';

export const alt = 'Author - Source Library';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const authorName = decodeURIComponent(name);

  return generateBrandedOGImage({
    title: authorName,
    subtitle: 'Works in the Source Library collection',
  });
}
