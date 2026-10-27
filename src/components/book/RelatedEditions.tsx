import { getReadDb } from '@/lib/mongodb';
import { localePath, type Locale } from '@/lib/locale-path';
import Link from 'next/link';
import { isEnglishOriginal } from '@/lib/page-counts';
import { Library, ScanSearch } from 'lucide-react';
import { isTrustedEditionKey } from '@/lib/edition-key';
import { getWorkSiblings, SIBLING_FILTER, SIBLING_PROJECTION, type WorkSibling } from '@/lib/work-siblings';
import { buildVolumeSet } from '@/lib/volume-set';

/**
 * The editions rail (#3730 §4, #3102 step 6): on a book page, show the reader
 * what else the library holds of this thing — in two lanes with different
 * identity grain:
 *
 *   - "Other printings & translations of this work"  — siblings by work_id
 *   - "Other scans of this edition"                   — siblings by edition_key,
 *     shown ONLY when both sides carry a full-quality key (isTrustedEditionKey:
 *     a no-year key merges every printing of a title across centuries, fine for
 *     a review queue and wrong for a reader-facing claim).
 *
 * Invariants (from #3730 §4 — do not relax):
 *   - siblings must be `visible: true, pages_count > 0` — never leak a hidden book;
 *   - books carrying `duplicate_of` are excluded even if somehow visible;
 *   - callers gate on `embedPolicy.showRelatedEditions` (tenant lockdown): this
 *     is a whole-library query and must not render on locked-down subdomains.
 *
 * Work-lane ordering is the collocation win first: editions in ANOTHER language
 * rank above same-language reprints, and translated ones above untranslated —
 * the reader on a Latin book is told about the English edition before the
 * other Latin printing.
 */

interface RelatedEditionsProps {
  bookId: string;
  workId: string;
  /** Current book's language — used to rank cross-language siblings first. */
  language?: string | null;
  /** Current book's stored edition key + quality; the scans lane renders only
   * when this is full-quality. */
  editionKey?: string | null;
  editionKeyQuality?: string | null;
  /** Locale of the page mounting this — sibling links keep its URL prefix.
   *  Named `locale` because `lang` already means the BOOK's language here. */
  locale?: Locale;
  /** Set where the page ALSO mounts VolumeSetStrip (#7527): volumes of this
   *  book's set are listed there, so they are left out of "Other printings"
   *  here. Off by default, so a mount without the strip keeps every sibling. */
  excludeSetVolumes?: boolean;
}

type Sibling = WorkSibling;

const PROJ = SIBLING_PROJECTION;

function bookHref(b: Sibling, locale: Locale): string {
  return localePath(`/book/${encodeURIComponent(b.slug || b.id || '')}`, locale);
}

function transPct(b: Sibling): number {
  return Math.round((100 * (b.pages_translated ?? 0)) / Math.max(1, b.pages_count ?? 0));
}

export default async function RelatedEditions({
  bookId, workId, language, editionKey, editionKeyQuality, locale = 'en', excludeSetVolumes = false,
}: RelatedEditionsProps) {
  const db = await getReadDb();

  const allOfWork = await getWorkSiblings(workId);
  const self = allOfWork.find((s) => s.id === bookId);
  const others = allOfWork.filter((s) => s.id !== bookId);
  // Volumes of this book's own set are shown by the volume strip, not as "printings".
  const setIds = excludeSetVolumes && self ? buildVolumeSet(self, others)?.memberIds : undefined;
  const workSiblings = setIds ? others.filter((s) => !setIds.has(s.id ?? '')) : others;

  // Same-printing scans: separate, stricter query — trusted keys only, both sides.
  const scanSiblings = isTrustedEditionKey(editionKeyQuality) && editionKey
    ? (await db.collection('books').find(
        { edition_key: editionKey, edition_key_quality: 'full', id: { $ne: bookId }, ...SIBLING_FILTER },
        { projection: PROJ, limit: 4, maxTimeMS: 3000 },
      ).toArray().catch(() => [])) as Sibling[]
    : [];

  if (workSiblings.length === 0 && scanSiblings.length === 0) return null;

  const scanIds = new Set(scanSiblings.map((s) => s.id));
  const printings = workSiblings.filter((s) => !scanIds.has(s.id));

  const lang = (language || '').toLowerCase();
  const ranked = [...printings].sort((a, b) => {
    const crossA = (a.language || '').toLowerCase() !== lang ? 0 : 1;
    const crossB = (b.language || '').toLowerCase() !== lang ? 0 : 1;
    if (crossA !== crossB) return crossA - crossB;
    const tA = transPct(a); const tB = transPct(b);
    if (tA !== tB) return tB - tA;
    return (a.year ?? 9999) - (b.year ?? 9999);
  });
  const shown = ranked.slice(0, 5);
  const more = printings.length - shown.length;

  const libraryCount = new Set(
    printings.map((r) => r.image_source?.provider_name).filter(Boolean),
  ).size;
  const workHref = `/work/${allOfWork.find((r) => r.work_slug)?.work_slug || workId}`;

  const row = (b: Sibling) => {
    const pct = transPct(b);
    return (
      <li key={b.id}>
        <Link href={bookHref(b, locale)} className="group/re flex items-baseline gap-2 py-1 text-sm">
          <span className="text-accent-gold group-hover/re:text-accent-gold/80 truncate">
            {b.display_title || b.title}
          </span>
          <span className="text-stone-500 flex-shrink-0">
            {[b.language, b.year, isEnglishOriginal(b.language) ? null : pct >= 99 ? 'translated' : pct > 0 ? `${pct}% translated` : null]
              .filter(Boolean).join(' · ')}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="mt-4 pt-4 border-t border-stone-700 space-y-3">
      {printings.length > 0 && (
        <div className="text-sm">
          <div className="flex items-center gap-1.5 text-stone-500 mb-1">
            <Library className="w-3.5 h-3.5" aria-hidden />
            <span>Other printings &amp; translations of this work</span>
          </div>
          <ul>{shown.map(row)}</ul>
          <Link href={workHref} className="text-accent-gold hover:text-accent-gold/80 text-sm">
            {more > 0
              ? `All ${printings.length} editions${libraryCount > 1 ? ` across ${libraryCount} libraries` : ''} →`
              : 'View this work →'}
          </Link>
        </div>
      )}
      {scanSiblings.length > 0 && (
        <div className="text-sm">
          <div className="flex items-center gap-1.5 text-stone-500 mb-1">
            <ScanSearch className="w-3.5 h-3.5" aria-hidden />
            <span>Other scans of this printing</span>
          </div>
          <ul>{scanSiblings.map(row)}</ul>
        </div>
      )}
    </div>
  );
}
