import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import { bookUrl } from '@/lib/slugify';
import type { Book } from '@/lib/types';

interface RelatedEditionsProps {
  bookId: string;
  workId: string;
}

export default async function RelatedEditions({ bookId, workId }: RelatedEditionsProps) {
  const db = await getDb();

  const related = await db.collection('books').find(
    { work_id: workId, id: { $ne: bookId }, hidden: { $ne: true } },
    {
      projection: {
        id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
        language: 1, 'image_source.provider_name': 1, thumbnail_blob: 1, thumbnail: 1,
        pages_count: 1, pages_translated: 1,
      },
      sort: { published: 1 },
      limit: 20,
    }
  ).toArray();

  if (related.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
        Other Editions & Manuscripts
      </h3>
      <div className="space-y-2.5">
        {related.map((r) => {
          const b = r as unknown as Book;
          const title = b.display_title || b.title;
          const provider = (r.image_source as { provider_name?: string })?.provider_name;
          const thumb = b.thumbnail_blob || b.thumbnail;

          return (
            <Link
              key={b.id}
              href={`/book/${b.slug || b.id}`}
              className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-stone-50 transition-colors group"
            >
              {thumb && (
                <img
                  src={thumb}
                  alt=""
                  className="w-10 h-14 object-cover rounded shadow-sm flex-shrink-0"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-800 group-hover:text-stone-900 leading-tight truncate">
                  {title}
                </p>
                <p className="text-xs text-stone-500 mt-0.5 truncate">
                  {b.published && b.published !== 'Unknown' ? b.published : ''}
                  {b.published && b.published !== 'Unknown' && b.language ? ' · ' : ''}
                  {b.language && b.language !== 'Unknown' ? b.language : ''}
                </p>
                {provider && (
                  <p className="text-[10px] text-stone-400 mt-0.5 truncate">{provider}</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      <p className="text-[10px] text-stone-400 mt-3">
        {related.length} edition{related.length !== 1 ? 's' : ''} across{' '}
        {new Set(related.map(r => (r.image_source as { provider_name?: string })?.provider_name).filter(Boolean)).size}{' '}
        {new Set(related.map(r => (r.image_source as { provider_name?: string })?.provider_name).filter(Boolean)).size === 1 ? 'library' : 'libraries'}
      </p>
    </div>
  );
}
