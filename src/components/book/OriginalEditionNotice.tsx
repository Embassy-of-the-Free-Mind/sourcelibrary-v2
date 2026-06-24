import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';

/**
 * Reader-orienting notice for books that are themselves historical English
 * translations (text_role: modern-translation | period-translation), so an
 * old translation never silently presents as the source. See issue #2395.
 *
 * Three states, driven by the linkage fields written by
 * scripts/maintenance/link-translation-originals.mjs:
 *   - original_edition_id  → "we hold the original — read it" cross-link
 *   - original_in_scan     → Loeb-style facing-page note (original co-present)
 *   - neither              → plain "historical translation" label
 *
 * `showCrossLink` must be the embedPolicy.showRelatedEditions flag: on tenant
 * subdomains the linked original may not belong to the tenant, and cross-book
 * references are gated exactly like RelatedEditions (tenant lockdown).
 */

interface OriginalEditionNoticeProps {
  textRole: string;
  originalEditionId?: string | null;
  originalInScan?: boolean;
  originalLanguage?: string | null;
  year?: number | null;
  showCrossLink: boolean;
}

export default async function OriginalEditionNotice({
  textRole,
  originalEditionId,
  originalInScan,
  originalLanguage,
  year,
  showCrossLink,
}: OriginalEditionNoticeProps) {
  if (textRole !== 'modern-translation' && textRole !== 'period-translation') return null;

  const yearStr = year && year > 0 ? ` (${year})` : '';
  const langStr = originalLanguage || 'another language';

  interface OriginalEdition { slug?: string; id?: string; title?: string; language?: string; year?: number; pages_translated?: number }
  let original: OriginalEdition | null = null;
  if (originalEditionId && showCrossLink) {
    const db = await getReadDb();
    original = (await db.collection('books').findOne(
      { id: originalEditionId, visible: true },
      { projection: { _id: 0, slug: 1, id: 1, title: 1, language: 1, year: 1, pages_translated: 1 }, maxTimeMS: 3000 },
    ).catch(() => null)) as OriginalEdition | null;
  }

  return (
    <div className="mt-3 flex items-start gap-2.5 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-sm">
      <ScrollText className="w-4 h-4 mt-0.5 text-accent-gold flex-shrink-0" />
      <div className="text-stone-300">
        {original ? (
          <>
            This volume is a historical English translation{yearStr}. The library holds the
            original {original.language || langStr} edition —{' '}
            <Link
              href={`/book/${encodeURIComponent(original.slug || original.id || '')}`}
              className="text-accent-gold hover:text-accent-gold/80 underline underline-offset-2"
            >
              {original.title}
              {original.year ? ` (${original.year})` : ''}
            </Link>
            {(original.pages_translated ?? 0) > 0 ? ', with our English translation.' : '.'}
          </>
        ) : originalInScan ? (
          <>
            This edition includes the original {langStr} text alongside the English translation.
          </>
        ) : (
          <>
            This volume is a historical English translation{yearStr} of a work originally
            written in {langStr}.
          </>
        )}
      </div>
    </div>
  );
}
