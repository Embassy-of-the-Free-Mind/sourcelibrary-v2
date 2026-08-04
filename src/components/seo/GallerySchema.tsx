import { BASE_URL } from './schema-utils';
import { jsonLdHtml } from '@/lib/json-ld';

/**
 * Schema.org JSON-LD for the gallery collection page.
 * Static — no DB query needed.
 */
export default function GallerySchema() {
  const pageUrl = `${BASE_URL}/gallery`;

  const collectionPage = {
    '@type': 'CollectionPage',
    '@id': `${pageUrl}#collection`,
    url: pageUrl,
    name: 'Image Gallery — Source Library',
    description: 'Browse illustrations, diagrams, and engravings extracted from rare Hermetic, alchemical, and philosophical texts. Searchable by subject, type, and period.',
    isPartOf: { '@id': `${BASE_URL}/#website` },
    about: [
      { '@type': 'Thing', name: 'Historical illustrations' },
      { '@type': 'Thing', name: 'Alchemical imagery' },
      { '@type': 'Thing', name: 'Early modern engravings' },
    ],
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Gallery', item: pageUrl },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [collectionPage, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
    />
  );
}
