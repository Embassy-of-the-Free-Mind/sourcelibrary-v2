// PRIOR ART: src/lib/home-data.ts getRecentlyTranslated (15-card homepage slider) — this is the same
// books_catalog read (browseBooks, sort last_translated) without the cover filter or the 15 cap, bucketed by week.
import { browseBooks, type CatalogBook } from '@/lib/books-catalog';
import { workKey } from '@/lib/home-data';

const DAY_MS = 86_400_000;
export const WEEKS_SHOWN = 4;

export interface NewWork {
  /** Newest book of the work: the card shows this one. */
  lead: CatalogBook;
  /** How many volumes of the work became readable in the window. */
  volumes: number;
  /** Pages now in English, summed over those volumes. */
  pagesTranslated: number;
}

export interface NewWeek {
  /** Window start (inclusive) and end, ISO. */
  from: string;
  to: string;
  works: NewWork[];
  /** Books, not works: a 64-volume set counts 64. */
  bookCount: number;
}

/**
 * Books that became readable in English in the last WEEKS_SHOWN rolling weeks,
 * newest first, one entry per work. Reads the indexed Supabase mirror, never
 * Mongo. `hasTranslation` is the named view `readable_in_english`, so a book
 * that merely has a preview of translated pages is not listed.
 */
export async function getNewInEnglish(now = Date.now()): Promise<NewWeek[]> {
  const since = new Date(now - WEEKS_SHOWN * 7 * DAY_MS).toISOString();
  const { books } = await browseBooks({
    hasTranslation: true,
    translatedSince: since,
    sort: 'last_translated',
    limit: 1000,
    skipCount: true,
  });

  const weeks: NewWeek[] = [];
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const to = now - i * 7 * DAY_MS;
    const from = to - 7 * DAY_MS;
    const inWeek = books.filter((b) => {
      const t = b.last_translation_at ? Date.parse(b.last_translation_at) : NaN;
      return t >= from && (i === 0 ? true : t < to);
    });
    const byWork = new Map<string, NewWork>();
    for (const b of inWeek) {
      const key = workKey(b);
      const w = byWork.get(key);
      if (w) {
        w.volumes += 1;
        w.pagesTranslated += b.pages_translated || 0;
      } else {
        byWork.set(key, { lead: b, volumes: 1, pagesTranslated: b.pages_translated || 0 });
      }
    }
    weeks.push({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      works: [...byWork.values()],
      bookCount: inWeek.length,
    });
  }
  return weeks;
}
