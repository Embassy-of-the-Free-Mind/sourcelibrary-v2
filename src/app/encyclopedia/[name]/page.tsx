import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, User, MapPin, Lightbulb, BookOpen, ExternalLink } from 'lucide-react';
import { ENTITY_TYPE_STYLES, ENTITY_TYPE_LABELS, type EntityType } from '@/lib/style-constants';
import { getEntity, getEntityGraph } from './layout';
import EntityGraph from '@/components/encyclopedia/EntityGraph';

const TYPE_ICONS = {
  person: User,
  place: MapPin,
  concept: Lightbulb,
};

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const entity = await getEntity(decodedName);

  if (!entity) {
    notFound();
  }

  const Icon = TYPE_ICONS[entity.type];
  const graph = await getEntityGraph(decodedName);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link
            href="/encyclopedia"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Encyclopedia
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl ${ENTITY_TYPE_STYLES[entity.type as EntityType].badgeBordered}`}>
              <Icon className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 bg-white/10 rounded text-xs text-stone-300">
                  {ENTITY_TYPE_LABELS[entity.type as EntityType]}
                </span>
              </div>
              <h1 className="text-3xl font-serif font-bold">{entity.name}</h1>
              {entity.aliases && entity.aliases.length > 0 && (
                <p className="text-stone-400 mt-1">
                  Also known as: {entity.aliases.join(', ')}
                </p>
              )}
              <div className="flex items-center gap-4 mt-4 text-sm text-stone-400">
                <span>{entity.book_count} book{entity.book_count !== 1 ? 's' : ''}</span>
                <span>&middot;</span>
                <span>{entity.total_mentions} total mention{entity.total_mentions !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Description */}
        {entity.description && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-3">About</h2>
            <p className="text-stone-700 leading-relaxed">{entity.description}</p>
            <div className="flex items-center gap-4 mt-4">
              {entity.wikipedia_url && (
                <a
                  href={entity.wikipedia_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent-rust hover:text-accent-gold-dark"
                >
                  Wikipedia
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {entity.wikidata_id && (
                <a
                  href={`https://www.wikidata.org/wiki/${entity.wikidata_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-accent-violet hover:text-accent-gold-dark"
                >
                  Wikidata
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Relationship Graph */}
        {graph && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-1">Connections</h2>
            <p className="text-sm text-stone-500 mb-4">
              Entities that appear in the same books. Hover to explore, click to navigate.
            </p>
            <EntityGraph nodes={graph.nodes} edges={graph.edges} />
          </div>
        )}

        {/* Appearances */}
        <div className="bg-white rounded-lg border border-stone-200 p-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">
            Appears in {entity.books.length} Book{entity.books.length !== 1 ? 's' : ''}
          </h2>
          <div className="space-y-4">
            {entity.books.map((book) => (
              <div
                key={book.book_id}
                className="border-l-2 border-accent-gold/30 pl-4 py-2"
              >
                <Link
                  href={`/book/${book.book_id}`}
                  className="font-medium text-stone-900 hover:text-accent-rust transition-colors"
                >
                  {book.book_title}
                </Link>
                <p className="text-sm text-stone-500 mt-0.5">{book.book_author}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {book.pages.slice(0, 10).map((page) => (
                    <Link
                      key={page}
                      href={`/book/${book.book_id}/page-number/${page}`}
                      className="inline-block px-2 py-0.5 bg-stone-100 text-stone-600 text-xs rounded hover:bg-accent-gold/15 hover:text-accent-rust transition-colors"
                    >
                      p. {page}
                    </Link>
                  ))}
                  {book.pages.length > 10 && (
                    <span className="inline-block px-2 py-0.5 text-stone-400 text-xs">
                      +{book.pages.length - 10} more pages
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Related Entities */}
        {entity.related && entity.related.length > 0 && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-lg font-semibold text-stone-900 mb-4">Related</h2>
            <p className="text-sm text-stone-500 mb-4">
              Other entities that appear in the same books
            </p>
            <div className="flex flex-wrap gap-2">
              {entity.related.map((related) => {
                const RelIcon = TYPE_ICONS[related.type];
                return (
                  <Link
                    key={related._id}
                    href={`/encyclopedia/${encodeURIComponent(related.name)}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-accent-gold/15 text-stone-700 hover:text-accent-gold-dark rounded-full text-sm transition-colors"
                  >
                    <RelIcon className="w-3.5 h-3.5" />
                    {related.name}
                    <span className="text-stone-400 text-xs">({related.book_count})</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
