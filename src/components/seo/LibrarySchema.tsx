import { BASE_URL } from './schema-utils';
import { jsonLdHtml } from '@/lib/json-ld';

interface LibrarySchemaProps {
  slug: string;
  name: string;
  description: string;
  url: string;
  bookCount: number;
}

/**
 * Schema.org JSON-LD for /libraries/[slug] pages — credit pages for digital
 * library partners (Internet Archive, Gallica, BPH, Bodleian, …). Emits a
 * CollectionPage backed by a Library (specific Organization subtype) with the
 * external `url` as the partner's own website, and a BreadcrumbList.
 */
export default function LibrarySchema({
  slug,
  name,
  description,
  url,
  bookCount,
}: LibrarySchemaProps) {
  const pageUrl = `${BASE_URL}/libraries/${slug}`;

  const library = {
    '@type': 'Library',
    '@id': `${pageUrl}#library`,
    name,
    description,
    url,
  };

  const collectionPage = {
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${name} — Source Library`,
    description,
    isPartOf: {
      '@type': 'WebSite',
      '@id': `${BASE_URL}#website`,
      url: BASE_URL,
      name: 'Source Library',
    },
    about: { '@id': `${pageUrl}#library` },
    ...(bookCount > 0 && { numberOfItems: bookCount }),
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Libraries', item: `${BASE_URL}/libraries` },
      { '@type': 'ListItem', position: 3, name, item: pageUrl },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [collectionPage, library, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
    />
  );
}
