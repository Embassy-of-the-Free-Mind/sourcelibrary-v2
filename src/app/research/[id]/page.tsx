import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import { SubPageHeader } from '@/components/layout/ContentPageLayout';
import ConversationView from '@/components/research/ConversationView';
import type { CuratorSession, BookRef } from '@/lib/api-client/types/research';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  let session;
  try {
    const db = await getDb();
    session = await db.collection('curator_sessions').findOne(
      { id },
      { projection: { title: 1, themes: 1, date: 1 } }
    );
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  if (!session) return { title: 'Session Not Found' };

  const title = `${session.title} - Research Sessions`;
  return {
    title,
    description: `Curator research session from ${new Date(session.date as string).toLocaleDateString()} exploring ${(session.themes as string[])?.join(', ') || 'various topics'}.`,
  };
}

const TYPE_COLORS: Record<string, string> = {
  acquisition: 'bg-accent-rust/10 text-accent-rust',
  research: 'bg-accent-sage/10 text-accent-sage-dark',
  gap_analysis: 'bg-accent-violet/10 text-accent-violet',
  mixed: 'bg-accent-gold/10 text-accent-gold-dark',
};

const TYPE_LABELS: Record<string, string> = {
  acquisition: 'Acquisition',
  research: 'Research',
  gap_analysis: 'Gap Analysis',
  mixed: 'Mixed',
};

export default async function ResearchSessionPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const doc = await db.collection('curator_sessions').findOne({ id });

  if (!doc) notFound();

  const { _id, ...session } = doc;
  const s = session as unknown as CuratorSession;

  const date = new Date(s.date);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ContentPageLayout maxWidth="standard">
      <SubPageHeader
        title={s.title}
        subtitle={dateStr}
        backHref="/research"
        backLabel="Back to Research Sessions"
      />

      {/* Metadata strip */}
      <div className="flex flex-wrap gap-3 mb-6">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${TYPE_COLORS[s.session_type] || TYPE_COLORS.mixed}`}>
          {TYPE_LABELS[s.session_type] || s.session_type}
        </span>
        {s.themes.map(theme => (
          <span
            key={theme}
            className="px-3 py-1 rounded-full text-sm bg-stone-100 text-stone-600"
          >
            {theme.replace(/_/g, ' ')}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div className="flex gap-6 text-sm text-muted mb-8">
        <span>{s.message_count} messages</span>
        <span>{s.word_count.toLocaleString()} words</span>
        <span>{s.duration_minutes} min</span>
        {s.books_imported.length > 0 && (
          <span>{s.books_imported.length} books imported</span>
        )}
      </div>

      {/* Books section */}
      {s.books_imported.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-primary mb-3">Books Imported</h2>
          <div className="grid gap-2">
            {s.books_imported.map((book: BookRef, i: number) => (
              <BookRefCard key={book.book_id || i} book={book} />
            ))}
          </div>
        </div>
      )}

      {s.books_discussed.length > 0 && s.books_discussed.length !== s.books_imported.length && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-primary mb-3">Books Discussed</h2>
          <div className="grid gap-2">
            {s.books_discussed
              .filter((b: BookRef) => !s.books_imported.some((imp: BookRef) => imp.book_id === b.book_id))
              .map((book: BookRef, i: number) => (
                <BookRefCard key={book.book_id || `d-${i}`} book={book} />
              ))}
          </div>
        </div>
      )}

      {/* Conversation */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-primary mb-4">Conversation</h2>
        <ConversationView
          sessionId={s.id}
          initialMessages={s.messages.slice(0, 50)}
          totalMessages={s.message_count}
        />
      </div>
    </ContentPageLayout>
  );
}

function BookRefCard({ book }: { book: BookRef }) {
  const inner = (
    <div className="flex items-baseline gap-2 px-4 py-2.5 rounded-lg bg-stone-50 border border-border-light hover:border-accent-rust/30 transition-colors">
      <span className="font-medium text-primary text-sm">{book.title}</span>
      {book.author && <span className="text-muted text-sm">{book.author}</span>}
      {book.year && <span className="text-faint text-sm">({book.year})</span>}
    </div>
  );

  if (book.book_id) {
    return (
      <Link href={`/book/${book.book_id}`}>
        {inner}
      </Link>
    );
  }
  return inner;
}
