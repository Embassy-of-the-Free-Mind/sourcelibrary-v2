import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import { Library } from 'lucide-react';

interface RelatedEditionsProps {
  bookId: string;
  workId: string;
}

export default async function RelatedEditions({ bookId, workId }: RelatedEditionsProps) {
  const db = await getDb();

  const related = await db.collection('books').find(
    { work_id: workId, id: { $ne: bookId }, visible: true },
    { projection: { 'image_source.provider_name': 1, work_slug: 1 }, maxTimeMS: 3000 }
  ).toArray().catch(() => []);

  if (related.length === 0) return null;

  const libraryCount = new Set(
    related.map(r => (r.image_source as { provider_name?: string })?.provider_name).filter(Boolean)
  ).size;
  // link by the clean work_slug; fall back to the raw work_id (route accepts both)
  const workHref = (related.find(r => (r as { work_slug?: string }).work_slug) as { work_slug?: string } | undefined)?.work_slug || workId;

  return (
    <div className="mt-4 pt-4 border-t border-stone-700">
      <div className="flex gap-2 text-sm">
        <span className="text-stone-500 w-24 flex-shrink-0">Editions:</span>
        <Link
          href={`/work/${workHref}`}
          className="text-accent-gold hover:text-accent-gold/80 flex items-center gap-1.5 transition-colors"
        >
          {related.length} other edition{related.length !== 1 ? 's' : ''}{' '}
          across {libraryCount} {libraryCount === 1 ? 'library' : 'libraries'}
        </Link>
      </div>
    </div>
  );
}
