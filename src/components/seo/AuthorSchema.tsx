import { BASE_URL } from './schema-utils';
import { jsonLdHtml } from '@/lib/json-ld';

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
  /**
   * What the heading actually is (#3483). `Person` is the default and covers
   * every real author. `Organization` is for institutions credited as authors.
   * `none` emits no entity node at all — for work titles, publisher series and
   * cataloguer placeholders, where asserting either type would be false.
   */
  entityType?: 'Person' | 'Organization' | 'none';
}

/**
 * Schema.org JSON-LD for /author/[name] pages.
 * Emits ProfilePage → Person with VIAF/Wikidata/Wikipedia/LCNAF sameAs links,
 * sample works as authorOf, and a BreadcrumbList.
 *
 * For a non-person heading the mainEntity becomes an Organization, or is
 * dropped entirely and the page described as a CollectionPage — a listing of
 * records, which is all it honestly is.
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
  entityType = 'Person',
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

  // Life dates and a portrait are claims about a human being; an Organization
  // gets neither, even when the underlying entity row happens to carry them.
  const isPerson = entityType === 'Person';
  const person: Record<string, unknown> = {
    '@type': isPerson ? 'Person' : 'Organization',
    '@id': `${pageUrl}#person`,
    name: authorName,
    ...(description && { description }),
    ...(aliases && aliases.length > 0 && { alternateName: aliases }),
    ...(isPerson && birthDate && { birthDate }),
    ...(isPerson && deathDate && { deathDate }),
    ...(isPerson && portraitUrl && { image: portraitUrl }),
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

  // ProfilePage asserts the page is about a person or organisation. When it is
  // about neither — a work title, a series, "Anonymous" — it is a CollectionPage
  // with no mainEntity, because there is no entity to point at.
  const profilePage = {
    '@type': entityType === 'none' ? 'CollectionPage' : 'ProfilePage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${authorName} — Source Library`,
    ...(description && { description }),
    ...(entityType !== 'none' && { mainEntity: { '@id': `${pageUrl}#person` } }),
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
    '@graph': entityType === 'none'
      ? [profilePage, breadcrumbList]
      : [profilePage, person, breadcrumbList],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
    />
  );
}
