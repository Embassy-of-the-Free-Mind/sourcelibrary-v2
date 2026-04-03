import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { authorSlug } from '@/lib/slugify';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notFound } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ISR: rebuild daily. Allow 60s for first-hit generation.
export const revalidate = 600;
export const maxDuration = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return []; // Generate on first request, not at build time
}

interface PageProps {
  params: Promise<{ letter: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { letter } = await params;
  const l = letter.toUpperCase();
  return {
    title: `Authors starting with ${l} - Source Library`,
    description: `Browse all authors in Source Library whose names begin with the letter ${l}.`,
    alternates: { canonical: `/browse/authors/${l}` },
  };
}

interface AuthorEntry {
  _id: string;
  count: number;
}

export default async function BrowseAuthorsPage({ params }: PageProps) {
  const { letter } = await params;
  const l = letter.toUpperCase();
  if (l.length !== 1 || !/[A-Z]/.test(l)) notFound();

  let authors: AuthorEntry[] = [];
  try {
    const db = await getDb();

    // Get all visible books with translations, starting with this letter
    const books = await db.collection('books').find(
      {
        visible: true,
        author: { $regex: `^${l}`, $options: 'i' },
        pages_translated: { $gt: 0 },
      },
      { projection: { author: 1, author_entity_id: 1 } }
    ).toArray();

    // Group by entity when available, fall back to raw author string
    const entityIds = [...new Set(books.map(b => b.author_entity_id).filter(Boolean))];
    const entityMap = new Map<string, string>(); // entityId → canonical name
    if (entityIds.length > 0) {
      const entities = await db.collection('entities').find(
        { _id: { $in: entityIds.map(id => { try { return new ObjectId(id); } catch { return null; } }).filter((v): v is ObjectId => v !== null) } },
        { projection: { canonical_name: 1, name: 1 } }
      ).toArray();
      for (const e of entities) {
        entityMap.set(e._id.toString(), e.canonical_name || e.name);
      }
    }

    // Deduplicate: entity-linked books use canonical name, others use raw author
    const authorCounts = new Map<string, number>();
    for (const b of books) {
      const name = (b.author_entity_id && entityMap.get(b.author_entity_id)) || b.author;
      if (name) authorCounts.set(name, (authorCounts.get(name) || 0) + 1);
    }

    // Filter to names starting with the letter (canonical names may differ)
    authors = [...authorCounts.entries()]
      .filter(([name]) => name.toUpperCase().startsWith(l))
      .map(([name, count]) => ({ _id: name, count }))
      .sort((a, b) => a._id.localeCompare(b._id));
  } catch {
    // DB error — render empty page
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: '/browse' }]} />
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
      <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
        Authors: {l}
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        {authors.length.toLocaleString('en-US')} {authors.length === 1 ? 'author' : 'authors'}
      </p>

      {/* Letter nav */}
      <div className="flex flex-wrap gap-1.5 mb-10">
        {LETTERS.map(lt => (
          <Link
            key={lt}
            href={`/browse/authors/${lt}`}
            className={`w-8 h-8 flex items-center justify-center rounded text-xs font-medium transition-colors ${
              lt === l ? 'text-white' : 'hover:opacity-70'
            }`}
            style={lt === l
              ? { background: 'var(--text-primary)', color: '#fff' }
              : { color: 'var(--text-muted)' }
            }
          >
            {lt}
          </Link>
        ))}
      </div>

      {/* Author list */}
      <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
        {authors.map(author => (
          <Link
            key={author._id}
            href={`/author/${authorSlug(author._id)}`}
            className="flex items-baseline justify-between py-3 hover:opacity-70 transition-opacity"
          >
            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {author._id}
            </p>
            <p className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {author.count} {author.count === 1 ? 'book' : 'books'}
            </p>
          </Link>
        ))}
      </div>

      {authors.length === 0 && (
        <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
          No authors found starting with {l}.
        </p>
      )}
    </div>
    </>
  );
}
