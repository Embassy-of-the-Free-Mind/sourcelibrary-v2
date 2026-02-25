/**
 * JSON-LD builder utilities for linked data / knowledge graph.
 *
 * Builds Schema.org JSON-LD documents for entities, used by:
 * - API routes (?format=jsonld)
 * - EntitySchema component (embedded in HTML)
 */

const BASE_URL = 'https://sourcelibrary.org';

interface EntityForJsonLd {
  name: string;
  type: 'person' | 'place' | 'concept';
  aliases?: string[];
  description?: string;
  wikipedia_url?: string;
  wikidata_id?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
  wikidata_coordinates?: { lat: number; lng: number };
  books?: Array<{ book_id: string; book_title?: string; book_author?: string }>;
}

/**
 * Build sameAs array from Wikipedia URL and Wikidata ID.
 * Derives DBpedia URL from Wikipedia URL when available.
 */
export function buildSameAsArray(entity: { wikipedia_url?: string; wikidata_id?: string }): string[] {
  const urls: string[] = [];

  if (entity.wikipedia_url) {
    urls.push(entity.wikipedia_url);
    // Derive DBpedia URL from Wikipedia URL
    const match = entity.wikipedia_url.match(/\/wiki\/(.+?)(?:#.*)?$/);
    if (match) {
      urls.push(`https://dbpedia.org/resource/${match[1]}`);
    }
  }

  if (entity.wikidata_id) {
    urls.push(`https://www.wikidata.org/wiki/${entity.wikidata_id}`);
  }

  return urls;
}

const SCHEMA_TYPE_MAP: Record<string, string> = {
  person: 'Person',
  place: 'Place',
  concept: 'DefinedTerm',
};

/**
 * Build a Schema.org JSON-LD object for a single entity.
 * When standalone=true (default), includes @context. Set false for @graph arrays.
 */
export function buildEntityJsonLd(entity: EntityForJsonLd, { standalone = true } = {}): Record<string, unknown> {
  const pageUrl = `${BASE_URL}/encyclopedia/${encodeURIComponent(entity.name)}`;
  const schemaType = SCHEMA_TYPE_MAP[entity.type] || 'Thing';

  const doc: Record<string, unknown> = {
    ...(standalone && { '@context': 'https://schema.org' }),
    '@type': schemaType,
    '@id': `${pageUrl}#entity`,
    name: entity.name,
  };

  if (entity.aliases?.length) {
    doc.alternateName = entity.aliases;
  }

  if (entity.description) {
    doc.description = entity.description;
  }

  // sameAs: Wikipedia, Wikidata, DBpedia
  const sameAs = buildSameAsArray(entity);
  if (sameAs.length > 0) {
    doc.sameAs = sameAs;
  }

  // Wikidata identifier
  if (entity.wikidata_id) {
    doc.identifier = {
      '@type': 'PropertyValue',
      propertyID: 'wikidata',
      value: entity.wikidata_id,
    };
  }

  // Person-specific: birth/death dates
  if (schemaType === 'Person') {
    if (entity.wikidata_birth_date) {
      doc.birthDate = entity.wikidata_birth_date;
    }
    if (entity.wikidata_death_date) {
      doc.deathDate = entity.wikidata_death_date;
    }
  }

  // Place-specific: coordinates
  if (schemaType === 'Place' && entity.wikidata_coordinates) {
    doc.geo = {
      '@type': 'GeoCoordinates',
      latitude: entity.wikidata_coordinates.lat,
      longitude: entity.wikidata_coordinates.lng,
    };
  }

  // DefinedTerm-specific
  if (schemaType === 'DefinedTerm') {
    doc.inDefinedTermSet = {
      '@type': 'DefinedTermSet',
      name: 'Source Library Encyclopedia',
      url: `${BASE_URL}/encyclopedia`,
    };
  }

  // subjectOf: books this entity appears in
  if (entity.books?.length) {
    doc.subjectOf = entity.books.slice(0, 20).map(b => ({
      '@type': 'Book',
      '@id': `${BASE_URL}/book/${b.book_id}`,
      name: b.book_title,
    }));
  }

  return doc;
}

/**
 * Build a JSON-LD @graph document for a list of entities.
 */
export function buildEntityListJsonLd(entities: EntityForJsonLd[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': entities.map(e => buildEntityJsonLd(e, { standalone: false })),
  };
}
