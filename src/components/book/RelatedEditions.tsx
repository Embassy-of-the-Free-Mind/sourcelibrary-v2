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
    { projection: { 'image_source.provider_name': 1 }, maxTimeMS: 3000 }
  ).toArray().catch(() => []);

  if (related.length === 0) return null;

  const libraryCount = new Set(
    related.map(r => (r.image_source as { provider_name?: string })?.provider_name).filter(Boolean)
  ).size;

  return (
    <Link
      href={`/work/${workId}`}
      className="mt-6 flex items-center gap-2.5 px-4 py-3 rounded-lg border border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-all group"
    >
      <Library className="w-4 h-4 text-stone-400 group-hover:text-stone-600 flex-shrink-0" />
      <span className="text-sm text-stone-600 group-hover:text-stone-800">
        <strong className="font-semibold">{related.length}</strong>{' '}
        other edition{related.length !== 1 ? 's' : ''}{' '}
        across {libraryCount} {libraryCount === 1 ? 'library' : 'libraries'}
      </span>
      <span className="ml-auto text-stone-400 group-hover:text-stone-600 text-sm">&rarr;</span>
    </Link>
  );
}
