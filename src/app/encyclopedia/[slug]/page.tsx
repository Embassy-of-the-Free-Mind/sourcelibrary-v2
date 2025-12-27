import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import {
  ArrowLeft,
  BookOpen,
  Users,
  MapPin,
  FileText,
  Lightbulb,
  ExternalLink,
  Edit,
  Eye,
  Link2,
  Calendar,
} from 'lucide-react';
import { EncyclopediaEntry, EncyclopediaEntryType } from '@/lib/types';

interface PageProps {
  params: Promise<{ slug: string }>;
}

const TYPE_ICONS: Record<EncyclopediaEntryType, React.ReactNode> = {
  term: <BookOpen className="w-5 h-5" />,
  person: <Users className="w-5 h-5" />,
  place: <MapPin className="w-5 h-5" />,
  work: <FileText className="w-5 h-5" />,
  concept: <Lightbulb className="w-5 h-5" />,
};

const TYPE_COLORS: Record<EncyclopediaEntryType, string> = {
  term: 'bg-blue-100 text-blue-700',
  person: 'bg-purple-100 text-purple-700',
  place: 'bg-green-100 text-green-700',
  work: 'bg-amber-100 text-amber-700',
  concept: 'bg-pink-100 text-pink-700',
};

async function getEntry(slug: string): Promise<EncyclopediaEntry | null> {
  const db = await getDb();
  const entry = await db.collection('encyclopedia').findOne({ slug });

  if (!entry) return null;

  // Increment view count
  await db.collection('encyclopedia').updateOne(
    { slug },
    { $inc: { view_count: 1 } }
  );

  return entry as unknown as EncyclopediaEntry;
}

async function getRelatedEntries(entry: EncyclopediaEntry) {
  if (!entry.related_entries?.length) return [];

  const db = await getDb();
  const entries = await db.collection('encyclopedia')
    .find({ id: { $in: entry.related_entries } })
    .project({ id: 1, slug: 1, title: 1, type: 1, summary: 1 })
    .toArray();

  return entries as unknown as EncyclopediaEntry[];
}

async function getSourceBooks(entry: EncyclopediaEntry) {
  const bookIds = entry.primary_sources?.map((s) => s.book_id) || [];
  if (!bookIds.length) return [];

  const db = await getDb();
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } })
    .project({ id: 1, title: 1, display_title: 1, author: 1, thumbnail: 1 })
    .toArray();

  return books;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getEntry(slug);

  if (!entry) {
    return { title: 'Entry Not Found - Encyclopedia' };
  }

  return {
    title: `${entry.title} - Encyclopedia - Source Library`,
    description: entry.summary,
  };
}

function EntrySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-64 bg-stone-200 rounded mb-4" />
      <div className="h-4 w-full bg-stone-200 rounded mb-2" />
      <div className="h-4 w-3/4 bg-stone-200 rounded mb-8" />
      <div className="h-64 bg-stone-200 rounded" />
    </div>
  );
}

async function EntryContent({ slug }: { slug: string }) {
  const entry = await getEntry(slug);

  if (!entry) {
    notFound();
  }

  const [relatedEntries, sourceBooks] = await Promise.all([
    getRelatedEntries(entry),
    getSourceBooks(entry),
  ]);

  const formatDate = (date: Date | string | undefined) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      {/* Main content */}
      <div className="lg:col-span-2">
        {/* Header */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm ${TYPE_COLORS[entry.type]}`}>
                  {TYPE_ICONS[entry.type]}
                  <span className="capitalize">{entry.type}</span>
                </span>
                {entry.aliases?.length > 0 && (
                  <span className="text-sm text-stone-500">
                    Also: {entry.aliases.join(', ')}
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-bold text-stone-900">{entry.title}</h1>
            </div>
          </div>

          <p className="text-lg text-stone-600 leading-relaxed">{entry.summary}</p>

          {/* Categories */}
          {entry.categories?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {entry.categories.map((cat) => (
                <Link
                  key={cat}
                  href={`/encyclopedia?category=${encodeURIComponent(cat)}`}
                  className="px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-full text-sm transition-colors"
                >
                  {cat}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Full content */}
        {entry.content && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">Full Article</h2>
            <div className="prose prose-stone max-w-none">
              {entry.content.split('\n\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>
        )}

        {/* Primary sources */}
        {entry.primary_sources && entry.primary_sources.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">
              Appears In ({entry.primary_sources.length} {entry.primary_sources.length === 1 ? 'source' : 'sources'})
            </h2>
            <div className="space-y-4">
              {entry.primary_sources.map((source, i) => {
                const book = sourceBooks.find((b) => b.id === source.book_id);
                if (!book) return null;

                return (
                  <div key={i} className="flex gap-4 p-4 bg-stone-50 rounded-lg">
                    {book.thumbnail && (
                      <img
                        src={book.thumbnail}
                        alt={book.display_title || book.title}
                        className="w-16 h-20 object-cover rounded shadow-sm"
                      />
                    )}
                    <div className="flex-1">
                      <Link
                        href={`/book/${source.book_id}`}
                        className="font-medium text-stone-900 hover:text-amber-700"
                      >
                        {book.display_title || book.title}
                      </Link>
                      <p className="text-sm text-stone-500">{book.author}</p>
                      {source.page_numbers?.length > 0 && (
                        <p className="text-sm text-stone-600 mt-1">
                          Pages: {source.page_numbers.sort((a, b) => a - b).join(', ')}
                        </p>
                      )}
                      {source.quote && (
                        <blockquote className="mt-2 text-sm text-stone-600 italic border-l-2 border-amber-400 pl-3">
                          &ldquo;{source.quote}&rdquo;
                        </blockquote>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* External references */}
        {entry.external_references && entry.external_references.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">External References</h2>
            <ul className="space-y-2">
              {entry.external_references.map((ref, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ExternalLink className="w-4 h-4 text-stone-400 mt-1 flex-shrink-0" />
                  <div>
                    {ref.url ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-700 hover:text-amber-800"
                      >
                        {ref.title}
                      </a>
                    ) : (
                      <span className="text-stone-900">{ref.title}</span>
                    )}
                    {ref.citation && (
                      <p className="text-sm text-stone-500">{ref.citation}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Stats */}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
            <Eye className="w-4 h-4" />
            {entry.view_count || 0} views
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
            <Link2 className="w-4 h-4" />
            {entry.annotation_count || 0} linked annotations
          </div>
          {entry.created_at && (
            <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
              <Calendar className="w-4 h-4" />
              Created {formatDate(entry.created_at)}
            </div>
          )}
          {entry.created_by_name && (
            <div className="text-sm text-stone-600">
              By: <span className="font-medium">{entry.created_by_name}</span>
            </div>
          )}
        </div>

        {/* Related entries */}
        {relatedEntries.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <h3 className="font-medium text-stone-900 mb-3">Related Entries</h3>
            <div className="space-y-2">
              {relatedEntries.map((related) => (
                <Link
                  key={related.id}
                  href={`/encyclopedia/${related.slug}`}
                  className="block p-2 hover:bg-stone-50 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-stone-400">{TYPE_ICONS[related.type]}</span>
                    <span className="text-sm font-medium text-stone-900">{related.title}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Contributors */}
        {entry.contributors && entry.contributors.length > 0 && (
          <div className="bg-white rounded-xl border border-stone-200 p-4">
            <h3 className="font-medium text-stone-900 mb-3">Contributors</h3>
            <p className="text-sm text-stone-600">
              {entry.contributors.length} {entry.contributors.length === 1 ? 'person has' : 'people have'} contributed to this entry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function EncyclopediaEntryPage({ params }: PageProps) {
  const { slug } = await params;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/encyclopedia"
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              Encyclopedia
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={<EntrySkeleton />}>
          <EntryContent slug={slug} />
        </Suspense>
      </main>
    </div>
  );
}
