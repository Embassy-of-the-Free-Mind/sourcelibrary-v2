import { BASE_URL } from './schema-utils';
import { formatAuthor } from '@/lib/utils';

interface CollectionSchemaProps {
  slug: string;
  name: string;
  description?: string;
  bookCount: number;
  books?: Array<{ id: string; slug?: string; title: string; author?: string; year?: number }>;
  parentCollection?: { slug: string; name: string } | null;
}

/**
 * Schema.org JSON-LD for collection detail pages.
 * Emits CollectionPage + ItemList of books + BreadcrumbList.
 */
export default function CollectionSchema({
  slug,
  name,
  description,
  bookCount,
  books,
  parentCollection,
}: CollectionSchemaProps) {
  const pageUrl = `${BASE_URL}/collections/${slug}`;

  const collectionPage: Record<string, unknown> = {
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${name} — Source Library`,
    ...(description && { description: description.slice(0, 300) }),
    numberOfItems: bookCount,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Source Library',
      url: BASE_URL,
    },
  };

  // ItemList with up to 20 books
  if (books?.length) {
    collectionPage.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: bookCount,
      itemListElement: books.slice(0, 20).map((book, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Book',
          '@id': `${BASE_URL}/book/${book.slug || book.id}`,
          name: book.title,
          ...(book.author && { author: { '@type': 'Person', name: formatAuthor(book.author).name || book.author } }),
          ...(book.year && { datePublished: String(book.year) }),
        },
      })),
    };
  }

  const breadcrumbItems = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
    { '@type': 'ListItem', position: 2, name: 'Collections', item: `${BASE_URL}/collections` },
  ];
  if (parentCollection) {
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: 3,
      name: parentCollection.name,
      item: `${BASE_URL}/collections/${parentCollection.slug}`,
    });
    breadcrumbItems.push({ '@type': 'ListItem', position: 4, name, item: pageUrl });
  } else {
    breadcrumbItems.push({ '@type': 'ListItem', position: 3, name, item: pageUrl });
  }

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [collectionPage, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd, null, 0) }}
    />
  );
}
