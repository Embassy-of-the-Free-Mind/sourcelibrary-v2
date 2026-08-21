import { BASE_URL } from './schema-utils';
import { buildSameAsArray } from '@/lib/jsonld';
import { jsonLdHtml } from '@/lib/json-ld';

interface EntitySchemaProps {
  name: string;
  type?: string;
  description?: string;
  wikipediaUrl?: string;
  wikidataId?: string;
  aliases?: string[];
  birthDate?: string;
  deathDate?: string;
  coordinates?: { lat: number; lng: number };
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
  wikidataId,
  aliases,
  birthDate,
  deathDate,
  coordinates,
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
  };

  // Aliases
  if (aliases?.length) {
    entity.alternateName = aliases;
  }

  // sameAs: Wikipedia + Wikidata + DBpedia
  const sameAs = buildSameAsArray({ wikipedia_url: wikipediaUrl, wikidata_id: wikidataId });
  if (sameAs.length > 0) {
    entity.sameAs = sameAs;
  }

  // Wikidata identifier
  if (wikidataId) {
    entity.identifier = {
      '@type': 'PropertyValue',
      propertyID: 'wikidata',
      value: wikidataId,
    };
  }

  // Person-specific: birth/death dates
  if (schemaType === 'Person') {
    if (birthDate) entity.birthDate = birthDate;
    if (deathDate) entity.deathDate = deathDate;
  }

  // Place-specific: coordinates
  if (schemaType === 'Place' && coordinates) {
    entity.geo = {
      '@type': 'GeoCoordinates',
      latitude: coordinates.lat,
      longitude: coordinates.lng,
    };
  }

  // DefinedTerm-specific: add inDefinedTermSet
  if (schemaType === 'DefinedTerm') {
    entity.inDefinedTermSet = {
      '@type': 'DefinedTermSet',
      name: 'Source Library Encyclopedia',
      url: `${BASE_URL}/encyclopedia`,
    };
  }

  // Books this entity appears in
  if (books?.length) {
    entity.subjectOf = books.slice(0, 10).map(b => ({
      '@type': 'Book',
      '@id': `${BASE_URL}/book/${b.book_id}`,
      name: b.book_title,
    }));
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
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
    />
  );
}
