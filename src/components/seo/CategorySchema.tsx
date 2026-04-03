import { BASE_URL } from './schema-utils';
import { formatAuthor } from '@/lib/utils';

interface CategorySchemaProps {
  id: string;
  name: string;
  description?: string;
  bookCount: number;
  books?: Array<{ id: string; slug?: string; title: string; author?: string }>;
}

/**
 * Schema.org JSON-LD for category pages.
 * Emits CollectionPage + ItemList of books + BreadcrumbList.
 */
export default function CategorySchema({
  id,
  name,
  description,
  bookCount,
  books,
}: CategorySchemaProps) {
  const pageUrl = `${BASE_URL}/categories/${id}`;

  const collectionPage: Record<string, unknown> = {
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${name} — Source Library`,
    ...(description && { description }),
    numberOfItems: bookCount,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Source Library',
      url: BASE_URL,
    },
  };

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
        },
      })),
    };
  }

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Categories', item: `${BASE_URL}/categories` },
      { '@type': 'ListItem', position: 3, name, item: pageUrl },
    ],
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
