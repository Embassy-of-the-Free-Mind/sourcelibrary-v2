import { getReadDb } from '@/lib/mongodb';

/**
 * The works index: works we hold in several editions across several centuries.
 *
 * This reads the `work_id` grouping that already exists on `books` — it does not
 * mint or repair work identity (that is #3258 / #2453). Its only job is to make
 * the ~400 multi-witness works reachable, which today they are not: a git grep
 * for inbound `/work/` links finds one blog post and a rail low on the book page.
 */

export interface WorkSummary {
  workId: string;
  /** Canonical URL segment. Always the slug — the raw work_id form is often `local:a:…`. */
  slug: string;
  title: string;
  author: string | null;
  /** Number of editions/manuscripts held. */
  witnesses: number;
  earliest: number;
  latest: number;
  /** latest − earliest, in years. The headline: how long we can watch this text travel. */
  span: number;
  languages: string[];
  libraries: string[];
  totalPages: number;
  thumbnail: string | null;
}

/**
 * Catalogue no-date markers, matching `/work/[id]`'s. A value here means the
 * record carries no publication statement to corroborate its `year`.
 */
const NO_DATE = new Set(['', 'unknown', 'undated', 'n.d', 'n.d.', 'n.d.]', '[n.d.]', '[date of publication not identified]']);

/**
 * Earliest physical witness in the collection is the 550 CE Bodleian Gospels
 * (MS. Auct. E. 5. 11). A record dated before this with no publication
 * statement to back it is carrying the work's *composition* date, not the date
 * of the object we hold — "Plato, Republic, Laws and Timaeus" is stamped −375,
 * "Euclid, Elements (palimpsest)" −300, "Galeni De usu partium" 170. Measured
 * 2026-08-07: exactly 12 live books match, and all 12 are composition dates.
 *
 * They still count as witnesses; they just may not set the span endpoints,
 * because "Euclid across 2,025 years" is a claim about the text, not about what
 * a reader can open here. Fixing the underlying records is a cataloguing
 * decision, not a display one — tracked separately.
 */
const OLDEST_HELD_WITNESS = 500;

function isCorroborated(published: string | null | undefined, year: number): boolean {
  if (year >= OLDEST_HELD_WITNESS) return true;
  return !NO_DATE.has((published || '').trim().toLowerCase());
}

interface RawGroup {
  _id: string;
  slug: string | null;
  title: string | null;
  author: string | null;
  witnesses: number;
  totalPages: number;
  languages: (string | null)[];
  libraries: (string | null)[];
  thumbnail: string | null;
  dated: { year: number; published: string | null }[];
}

/** Minimum evidence for a transmission: several copies, from several moments. */
const MIN_WITNESSES = 3;
const MIN_DISTINCT_YEARS = 3;

export async function fetchWorksIndex(): Promise<WorkSummary[]> {
  const db = await getReadDb();

  // Grouping ~19.5K visible books by work_id — measured 1.4–3.0s against prod.
  // Tolerable only because this route is ISR (revalidated daily), never
  // per-request, and `books` does not scale with the corpus the way `pages`
  // (19.1M) does. See .claude/docs/invariants/request-path-queries.md — if this
  // page ever goes dynamic, precompute the result instead.
  const groups = await db.collection('books').aggregate<RawGroup>([
    { $match: { visible: true, pages_count: { $gt: 0 }, work_id: { $nin: [null, ''] }, year: { $type: 'number' } } },
    {
      $group: {
        _id: '$work_id',
        slug: { $first: '$work_slug' },
        title: { $first: '$work_title' },
        author: { $first: '$author' },
        witnesses: { $sum: 1 },
        totalPages: { $sum: '$pages_count' },
        languages: { $addToSet: '$language' },
        libraries: { $addToSet: '$image_source.provider_name' },
        thumbnail: { $first: '$thumbnail_blob' },
        dated: { $push: { year: '$year', published: '$published' } },
      },
    },
    { $match: { witnesses: { $gte: MIN_WITNESSES } } },
  ], { maxTimeMS: 20000 }).toArray();

  const works: WorkSummary[] = [];
  for (const g of groups) {
    // A multi-volume set shares one work_id by design (#3258), so 42 volumes of
    // a single 1621 printing is not a transmission. Require distinct dates.
    const distinctYears = new Set(g.dated.map(d => d.year));
    if (distinctYears.size < MIN_DISTINCT_YEARS) continue;

    const corroborated = g.dated.filter(d => isCorroborated(d.published, d.year)).map(d => d.year);
    if (corroborated.length < 2) continue;

    const earliest = Math.min(...corroborated);
    const latest = Math.max(...corroborated);
    const slug = g.slug || g._id;
    works.push({
      workId: g._id,
      slug,
      title: g.title?.trim() || prettifySlug(slug),
      author: g.author,
      witnesses: g.witnesses,
      earliest,
      latest,
      span: latest - earliest,
      languages: dedupe(g.languages),
      libraries: dedupe(g.libraries),
      totalPages: g.totalPages,
      thumbnail: g.thumbnail,
    });
  }

  return works.sort((a, b) => b.span - a.span || b.witnesses - a.witnesses);
}

/**
 * `$addToSet` returns members in no defined order, so without a sort the same
 * data renders "Greek, Syriac, Ge'ez" one day and "Ge'ez, Syriac, Greek" the
 * next. Sorted so an ISR re-render is a no-op when nothing has changed.
 */
function dedupe(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v !== 'Unknown'))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Last resort when a work carries no curated `work_title` (91 of ~590 groups). */
function prettifySlug(slug: string): string {
  const tail = slug.includes(':') ? slug.split(':').pop()! : slug;
  return tail.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
