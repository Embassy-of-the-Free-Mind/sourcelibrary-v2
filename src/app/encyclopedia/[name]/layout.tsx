import { cache } from 'react';
import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import EntitySchema from '@/components/seo/EntitySchema';
import {
  dedupeEntityBooks,
  entityCounters,
  normalizeEntityBook,
  type EntityBookRef,
} from '@/lib/entity-books';
import { isPublishedEntity } from '@/lib/entity-publish';

// ISR: 24h background revalidation
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface LayoutProps {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}

/**
 * The "Connections" panel that used to live here is REMOVED (2026-08-21).
 *
 * `getSharedBooks` ranked co-occurring entities by their GLOBAL `book_count`
 * and took the top 20 before ever looking at how much they overlap with the
 * subject. Any entity in more than a handful of books therefore co-occurs with
 * the corpus's most frequent entities, so the panel rendered the SAME twenty
 * names — Rome, Egypt, Aristotle, Plato, Italy, Moses, Jerusalem … — on every
 * page, whether the subject appeared in 14 books or 825. Measured 2026-08-21:
 * "Active Intellect", "Philosopher's Stone", "Kabbalah", "Rosicrucian" and
 * "Mercury" all returned an identical list. It read as a semantic relation and
 * carried zero information.
 *
 * If this comes back, rank by ASSOCIATION (PMI / lift — shared books over what
 * chance would predict from each entity's own book_count), not by raw
 * frequency, and compute the overlap BEFORE the limit. See issue in the PR.
 */

export interface AuthoredWork {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  published?: string;
  language?: string;
  pages_count?: number;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  image_display?: string | null;
  image_thumb?: string | null;
}

/**
 * Books this person WROTE that the library holds — distinct from the books that
 * merely mention them, which is what the rest of this page is about.
 *
 * The page previously showed "Appears in 117 Books" for Matthiolus and none of
 * the 4 editions of his own Dioscorides commentary that we hold, with no link to
 * his author page. A reader arriving on a famous author's entry expects his
 * works first (#3361).
 *
 * Resolution is by FOREIGN KEY only — `books.author_id` → `authors._id` (the
 * canonical thesaurus, see CLAUDE.md) and the transitional
 * `books.author_entity_id`. Deliberately NOT by name or alias: books store
 * "Pietro Andrea Mattioli" while the entity is named "Matthiolus", so a name
 * match returns nothing here, and matching the alias list would attach wrong
 * books to an author — the same false-claim shape as a fabricated page cite,
 * since `entity_aliases` carries generic epithets.
 */
export const getAuthoredWorks = cache(async (
  entityId: string,
  wikidataId?: string,
  entityName?: string
): Promise<{ works: AuthoredWork[]; total: number; authorSlug: string | null }> => {
  try {
    const db = await getReadDb();

    const orClauses: Record<string, unknown>[] = [{ author_entity_id: entityId }];

    // Canonical authors layer: match on a shared authority id, never on a name.
    // `authors._id` is the canonical author SLUG (a string), not an ObjectId.
    const authorDoc = await db.collection<{ _id: string; wikidata_id?: string }>('authors').findOne(
      {
        $or: [
          ...(wikidataId ? [{ wikidata_id: wikidataId }] : []),
          ...(entityName ? [{ _id: entityName.toLowerCase().replace(/\s+/g, '-') }] : []),
        ],
      },
      { projection: { _id: 1 } }
    );
    // `authors._id` IS the canonical author slug, so it's the safe link target —
    // deriving one from the entity name can point at a 404 (books here are filed
    // under "Pietro Andrea Mattioli", the entity is "Matthiolus").
    const authorSlug: string | null = typeof authorDoc?._id === 'string' ? authorDoc._id : null;
    if (authorDoc?._id) orClauses.push({ author_id: authorDoc._id });

    // Canonical "live" filter — same as every public surface.
    const query = { $or: orClauses, visible: true, pages_count: { $gt: 0 } };

    // Count separately from the capped fetch: the heading must state the real
    // holding, not the size of the page's grid. Aristotle has more than the 24
    // we render, and "24 works in the library" would be a made-up total.
    const total = await db.collection('books').countDocuments(query);

    const works = await db.collection('books')
      .find(
        query,
        {
          projection: {
            id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
            published: 1, language: 1, pages_count: 1,
            thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
          },
        }
      )
      .sort({ year: 1 })
      .limit(24)
      .toArray();

    // One book can match on both keys; dedupe on the public id.
    const seen = new Set<string>();
    const unique: AuthoredWork[] = [];
    for (const w of works) {
      const id = w.id as string;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(w as unknown as AuthoredWork);
    }
    return { works: unique, total, authorSlug };
  } catch {
    return { works: [], total: 0, authorSlug: null };
  }
});

// Shared cached fetch — used by both layout (metadata/schema) and page (rendering)
export const getEntity = cache(async (name: string) => {
  try {
    const db = await getReadDb();
    // Try exact match first (uses index, 2ms), then the aliases array (the timeline
    // links figures by their canonical Wikidata name, e.g. "Apuleius", while the
    // entity is stored under a surface name, e.g. "Apuleius of Madaura" — both share
    // the same aliases[]), then case-insensitive regex on name (20s full scan) as a
    // last resort. Without the aliases fallback ~0.4% of timeline figures 404.
    const entity = await db.collection('entities').findOne(
      { name },
      { sort: { book_count: -1 } }
    ) ?? await db.collection('entities').findOne(
      { aliases: name },
      { sort: { book_count: -1 } }
    ) ?? await db.collection('entities').findOne(
      { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { sort: { book_count: -1 } }
    );
    if (!entity) return null;

    // Life dates are a static read. Wikidata enrichment happens OFFLINE
    // (cron + link hook, see src/lib/wikidata-enrichment.ts) — never on render.
    const birthDate = entity.wikidata_birth_date as string | undefined;
    const deathDate = entity.wikidata_death_date as string | undefined;

    const books = dedupeEntityBooks(
      ((entity.books || []) as EntityBookRef[]).map(normalizeEntityBook)
    );

    // Fetch related entities (same books)
    const bookIds = entity.books?.map((b: { book_id: string }) => b.book_id) || [];
    const related = bookIds.length > 0
      ? await db.collection('entities')
          .find({
            _id: { $ne: entity._id },
            'books.book_id': { $in: bookIds }
          })
          .sort({ book_count: -1 })
          .limit(10)
          .project({ name: 1, type: 1, book_count: 1 })
          .toArray()
      : [];

    return {
      _id: (entity._id as ObjectId).toString(),
      name: entity.name as string,
      type: entity.type as 'person' | 'place' | 'concept',
      aliases: (entity.aliases || []) as string[],
      description: entity.description as string | undefined,
      wikipedia_url: entity.wikipedia_url as string | undefined,
      wikidata_id: entity.wikidata_id as string | undefined,
      wikidata_birth_date: birthDate,
      wikidata_death_date: deathDate,
      wikidata_coordinates: entity.wikidata_coordinates as { lat: number; lng: number } | undefined,
      // Dedupe + normalize on read. Legacy rows have duplicate entries per book
      // and an unverified `pages` array (the old smeared batch range), so both
      // the list and the counters are derived here rather than trusted from the
      // stored fields — otherwise the hero count contradicts the body heading
      // and the page renders fabricated `p. N` citations (#3361).
      books,
      ...entityCounters(books),
      related: related.map(r => ({
        _id: (r._id as ObjectId).toString(),
        name: r.name as string,
        type: r.type as 'person' | 'place' | 'concept',
        book_count: (r.book_count || 0) as number,
      })),
    };
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  let entity;
  try {
    entity = await getEntity(decodedName);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  const typeLabels: Record<string, string> = {
    person: 'Person',
    place: 'Place',
    concept: 'Concept',
  };

  const title = entity
    ? `${decodedName} (${typeLabels[entity.type] || 'Entity'}) - Source Library Encyclopedia`
    : `${decodedName} - Source Library Encyclopedia`;

  const description = entity?.description
    ? entity.description.slice(0, 160)
    : entity
    ? `${decodedName} appears in ${entity.book_count || 0} books in the Source Library collection. Explore references and connections across historical texts.`
    : `Learn about ${decodedName} in the Source Library Encyclopedia.`;

  return {
    title,
    description,
    // Published tier only (#4321): below-the-line entities keep rendering as
    // internal utility pages but are not offered for indexing. Uses the
    // deduped book_count from getEntity, not the stored field. robots.txt
    // currently disallows /encyclopedia/ wholesale; this metadata is what
    // makes narrowing that disallow safe later.
    ...(entity && !isPublishedEntity(entity)
      ? { robots: { index: false, follow: true } }
      : {}),
    alternates: {
      canonical: `/encyclopedia/${encodeURIComponent(decodedName)}`,
    },
    openGraph: {
      images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
      title: decodedName,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: `/encyclopedia/${encodeURIComponent(decodedName)}`,
    },
    twitter: {
      card: 'summary',
      title: decodedName,
      description,
    },
  };
}

export default async function EntityLayout({ params, children }: LayoutProps) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const entity = await getEntity(decodedName);

  return (
    <>
      {entity && (
        <EntitySchema
          name={decodedName}
          type={entity.type}
          description={entity.description}
          wikipediaUrl={entity.wikipedia_url}
          wikidataId={entity.wikidata_id}
          aliases={entity.aliases}
          birthDate={entity.wikidata_birth_date}
          deathDate={entity.wikidata_death_date}
          coordinates={entity.wikidata_coordinates}
          bookCount={entity.book_count}
          books={entity.books}
        />
      )}
      {children}
    </>
  );
}
