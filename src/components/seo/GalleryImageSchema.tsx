import { BASE_URL, getLicenseUrl } from './schema-utils';

interface GalleryImageSchemaProps {
  imageId: string;
  description: string;
  museumDescription?: string;
  type?: string;
  metadata?: {
    subjects?: string[];
    figures?: string[];
    symbols?: string[];
    style?: string;
    technique?: string;
  };
  imageUrl?: string;
  book?: {
    id: string;
    slug?: string;
    title?: string;
    display_title?: string;
    author?: string;
    published?: string;
    license?: string;
    image_source?: {
      provider?: string;
      license?: string;
      attribution?: string;
    };
  };
}

/**
 * Schema.org JSON-LD for gallery image pages.
 * Uses VisualArtwork + ImageObject dual typing for semantic richness and Google compatibility.
 */
export default function GalleryImageSchema({
  imageId,
  description,
  museumDescription,
  type,
  metadata,
  imageUrl,
  book,
}: GalleryImageSchemaProps) {
  const desc = description || 'Historical illustration';
  const pageUrl = `${BASE_URL}/gallery/image/${imageId}`;
  const bookTitle = book?.display_title || book?.title || 'Unknown';

  // Map detection type to Schema.org artform
  const artformMap: Record<string, string> = {
    woodcut: 'Woodcut',
    engraving: 'Engraving',
    illustration: 'Illustration',
    diagram: 'Diagram',
    emblem: 'Emblem',
    portrait: 'Portrait',
    frontispiece: 'Frontispiece',
    map: 'Map',
    chart: 'Chart',
    symbol: 'Symbol',
    decorative: 'Decorative element',
  };

  // Determine license from book or image source
  const license = book?.image_source?.license || book?.license;

  const artwork = {
    '@type': ['VisualArtwork', 'ImageObject'],
    '@id': `${pageUrl}#artwork`,
    name: desc,
    ...(museumDescription && { description: museumDescription }),
    ...(imageUrl && { contentUrl: imageUrl }),
    ...(imageUrl && { url: imageUrl }),
    ...(type && artformMap[type] && { artform: artformMap[type] }),
    ...(metadata?.technique && { artMedium: metadata.technique }),
    ...(metadata?.style && { artworkSurface: metadata.style }),
    ...(metadata?.subjects && metadata.subjects.length > 0 && {
      about: metadata.subjects.map(s => ({ '@type': 'Thing', name: s })),
    }),
    ...(book?.author && {
      creator: { '@type': 'Person', name: book.author },
    }),
    ...(book?.published && { dateCreated: book.published }),
    ...(license && { license: getLicenseUrl(license) }),
    creditText: book?.image_source?.attribution || `Digitized by ${book?.image_source?.provider || 'Internet Archive'}`,
    copyrightNotice: `Public domain. Original published ${book?.published || 'before 1900'}.`,
    acquireLicensePage: book ? `${BASE_URL}/book/${book.slug || book.id}` : undefined,
    isPartOf: {
      '@type': 'Book',
      '@id': book ? `${BASE_URL}/book/${book.slug || book.id}` : undefined,
      name: bookTitle,
    },
  };

  const webPage = {
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${desc} — ${bookTitle}`,
    mainEntity: { '@id': `${pageUrl}#artwork` },
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Gallery', item: `${BASE_URL}/gallery` },
      { '@type': 'ListItem', position: 3, name: desc.slice(0, 60), item: pageUrl },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [webPage, artwork, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd, null, 0) }}
    />
  );
}
