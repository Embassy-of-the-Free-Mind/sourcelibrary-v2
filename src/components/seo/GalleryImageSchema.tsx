import { BASE_URL, imageRightsFields, type ImageRightsSource } from './schema-utils';
import { formatAuthor } from '@/lib/utils';
import { jsonLdHtml } from '@/lib/json-ld';
import { institutionalByline } from '@/lib/corporate-bylines';

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
    image_source?: ImageRightsSource;
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

  const artwork = {
    '@type': ['VisualArtwork', 'ImageObject'],
    '@id': `${pageUrl}#artwork`,
    name: `${desc}, from ${bookTitle}`,
    caption: `${desc}. From ${bookTitle}${book?.author && book.author !== 'Various' ? `, by ${formatAuthor(book.author).name || book.author}` : ''}${book?.published ? ` (${book.published})` : ''}.`,
    ...(museumDescription && { description: museumDescription }),
    ...(imageUrl && { contentUrl: imageUrl }),
    ...(imageUrl && { url: imageUrl }),
    ...(type && artformMap[type] && { artform: artformMap[type] }),
    ...(metadata?.technique && { artMedium: metadata.technique }),
    ...(metadata?.style && { artworkSurface: metadata.style }),
    ...(metadata?.subjects && metadata.subjects.length > 0 && {
      about: metadata.subjects.map(s => ({ '@type': 'Thing', name: s })),
    }),
    /**
     * `creator` on a VisualArtwork means THE ARTIST, and this is a plate
     * extracted from a book, so `book.author` is a weak proxy at best.
     *
     * Fixed here: where the byline names a holding monastery or an issuing
     * society, it is neither the artist nor a person, and claiming it made the
     * image is the #3483 defect on a third surface. Those emit an
     * `Organization` under `provider` — the relation we can actually support —
     * instead of `creator`.
     *
     * STILL OPEN, deliberately not decided here: for a personal author,
     * `creator` claims the book's author drew the plate. Usually untrue —
     * Vesalius wrote the *Fabrica*, van Calcar's workshop cut the blocks — and
     * for most early-modern books the illustrator is simply unknown. Dropping
     * it corpus-wide is a curatorial call with SEO reach, so it is raised
     * rather than taken. `isPartOf` already carries the book relation.
     */
    ...(book?.author && institutionalByline(book.author)
      ? {
          provider: {
            '@type': 'Organization',
            name: formatAuthor(book.author).name || book.author,
          },
        }
      : book?.author
        ? { creator: { '@type': 'Person', name: formatAuthor(book.author).name || book.author } }
        : {}),
    ...(book?.published && { dateCreated: book.published }),
    // The holding library's own statement wins when we have read one (#7771).
    usageInfo: `${BASE_URL}/licensing`,
    ...imageRightsFields(book?.image_source, {
      published: book?.published,
      storedLicense: book?.license,
      licensePage: book ? `${BASE_URL}/book/${book.slug || book.id}` : undefined,
    }),
    isPartOf: {
      '@type': 'Book',
      '@id': book ? `${BASE_URL}/book/${book.slug || book.id}` : undefined,
      ...(book ? { url: `${BASE_URL}/book/${book.slug || book.id}` } : {}),
      name: bookTitle,
      ...(book?.author && book.author !== 'Various'
        ? { author: { '@type': institutionalByline(book.author) ? 'Organization' : 'Person', name: formatAuthor(book.author).name || book.author } }
        : {}),
    },
  };

  const webPage = {
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${desc}, from ${bookTitle}`,
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
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
    />
  );
}
