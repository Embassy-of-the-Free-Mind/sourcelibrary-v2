import { BASE_URL } from './schema-utils';

interface EntitySchemaProps {
  name: string;
  type?: string;
  description?: string;
  wikipediaUrl?: string;
  bookCount?: number;
  books?: Array<{ book_id: string; book_title?: string }>;
}

/**
 * Schema.org JSON-LD for encyclopedia entity pages.
 * Maps entity types to Schema.org: person → Person, place → Place, concept → DefinedTerm.
 */
export default function EntitySchema({
  name,
  type,
  description,
  wikipediaUrl,
  books,
}: EntitySchemaProps) {
  const pageUrl = `${BASE_URL}/encyclopedia/${encodeURIComponent(name)}`;

  // Map entity type to Schema.org type
  const schemaTypeMap: Record<string, string> = {
    person: 'Person',
    place: 'Place',
    concept: 'DefinedTerm',
  };
  const schemaType = (type && schemaTypeMap[type]) || 'Thing';

  const entity: Record<string, unknown> = {
    '@type': schemaType,
    '@id': `${pageUrl}#entity`,
    name,
    ...(description && { description }),
    ...(wikipediaUrl && { sameAs: wikipediaUrl }),
    ...(books && books.length > 0 && {
      subjectOf: books.slice(0, 10).map(b => ({
        '@type': 'Book',
        '@id': `${BASE_URL}/book/${b.book_id}`,
        name: b.book_title,
      })),
    }),
  };

  // DefinedTerm-specific: add inDefinedTermSet
  if (schemaType === 'DefinedTerm') {
    entity.inDefinedTermSet = {
      '@type': 'DefinedTermSet',
      name: 'Source Library Encyclopedia',
      url: `${BASE_URL}/encyclopedia`,
    };
  }

  const webPage = {
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${name} — Source Library Encyclopedia`,
    mainEntity: { '@id': `${pageUrl}#entity` },
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Encyclopedia', item: `${BASE_URL}/encyclopedia` },
      { '@type': 'ListItem', position: 3, name, item: pageUrl },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [webPage, entity, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd, null, 0) }}
    />
  );
}
