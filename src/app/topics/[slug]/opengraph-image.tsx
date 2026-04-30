import { generateBrandedOGImage, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-image';
import { FACETS } from '@/lib/taxonomy/faceted-vocabulary';

export const alt = 'Topic - Source Library';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

function parseFacetSlug(slug: string): { facetId: string; valueId: string } | null {
  const parts = slug.split('--');
  if (parts.length !== 2) return null;
  return { facetId: parts[0], valueId: parts[1] };
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const facetParsed = parseFacetSlug(slug);
  if (facetParsed) {
    const facet = FACETS.find((f) => f.id === facetParsed.facetId);
    const value = facet?.values.find((v) => v.id === facetParsed.valueId);

    if (facet && value) {
      return generateBrandedOGImage({
        title: value.label,
        subtitle: value.differentia || `${facet.label} in Source Library`,
      });
    }
  }

  // Fallback for old cluster slugs
  const topicName = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return generateBrandedOGImage({
    title: topicName,
    subtitle: 'Topic in Source Library',
  });
}
