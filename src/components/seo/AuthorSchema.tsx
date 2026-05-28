import { BASE_URL } from './schema-utils';

interface AuthorSchemaProps {
  authorName: string;
  authorSlug: string;
  description?: string;
  aliases?: string[];
  birthDate?: string;
  deathDate?: string;
  wikipediaUrl?: string | null;
  wikidataId?: string;
  viafId?: string;
  lcnafId?: string;
  gndId?: string;
  portraitUrl?: string | null;
  workCount: number;
  sampleWorks?: Array<{ id: string; slug?: string; title: string; published?: string }>;
}

/**
 * Schema.org JSON-LD for /author/[name] pages.
 * Emits ProfilePage → Person with VIAF/Wikidata/Wikipedia/LCNAF sameAs links,
 * sample works as authorOf, and a BreadcrumbList.
 */
export default function AuthorSchema({
  authorName,
  authorSlug,
  description,
  aliases,
  birthDate,
  deathDate,
  wikipediaUrl,
  wikidataId,
  viafId,
  lcnafId,
  gndId,
  portraitUrl,
  workCount,
  sampleWorks,
}: AuthorSchemaProps) {
  const pageUrl = `${BASE_URL}/author/${authorSlug}`;

  const sameAs: string[] = [];
  if (wikipediaUrl) sameAs.push(wikipediaUrl);
  if (wikidataId) sameAs.push(`https://www.wikidata.org/wiki/${wikidataId}`);
  if (viafId) sameAs.push(`https://viaf.org/viaf/${viafId}`);
  if (lcnafId) sameAs.push(`https://id.loc.gov/authorities/names/${lcnafId}`);
  if (gndId) sameAs.push(`https://d-nb.info/gnd/${gndId}`);

  const identifiers: Array<Record<string, string>> = [];
  if (wikidataId) identifiers.push({ '@type': 'PropertyValue', propertyID: 'wikidata', value: wikidataId });
  if (viafId) identifiers.push({ '@type': 'PropertyValue', propertyID: 'viaf', value: viafId });
  if (lcnafId) identifiers.push({ '@type': 'PropertyValue', propertyID: 'lcnaf', value: lcnafId });
  if (gndId) identifiers.push({ '@type': 'PropertyValue', propertyID: 'gnd', value: gndId });

  const person: Record<string, unknown> = {
    '@type': 'Person',
    '@id': `${pageUrl}#person`,
    name: authorName,
    ...(description && { description }),
    ...(aliases && aliases.length > 0 && { alternateName: aliases }),
    ...(birthDate && { birthDate }),
    ...(deathDate && { deathDate }),
    ...(portraitUrl && { image: portraitUrl }),
    ...(sameAs.length > 0 && { sameAs }),
    ...(identifiers.length > 0 && { identifier: identifiers }),
  };

  if (sampleWorks && sampleWorks.length > 0) {
    person.subjectOf = sampleWorks.slice(0, 10).map(w => ({
      '@type': 'Book',
      '@id': `${BASE_URL}/book/${w.slug || w.id}`,
      name: w.title,
      ...(w.published && { datePublished: w.published }),
    }));
  }

  const profilePage = {
    '@type': 'ProfilePage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${authorName} — Source Library`,
    ...(description && { description }),
    mainEntity: { '@id': `${pageUrl}#person` },
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: authorName, item: pageUrl },
    ],
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [profilePage, person, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd, null, 0) }}
    />
  );
}
