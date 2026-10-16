/**
 * Within one work, the edition a reader can read represents it (#5975).
 *
 * PRIOR ART: src/lib/search/work-grouping.ts — owns WHICH rows are one work and keeps the first-ranked one; it reads identity only and has no translation signal. src/lib/translation-completeness.ts — owns the rung and `isReadableInEnglish()`, which this file reads and never recomputes. src/app/api/explore/map/city/route.ts (#6001) — the same idea for a map pin, on a `pages_translated / pages_count >= 0.5` rule of its own.
 *
 * WHY
 * ---
 * Five reader translation requests answered on 2026-10-06 asked us to translate
 * a page of a book we already held translated in another edition (Monas
 * Hieroglyphica, Agrippa 1533, Herodotus 1502, Characteres Aegyptii,
 * Poimandres). Search had sent them to the copy they could not read: its ladder
 * ends on "older edition first", and the work collapse keeps whichever edition
 * the ladder put first. Checked live 2026-10-13: "Characteres Aegyptii" opens
 * on the 1608 copy, 1 of 138 pages translated, while the 1605 edition of the
 * same `work_id` is readable.
 *
 * TWO MECHANISMS, BECAUSE THE SIBLING IS NOT ALWAYS IN THE RESULT SET
 * ------------------------------------------------------------------
 * 1. `readabilityTier()` feeds `collapseByWork`'s `betterRepresentative`: when
 *    two editions of one work both matched, the readable one takes the row.
 * 2. `fetchTranslatedEditions()` covers the sibling that did NOT match (a
 *    different title on the same work): the row keeps the edition that matched
 *    and gains a link to the translated one.
 *
 * "Readable" is the stored rung (translation-state.md), never a ratio typed
 * here. Seven definitions of "translated" is how that doc came to exist.
 */

import type { Db } from 'mongodb';
import { canonWorkForWorkId } from '@/lib/canon-works';
import { isArtworkRecord } from '@/lib/artwork-record';
import { READABLE_RUNGS } from '@/lib/page-counts';
import {
  isReadableInEnglish,
  storedRung,
  type TranslationStateSource,
} from '@/lib/translation-completeness';

/** What `readabilityTier()` reads off a book. Project all of it. */
export interface ReadabilitySource extends TranslationStateSource {
  pages_count?: number | null;
  pages_ocr?: number | null;
  pages_translated?: number | null;
}

/** Mongo projection for {@link ReadabilitySource}; spread into inclusion projections. */
export const READABILITY_PROJECTION = {
  'translation_state.rung': 1,
  'translation_state.english_original': 1,
  pages_count: 1,
  pages_ocr: 1,
  pages_translated: 1,
} as const;

/** A reader can read the book in English now (`readable_in_english`). */
export const TIER_READABLE = 0;
/** Some of it is translated. */
export const TIER_PARTLY_TRANSLATED = 1;
/** Transcribed text, no translation. */
export const TIER_TEXT_ONLY = 2;
/** Page images only. */
export const TIER_IMAGES_ONLY = 3;

/**
 * How much of a book a reader can use, as a tier: lower is better.
 *
 * Tiers and not a percentage on purpose. A ratio would let a 100% edition take
 * the row from a 96% one, and the ladder's "older edition first" is the better
 * rule between two editions that are both readable.
 *
 * An unstamped book (no `translation_state`) falls back to its counters at the
 * rung's own 90% bar. That fallback has no blank-page or coverage term, so it
 * can only be coarser than the rung, never a second definition of it.
 */
export function readabilityTier(book: ReadabilitySource | null | undefined): number {
  const rung = storedRung(book);
  if (rung !== null) {
    if (isReadableInEnglish(book)) return TIER_READABLE;
    if (rung === 'translating') return TIER_PARTLY_TRANSLATED;
    if (rung === 'transcribed' || rung === 'transcribing') return TIER_TEXT_ONLY;
    return TIER_IMAGES_ONLY;
  }
  const pages = Math.max(0, book?.pages_count ?? 0);
  const translated = Math.max(0, book?.pages_translated ?? 0);
  if (pages > 0 && translated >= 0.9 * pages) return TIER_READABLE;
  if (translated > 0) return TIER_PARTLY_TRANSLATED;
  if ((book?.pages_ocr ?? 0) > 0) return TIER_TEXT_ONLY;
  return TIER_IMAGES_ONLY;
}

/** The translated sibling a result row links to. */
export interface TranslatedEdition {
  book_id: string;
  slug?: string;
  title: string;
  published?: string;
}

interface SiblingDoc extends TranslationStateSource {
  id?: string;
  slug?: string | null;
  title?: string | null;
  display_title?: string | null;
  published?: string | null;
  year?: number | null;
  work_id?: string | null;
  content_type?: string | null;
  resource_type?: string | null;
}

const yearOf = (b: SiblingDoc): number => {
  if (typeof b.year === 'number' && Number.isFinite(b.year)) return b.year;
  const m = typeof b.published === 'string' ? b.published.match(/\d{3,4}/) : null;
  return m ? parseInt(m[0], 10) : 9999;
};

/**
 * A title that names one volume of a set ("Vol. 6", "Tomus II", "Band 3").
 *
 * `work_id` is work-grain, not volume-grain (#3708), so the volumes of a set
 * share one id, and so do the texts a loose local mint lumped under an author's
 * collected works. Measured on the first run of this code, 2026-10-13: under
 * "Aristotle Metaphysics: Hebrew Translation" it offered "Works of Aristotle,
 * Vol. 6, Aldine Edition: Nicomachean Ethics…" as the translated edition. One
 * volume of a set is not shown to be the same text as the row, so it is never
 * offered. This only ever removes a link.
 */
const VOLUME_MARKER = /\b(?:vol(?:ume|umen|\.)?|tom(?:e|us|o|i|\.)?|band|bd\.?|pars|part|t(?:h)?eil|deel)\s*\.?\s*(?:\d+|[ivxlc]+|one|two|three|four|five|six|first|second|third|fourth|prim[a-z]{1,3}|secund[a-z]{1,3}|terti[a-z]{1,3}|quart[a-z]{1,3}|quint[a-z]{1,3})\b/i;

export function namesOneVolume(title: string | null | undefined): boolean {
  return !!title && VOLUME_MARKER.test(title);
}

/**
 * The one sibling to link: a complete translation before a readable one, then
 * the older edition (the ladder's own rule between editions), then id so the
 * choice is stable across requests.
 */
export function pickTranslatedEdition(
  siblings: SiblingDoc[],
  excludeBookId?: string | null,
): TranslatedEdition | null {
  const eligible = siblings.filter(b =>
    !!b.id && b.id !== excludeBookId &&
    !isArtworkRecord(b) &&
    !namesOneVolume(b.title) && !namesOneVolume(b.display_title) &&
    // A TRANSLATED edition: an English original is readable, but calling it
    // "translated" would be a false label on the link.
    b.translation_state?.english_original !== true &&
    READABLE_RUNGS.includes(storedRung(b) as (typeof READABLE_RUNGS)[number]),
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const ac = storedRung(a) === 'complete' ? 0 : 1;
    const bc = storedRung(b) === 'complete' ? 0 : 1;
    if (ac !== bc) return ac - bc;
    const ay = yearOf(a);
    const by = yearOf(b);
    if (ay !== by) return ay - by;
    return String(a.id).localeCompare(String(b.id));
  });
  const best = eligible[0];
  return {
    book_id: best.id as string,
    ...(best.slug ? { slug: best.slug } : {}),
    title: best.display_title || best.title || '',
    ...(best.published ? { published: best.published } : {}),
  };
}

/** Never ask about more works than one page of results can show. */
const MAX_WORKS = 60;

/**
 * For result rows a reader cannot read, the translated edition of the same
 * work, when we hold one. One indexed `work_id` query for the whole page of
 * results (request-path-queries.md); the `work_slug` half of the work page's
 * filter has no index and is left out for the reason
 * `workEditionsCountFilter()` gives.
 *
 * Returns a map keyed by the row's book id. A row is OMITTED when nothing can
 * be established: no work id, a tenant request (a sibling in the global library
 * is not a partner reading room's link to offer; tenant-lockdown.md), a Mongo
 * error, or no translated sibling. No link is better than a wrong one.
 */
export async function fetchTranslatedEditions(
  db: Db,
  rows: { bookId: string; workId: string | null | undefined }[],
  opts?: { tenantScoped?: boolean },
): Promise<Map<string, TranslatedEdition>> {
  const out = new Map<string, TranslatedEdition>();
  if (opts?.tenantScoped) return out;

  // A canon work is several verified work_ids; /work/[slug] shows them as one.
  const idsByRow = new Map<string, string[]>();
  const allIds = new Set<string>();
  for (const { bookId, workId } of rows) {
    const id = typeof workId === 'string' ? workId.trim() : '';
    if (!id || !bookId) continue;
    if (idsByRow.size >= MAX_WORKS) break;
    const ids = canonWorkForWorkId(id)?.workIds ?? [id];
    idsByRow.set(bookId, ids);
    for (const w of ids) allIds.add(w);
  }
  if (allIds.size === 0) return out;

  let siblings: SiblingDoc[];
  try {
    siblings = await db.collection('books')
      .find(
        {
          work_id: { $in: [...allIds] },
          visible: true,
          pages_count: { $gt: 0 },
          'translation_state.rung': { $in: [...READABLE_RUNGS] },
          'translation_state.english_original': { $ne: true },
        },
        {
          projection: {
            id: 1, slug: 1, title: 1, display_title: 1, published: 1, year: 1, work_id: 1,
            content_type: 1, resource_type: 1,
            'translation_state.rung': 1, 'translation_state.english_original': 1,
          },
        },
      )
      .limit(500)
      .maxTimeMS(2000)
      .toArray() as unknown as SiblingDoc[];
  } catch {
    return out;
  }

  const byWork = new Map<string, SiblingDoc[]>();
  for (const s of siblings) {
    if (!s.work_id) continue;
    const list = byWork.get(s.work_id);
    if (list) list.push(s);
    else byWork.set(s.work_id, [s]);
  }
  for (const [bookId, ids] of idsByRow) {
    const pick = pickTranslatedEdition(ids.flatMap(w => byWork.get(w) ?? []), bookId);
    if (pick) out.set(bookId, pick);
  }
  return out;
}
