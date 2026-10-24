/**
 * Data for /timeline/written: the works we hold, placed in the century they
 * were written, one entry per WORK linked to its most readable edition (#6873).
 *
 * PRIOR ART: src/lib/works-index.ts — groups editions by `work_id` for /works,
 * but only works held in several editions and with no work date;
 * src/lib/search/readable-edition.ts — `readabilityTier()`, used here unchanged
 * to pick which edition represents a work; src/app/timeline/page.tsx — buckets
 * EDITION years by decade, which is the other question.
 *
 * Both readers run at ISR time (revalidate on the routes), never per request:
 * the overview reads every live dated book (~42K, a few small fields each,
 * ~2 s), and a century page reads its own year range off the
 * `work_date_year_live` index (request-path-queries.md).
 */

import type { Db, Document } from 'mongodb';
import { isArtworkRecord } from '@/lib/artwork-record';
import {
  READABILITY_PROJECTION,
  readabilityTier,
  TIER_READABLE,
  type ReadabilitySource,
} from '@/lib/search/readable-edition';
import type { SourceWorkDate } from '@/lib/types/book';
import { WORK_YEAR_FIELD, centuryOf, centuryRange, workDateBasis } from '@/lib/work-dates';

const LIVE = { visible: true, pages_count: { $gt: 0 } } as const;

interface DatedBookDoc extends ReadabilitySource {
  _id: unknown;
  id?: string;
  work_id?: string | null;
  content_type?: string | null;
  resource_type?: string | null;
  source_work_dates_meta?: { work?: SourceWorkDate; checks?: string[] };
}

/** Editions of one work share a key: the work_id, else the book itself. */
function workKey(b: DatedBookDoc): string {
  return b.work_id || b.id || String(b._id);
}

/** Better representative first: readable before not, more translated pages, then the earlier copy. */
function compareEditions(a: DatedBookDoc & { year?: number | null }, b: DatedBookDoc & { year?: number | null }): number {
  const t = readabilityTier(a) - readabilityTier(b);
  if (t !== 0) return t;
  const p = (b.pages_translated ?? 0) - (a.pages_translated ?? 0);
  if (p !== 0) return p;
  return (a.year ?? 99999) - (b.year ?? 99999);
}

export interface CenturySummary {
  century: number;
  works: number;
  books: number;
  /** Works with at least one edition readable in English. */
  readableWorks: number;
  /** Works whose date rests on a record rather than an estimate. */
  sourcedWorks: number;
}

export interface CenturyOverview {
  centuries: CenturySummary[];
  totals: { works: number; books: number; readableWorks: number; sourcedWorks: number };
}

export async function fetchCenturyOverview(db: Db): Promise<CenturyOverview> {
  const docs = (await db.collection('books').find(
    { ...LIVE, [WORK_YEAR_FIELD]: { $type: 'number' } },
    {
      projection: {
        _id: 1, id: 1, work_id: 1, content_type: 1, resource_type: 1,
        [WORK_YEAR_FIELD]: 1, 'source_work_dates_meta.work.basis': 1,
        ...READABILITY_PROJECTION,
      },
      maxTimeMS: 45000,
    },
  ).toArray()) as unknown as DatedBookDoc[];

  // century → work → { books, readable, sourced }
  const byCentury = new Map<number, Map<string, { books: number; readable: boolean; sourced: boolean }>>();
  for (const b of docs) {
    if (isArtworkRecord(b)) continue;
    const work = b.source_work_dates_meta?.work;
    if (typeof work?.year !== 'number') continue;
    const c = centuryOf(work.year);
    let works = byCentury.get(c);
    if (!works) byCentury.set(c, (works = new Map()));
    const k = workKey(b);
    const w = works.get(k) ?? { books: 0, readable: false, sourced: false };
    w.books += 1;
    w.readable ||= readabilityTier(b) === TIER_READABLE;
    w.sourced ||= workDateBasis(work).sourced;
    works.set(k, w);
  }

  const centuries: CenturySummary[] = [...byCentury.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([century, works]) => {
      let books = 0, readableWorks = 0, sourcedWorks = 0;
      for (const w of works.values()) {
        books += w.books;
        if (w.readable) readableWorks++;
        if (w.sourced) sourcedWorks++;
      }
      return { century, works: works.size, books, readableWorks, sourcedWorks };
    });
  const totals = centuries.reduce(
    (t, c) => ({
      works: t.works + c.works, books: t.books + c.books,
      readableWorks: t.readableWorks + c.readableWorks, sourcedWorks: t.sourcedWorks + c.sourcedWorks,
    }),
    { works: 0, books: 0, readableWorks: 0, sourcedWorks: 0 },
  );
  return { centuries, totals };
}

export interface CenturyWork {
  key: string;
  /** The edition the entry links to: the most readable one we hold. */
  book: { id: string; slug?: string; title: string; author?: string; language?: string; year?: number | null; published?: string };
  tier: number;
  /** Editions of the work we hold in this century, the linked one included. */
  editions: number;
  workYear: number;
  /** Years between the ends of the dated window; null when the run wrote a single year. */
  span: number | null;
  display: string;
  basis: ReturnType<typeof workDateBasis>;
}

export interface CenturyWorks {
  century: number;
  works: CenturyWork[];
  books: number;
}

export async function fetchCenturyWorks(db: Db, century: number): Promise<CenturyWorks> {
  const { from, to } = centuryRange(century);
  const docs = (await db.collection('books').find(
    { [WORK_YEAR_FIELD]: { $gte: from, $lte: to }, ...LIVE } as Document,
    {
      projection: {
        _id: 1, id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, published: 1,
        work_id: 1, content_type: 1, resource_type: 1,
        'source_work_dates_meta.work': 1, 'source_work_dates_meta.checks': 1,
        ...READABILITY_PROJECTION,
      },
      maxTimeMS: 30000,
    },
  ).toArray()) as unknown as Array<DatedBookDoc & {
    slug?: string; title?: string; display_title?: string; author?: string; language?: string;
    year?: number | null; published?: string;
  }>;

  const groups = new Map<string, typeof docs>();
  let books = 0;
  for (const b of docs) {
    if (isArtworkRecord(b)) continue;
    if (typeof b.source_work_dates_meta?.work?.year !== 'number') continue;
    books++;
    const k = workKey(b);
    const g = groups.get(k);
    if (g) g.push(b); else groups.set(k, [b]);
  }

  const works: CenturyWork[] = [];
  for (const [key, eds] of groups) {
    eds.sort(compareEditions);
    const rep = eds[0];
    const work = rep.source_work_dates_meta!.work!;
    works.push({
      key,
      book: {
        id: rep.id || String(rep._id),
        slug: rep.slug,
        title: (rep.display_title || rep.title || 'Untitled').trim(),
        author: rep.author || undefined,
        language: rep.language || undefined,
        year: rep.year ?? null,
        published: rep.published || undefined,
      },
      tier: readabilityTier(rep),
      editions: eds.length,
      workYear: work.year as number,
      span: typeof work.from === 'number' && typeof work.to === 'number' ? work.to - work.from : null,
      display: work.display || '',
      basis: workDateBasis(work, rep.source_work_dates_meta?.checks),
    });
  }
  works.sort((a, b) => a.workYear - b.workYear || a.book.title.localeCompare(b.book.title));
  return { century, works, books };
}
