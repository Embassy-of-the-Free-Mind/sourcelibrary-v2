import Link from 'next/link';
import { localePath, type Locale } from '@/lib/locale-path';
import { isEnglishOriginal } from '@/lib/page-counts';
import { getWorkSiblings, type WorkSibling } from '@/lib/work-siblings';
import { buildVolumeSet, volumeTail } from '@/lib/volume-set';
import { BOOK_STRINGS } from '@/lib/book-i18n';

/**
 * "Volumes in this set" (#7527): where a reader on one volume of a multi-volume
 * set learns which volume this is, of how many, and gets to the others.
 *
 * Renders only when buildVolumeSet() is sure (see src/lib/volume-set.ts) —
 * otherwise nothing, and the editions rail keeps listing every sibling as before.
 * Reads the same cached work_id query as RelatedEditions; callers gate it on
 * `embedPolicy.showRelatedEditions` exactly like that rail (tenant lockdown:
 * a whole-library query must not render on a locked-down subdomain).
 *
 * Visual language is the book page's own light cards ("Search this book"):
 * `card`, the display-font h3, the page's ink / muted / rust values. No client
 * JS — the long list folds into a native <details>.
 */

/** Rows shown around the current volume before the list folds away. */
const WINDOW = 2;
/** A set this small is listed whole. */
const SHOW_ALL_UP_TO = 7;

const INK = '#2b2620';
const MUTED = '#948d80';
const RUST = '#a5503d';

function href(b: WorkSibling, locale: Locale): string {
  return localePath(`/book/${encodeURIComponent(b.slug || b.id || '')}`, locale);
}

function translatedPct(b: WorkSibling): number {
  return Math.round((100 * (b.pages_translated ?? 0)) / Math.max(1, b.pages_count ?? 0));
}

export default async function VolumeSetStrip({ bookId, workId, locale = 'en' }: {
  bookId: string;
  workId: string;
  locale?: Locale;
}) {
  const all = await getWorkSiblings(workId);
  const self = all.find((b) => b.id === bookId);
  if (!self) return null;
  const set = buildVolumeSet(self, all.filter((b) => b.id !== bookId));
  if (!set) return null;

  const t = BOOK_STRINGS[locale];
  const at = set.volumes.findIndex((v) => v.isCurrent);
  const total = set.volumes.length;
  const windowed = total > SHOW_ALL_UP_TO;
  const lo = windowed ? Math.max(0, Math.min(at - WINDOW, total - (2 * WINDOW + 1))) : 0;
  const shown = windowed ? set.volumes.slice(lo, lo + 2 * WINDOW + 1) : set.volumes;

  const status = (b: WorkSibling) => {
    if (isEnglishOriginal(b.language)) return null;
    const pct = translatedPct(b);
    return pct > 0 ? t.volumeTranslated(pct) : null;
  };

  const row = (v: (typeof set.volumes)[number], compact = false) => {
    const tail = compact ? '' : volumeTail(v.book);
    const st = status(v.book);
    const label = t.volumeShort(v.volume);
    return (
      <li key={`${v.volume}-${v.book.id}`} className="flex items-baseline gap-2 py-1 text-sm break-inside-avoid">
        {v.isCurrent ? (
          <span aria-current="page" className="font-semibold flex-shrink-0" style={{ color: INK }}>{label}</span>
        ) : (
          <Link href={href(v.book, locale)} className="flex-shrink-0 hover:underline underline-offset-2" style={{ color: RUST }}>{label}</Link>
        )}
        {tail && <span className="truncate" style={{ color: INK }}>{tail}</span>}
        {st && <span className="flex-shrink-0" style={{ color: MUTED }}>{st}</span>}
      </li>
    );
  };

  return (
    <nav aria-label={t.volumesInSet} className="card p-4 md:p-6 reveal-in">
      <h3 className="font-display font-medium text-[17px] md:text-[22px] mb-1" style={{ color: INK }}>{t.volumesInSet}</h3>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3 text-sm">
        <span style={{ color: MUTED }}>
          {set.complete ? t.volumeOfSet(set.current, set.highest) : t.volumeHeld(set.current, total)}
        </span>
        <span className="flex items-baseline gap-4">
          {set.prev && (
            <Link href={href(set.prev.book, locale)} rel="prev" className="hover:underline underline-offset-2" style={{ color: RUST }}>
              ← {t.volumeShort(set.prev.volume)}
            </Link>
          )}
          {set.next && (
            <Link href={href(set.next.book, locale)} rel="next" className="hover:underline underline-offset-2" style={{ color: RUST }}>
              {t.volumeShort(set.next.volume)} →
            </Link>
          )}
        </span>
      </div>
      <ul>{shown.map((v) => row(v))}</ul>
      {windowed && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm hover:underline underline-offset-2" style={{ color: RUST }}>
            {t.allVolumes(total)}
          </summary>
          <ul className="mt-2 columns-2 md:columns-3 gap-6">{set.volumes.map((v) => row(v, true))}</ul>
        </details>
      )}
    </nav>
  );
}
