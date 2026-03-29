import { cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import EntitySchema from '@/components/seo/EntitySchema';

// ISR: rebuild at most every 24 hours (entity data changes rarely)
export const revalidate = 600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface LayoutProps {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}

export interface SharedConnection {
  name: string;
  type: 'person' | 'place' | 'concept';
  sharedBooks: Array<{ book_id: string; book_title: string }>;
}

// Shared books data — which related entities appear in which of the same books
export const getSharedBooks = cache(async (name: string): Promise<SharedConnection[] | null> => {
  try {
    const db = await getDb();
    const entity = await db.collection('entities').findOne(
      { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { sort: { book_count: -1 } }
    );
    if (!entity?.books?.length) return null;

    const centerBooks = entity.books as Array<{ book_id: string; book_title: string }>;
    const centerBookIds = centerBooks.map(b => b.book_id);
    const bookTitleMap = new Map(centerBooks.map(b => [b.book_id, b.book_title]));

    const related = await db.collection('entities')
      .find({
        _id: { $ne: entity._id },
        'books.book_id': { $in: centerBookIds },
      })
      .sort({ book_count: -1 })
      .limit(20)
      .project({ name: 1, type: 1, 'books.book_id': 1 })
      .toArray();

    if (related.length === 0) return null;

    const centerSet = new Set(centerBookIds);
    const connections: SharedConnection[] = related.map(r => {
      const relBookIds = (r.books as Array<{ book_id: string }>).map(b => b.book_id);
      const shared = relBookIds
        .filter(id => centerSet.has(id))
        .map(id => ({ book_id: id, book_title: bookTitleMap.get(id) || 'Unknown' }));
      return {
        name: r.name as string,
        type: r.type as 'person' | 'place' | 'concept',
        sharedBooks: shared,
      };
    });

    // Sort by number of shared books desc, then alphabetically
    connections.sort((a, b) => b.sharedBooks.length - a.sharedBooks.length || a.name.localeCompare(b.name));

    return connections.filter(c => c.sharedBooks.length > 0).slice(0, 15);
  } catch {
    return null;
  }
});

// Shared cached fetch — used by both layout (metadata/schema) and page (rendering)
export const getEntity = cache(async (name: string) => {
  try {
    const db = await getDb();
    const entity = await db.collection('entities').findOne(
      { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { sort: { book_count: -1 } }
    );
    if (!entity) return null;

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
      wikidata_birth_date: entity.wikidata_birth_date as string | undefined,
      wikidata_death_date: entity.wikidata_death_date as string | undefined,
      wikidata_coordinates: entity.wikidata_coordinates as { lat: number; lng: number } | undefined,
      books: (entity.books || []) as Array<{ book_id: string; book_title: string; book_author: string; pages: number[] }>,
      total_mentions: (entity.total_mentions || 0) as number,
      book_count: (entity.book_count || 0) as number,
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
    alternates: {
      canonical: `/encyclopedia/${encodeURIComponent(decodedName)}`,
    },
    openGraph: {
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
