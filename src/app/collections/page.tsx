import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Collections | Source Library',
  description: 'Browse 5,000+ historical texts organized into thematic collections — Western esotericism, classical philosophy, sacred texts, and more.',
};

const COLOR_MAP: Record<string, { border: string; bg: string; text: string; pill: string }> = {
  rust: {
    border: 'border-l-accent-rust',
    bg: 'bg-accent-rust/6',
    text: 'text-accent-rust',
    pill: 'bg-accent-rust/10 text-accent-rust',
  },
  sage: {
    border: 'border-l-accent-sage-dark',
    bg: 'bg-accent-sage/6',
    text: 'text-accent-sage-dark',
    pill: 'bg-accent-sage/10 text-accent-sage-dark',
  },
  violet: {
    border: 'border-l-accent-violet',
    bg: 'bg-accent-violet/6',
    text: 'text-accent-violet',
    pill: 'bg-accent-violet/10 text-accent-violet',
  },
  gold: {
    border: 'border-l-accent-gold-dark',
    bg: 'bg-accent-gold/6',
    text: 'text-accent-gold-dark',
    pill: 'bg-accent-gold/10 text-accent-gold-dark',
  },
};

interface CollectionDoc {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  order: number;
  book_count: number;
  sample_books: { id: string; title: string; author?: string; year?: number }[];
  languages: { lang: string; count: number }[];
}

async function fetchCollections(): Promise<CollectionDoc[]> {
  const db = await getDb();
  const docs = await db.collection('collections').find({}).sort({ order: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => rest) as unknown as CollectionDoc[];
}

export default async function CollectionsPage() {
  const collections = await fetchCollections();

  const totalBooks = collections.reduce((s, c) => s + c.book_count, 0);

  return (
    <ContentPageLayout>
      <ContentHeader
        title="Collections"
        subtitle={`${totalBooks.toLocaleString()} books organized into ${collections.length} thematic collections spanning three millennia of human knowledge.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((col) => {
          const colors = COLOR_MAP[col.color] || COLOR_MAP.rust;
          const topLangs = (col.languages || []).slice(0, 3).map(l => l.lang).join(', ');

          return (
            <Link
              key={col.slug}
              href={`/collections/${col.slug}`}
              className={`group block rounded-lg border border-border-light ${colors.bg} hover:shadow-md transition-all overflow-hidden`}
            >
              <div className={`border-l-4 ${colors.border} p-5 h-full`}>
                <h2 className="font-serif text-lg font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight">
                  {col.name}
                </h2>
                <p className="text-sm text-muted mt-1 leading-snug">
                  {col.subtitle}
                </p>

                <div className="flex items-center gap-3 mt-3 text-xs text-secondary">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    {col.book_count.toLocaleString()} books
                  </span>
                  {topLangs && (
                    <>
                      <span className="text-muted">|</span>
                      <span>{topLangs}</span>
                    </>
                  )}
                </div>

                {col.sample_books.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border-light">
                    <div className="space-y-1">
                      {col.sample_books.slice(0, 3).map((b) => (
                        <p key={b.id} className="text-xs text-muted truncate">
                          {b.title}{b.year ? ` (${b.year})` : ''}
                        </p>
                      ))}
                      {col.book_count > 3 && (
                        <p className={`text-xs font-medium ${colors.text}`}>
                          + {col.book_count - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </ContentPageLayout>
  );
}
