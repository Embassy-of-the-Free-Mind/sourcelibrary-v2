import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import { Languages } from 'lucide-react';

/**
 * Reader-routing notice for effectively-untranslated books: when a sibling
 * edition of the same work (shared books.work_id) is substantially translated,
 * point the reader at it instead of letting a translated work look like a
 * dead end. See issue #3033 (a reader requested a translation of a 0/64 Monas
 * hieroglyphica edition while four fully-translated sibling editions existed).
 *
 * The page only renders this when the current book is effectively untranslated;
 * this component finds the best translated sibling (highest translated
 * fraction) and returns null when there is none.
 *
 * `showCrossLink` must be embedPolicy.showRelatedEditions: sibling editions are
 * a whole-library query by work_id, gated on tenant subdomains exactly like
 * RelatedEditions (tenant lockdown).
 */

interface TranslatedSiblingNoticeProps {
  bookId: string;
  workId: string;
  showCrossLink: boolean;
}

interface SiblingEdition {
  id?: string;
  slug?: string;
  title?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_translated?: number;
}

export default async function TranslatedSiblingNotice({
  bookId,
  workId,
  showCrossLink,
}: TranslatedSiblingNoticeProps) {
  if (!showCrossLink || !workId) return null;

  const db = await getReadDb();
  const siblings = (await db.collection('books').find(
    { work_id: workId, id: { $ne: bookId }, visible: true, pages_translated: { $gt: 0 } },
    {
      projection: { _id: 0, id: 1, slug: 1, title: 1, year: 1, language: 1, pages_count: 1, pages_translated: 1 },
      limit: 20,
      maxTimeMS: 3000,
    },
  ).toArray().catch(() => [])) as SiblingEdition[];

  // Best sibling = highest translated fraction; only offer editions that are
  // actually readable in English (>=50%, the page's own hasTranslations bar).
  const ratio = (b: SiblingEdition) => (b.pages_translated ?? 0) / Math.max(1, b.pages_count ?? 0);
  const best = siblings
    .filter((b) => ratio(b) >= 0.5)
    .sort((a, b) => ratio(b) - ratio(a))[0];
  if (!best) return null;

  return (
    <div className="mt-3 flex items-start gap-2.5 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-sm">
      <Languages className="w-4 h-4 mt-0.5 text-accent-gold flex-shrink-0" />
      <div className="text-stone-300">
        This edition is not yet translated, but the library holds this work in English —{' '}
        <Link
          href={`/book/${encodeURIComponent(best.slug || best.id || '')}`}
          className="text-accent-gold hover:text-accent-gold/80 underline underline-offset-2"
        >
          {best.title}
          {best.year ? ` (${best.year})` : ''}
        </Link>
        .
      </div>
    </div>
  );
}
