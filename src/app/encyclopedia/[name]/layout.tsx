import { cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import EntitySchema from '@/components/seo/EntitySchema';

interface LayoutProps {
  params: Promise<{ name: string }>;
  children: React.ReactNode;
}

const getEntity = cache(async (name: string) => {
  try {
    const db = await getDb();
    const entity = await db.collection('entities').findOne({ name }, { sort: { book_count: -1 } });
    return entity;
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
