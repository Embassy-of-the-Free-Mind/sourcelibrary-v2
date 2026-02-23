import { cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import EntitySchema from '@/components/seo/EntitySchema';

interface LayoutProps {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}

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
          bookCount={entity.book_count}
          books={entity.books}
        />
      )}
      {children}
    </>
  );
}
