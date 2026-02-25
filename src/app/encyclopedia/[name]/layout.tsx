import { cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import EntitySchema from '@/components/seo/EntitySchema';

interface LayoutProps {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}

export interface GraphNode {
  id: string;
  name: string;
  type: 'person' | 'place' | 'concept';
  bookCount: number;
  isCenter: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

// Graph data for the entity relationship visualization
export const getEntityGraph = cache(async (name: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | null> => {
  try {
    const db = await getDb();
    const entity = await db.collection('entities').findOne(
      { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { sort: { book_count: -1 } }
    );
    if (!entity?.books?.length) return null;

    const centerBookIds = entity.books.map((b: { book_id: string }) => b.book_id);
    const related = await db.collection('entities')
      .find({
        _id: { $ne: entity._id },
        'books.book_id': { $in: centerBookIds },
      })
      .sort({ book_count: -1 })
      .limit(15)
      .project({ name: 1, type: 1, book_count: 1, 'books.book_id': 1 })
      .toArray();

    if (related.length < 3) return null;

    const nodes: GraphNode[] = [
      { id: entity.name, name: entity.name, type: entity.type, bookCount: entity.book_count || 0, isCenter: true },
      ...related.map(r => ({
        id: r.name as string,
        name: r.name as string,
        type: r.type as 'person' | 'place' | 'concept',
        bookCount: (r.book_count || 0) as number,
        isCenter: false,
      })),
    ];

    // Build book sets for edge computation
    const bookSets = new Map<string, Set<string>>();
    bookSets.set(entity.name as string, new Set(centerBookIds));
    for (const r of related) {
      bookSets.set(r.name as string, new Set((r.books as Array<{ book_id: string }>).map(b => b.book_id)));
    }

    // Compute edges (shared books between all pairs)
    const edges: GraphEdge[] = [];
    const names = [entity.name as string, ...related.map(r => r.name as string)];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const setA = bookSets.get(names[i])!;
        const setB = bookSets.get(names[j])!;
        let shared = 0;
        for (const id of setA) {
          if (setB.has(id)) shared++;
        }
        if (shared > 0) {
          edges.push({ source: names[i], target: names[j], weight: shared });
        }
      }
    }

    return { nodes, edges };
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
  const entity = await getEntity(decodedName);

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
