import { NextRequest, NextResponse } from 'next/server';
import { supabase, sanitizeFilterValue } from '@/lib/supabase';
import { normalizeBphSearchText } from '@/lib/text-normalize';
import { getReadDb } from '@/lib/mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

// Pinned display count for the default BPH "digitised" view. The real Supabase
// count drifts up as the sync cron re-links visible twins of deduped books
// (see issue #1742). Partner-facing convention is to display 2,222 — the
// number landed at the 2026-05-12 convergence pass — and surface any drift
// in #1742 rather than in the public counter. The DB count query is skipped
// entirely when this pin applies, saving a COUNT(*) on every page load.
const BPH_DIGITIZED_PINNED_TOTAL = 2222;

// New (expanded) field set — requires expand-bph-works-schema.sql to have been run.
const FIELDS_NEW_CORE = [
  'ubn',
  'title', 'parallel_title', 'uniform_title',
  'author', 'variant_author', 'pseudonym',
  'editor', 'variant_editor',
  'place', 'printer', 'publisher', 'variant_printer', 'variant_publisher',
  'year',
  'shelf_mark', 'state_shelf_mark', 'present_location',
  'keywords', 'language',
  'series_title', 'volume_title',
  'bibliography', 'remarks',
  'number_of_copies', 'object_size_cm', 'binding', 'bound_with',
  'provenance',
  'thumbnail', 'file_count',
  'sl_book_id', 'sl_book_slug',
  'ia_identifier', 'ustc_sn',
];
// Cross-provider link (BPH holds the work physically, scans live at another
// archive — IA, CMC Kloss, MDZ, Gallica, e-rara, etc.). Surfaced as a
// secondary "Read at [source]" link in the catalogue UI. Deliberately kept
// separate from sl_book_id so existing "BPH digitised" counters stay accurate.
// Added by add-bph-external-links.sql; gated by hasExternalLinks so the
// route degrades gracefully on a runtime that boots before the migration runs.
const FIELDS_EXTERNAL = ['sl_external_book_id', 'sl_external_slug', 'sl_external_source'];

// Legacy field set — works against the original 11-column bph_works schema.
const FIELDS_LEGACY = 'ubn, title, author, year, shelf_mark, keywords, ia_identifier, ustc_sn, place, publisher, printer';

// Cache the schema mode for the lifetime of the runtime.
let schemaMode: 'new' | 'legacy' | null = null;
// Cache the global set of `is_first_translation: true` book ids from Atlas.
// The filter joins the BPH catalogue (Supabase) to this set via
// `bph_works.sl_book_id.in.(…)`, so we only need the universe of candidate
// ids — the rest of the filter chain (search, year range, …) is applied by
// Supabase. Refetched per TTL to pick up new verifications without a deploy.
let firstTranslationCache: { ids: string[]; expires: number } | null = null;
const FIRST_TRANSLATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
async function getFirstTranslationBookIds(): Promise<string[]> {
  if (firstTranslationCache && firstTranslationCache.expires > Date.now()) {
    return firstTranslationCache.ids;
  }
  try {
    const db = await getReadDb();
    const rows = await db.collection('books').find(
      { is_first_translation: true, hidden: { $ne: true } },
      { projection: { _id: 0, id: 1 }, maxTimeMS: 8_000 },
    ).toArray();
    const ids = (rows as unknown as Array<{ id?: string }>)
      .map(r => r.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    firstTranslationCache = { ids, expires: Date.now() + FIRST_TRANSLATION_TTL_MS };
    return ids;
  } catch {
    // On Atlas failure, return an empty set so the filter yields zero results
    // rather than silently degrading to "all books".
    return [];
  }
}
// Tracks whether the `*_norm` diacritic-insensitive columns from
// add-bph-diacritic-normalization.sql have been applied. Auto-detected on
// the first query that uses them; falls back to plain ilike on the original
// columns if they don't exist yet.
let hasNormalizedColumns: boolean | null = null;
// Tracks whether the sl_external_* columns from add-bph-external-links.sql
// have been applied. Auto-detected on first error; degrades gracefully so
// pre-migration runtimes still serve the rest of the v2 schema.
let hasExternalLinks: boolean | null = null;

function isMissingColumnError(err: { message?: string; code?: string }): boolean {
  if (!err) return false;
  // PostgREST surfaces "column foo does not exist" / "could not find the column"
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('does not exist') ||
    msg.includes('could not find the') ||
    msg.includes('column') && msg.includes('not found') ||
    err.code === '42703'
  );
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // Simple search.
  const q = sp.get('q')?.trim() || '';

  // Per-field advanced search.
  const author = sp.get('author')?.trim() || '';
  const title = sp.get('title')?.trim() || '';
  const place = sp.get('place')?.trim() || '';
  const printer = sp.get('printer')?.trim() || '';
  const publisher = sp.get('publisher')?.trim() || '';
  const editor = sp.get('editor')?.trim() || '';
  const keyword = sp.get('keyword')?.trim() || '';
  const language = sp.get('language')?.trim() || '';
  const shelfMark = sp.get('shelf_mark')?.trim() || '';
  const provenance = sp.get('provenance')?.trim() || '';

  const yearFrom = sp.get('yearFrom') ? parseInt(sp.get('yearFrom')!, 10) : null;
  const yearTo = sp.get('yearTo') ? parseInt(sp.get('yearTo')!, 10) : null;

  const digitized = sp.get('digitized'); // 'true' | 'false' | 'sl' | null

  // First-translation join: BPH catalogue (Supabase) → Atlas `books.is_first_translation`.
  // Implicitly digitised-on-SL (the join key is `sl_book_id`, which is only
  // populated for catalogue rows linked to a Source Library book). Pre-fetch
  // the universe from Atlas, cached for 5 minutes.
  const firstTranslation = sp.get('first_translation') === '1';
  const firstTranslationIds = firstTranslation ? await getFirstTranslationBookIds() : null;

  const sort = sp.get('sort') || 'title';
  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || String(PER_PAGE), 10) || PER_PAGE));

  // Default unfiltered "digitised on Source Library" view: skip the COUNT(*)
  // and return the pinned 2,222. Any filter / search / advanced field falls
  // through to the normal exact-count path.
  const isPinnedDigitizedView =
    digitized === 'sl' &&
    !q && !author && !title && !place && !printer && !publisher && !editor &&
    !keyword && !language && !shelfMark && !provenance &&
    yearFrom === null && yearTo === null &&
    !firstTranslation;

  // Run the query in the requested mode. Returns the supabase result object.
  async function runQuery(mode: 'new' | 'legacy') {
    let fields: string;
    if (mode === 'legacy') {
      fields = FIELDS_LEGACY;
    } else {
      const cols = hasExternalLinks === false
        ? FIELDS_NEW_CORE
        : [...FIELDS_NEW_CORE, ...FIELDS_EXTERNAL];
      fields = cols.join(', ');
    }
    let query = supabase
      .from('bph_works')
      .select(fields, isPinnedDigitizedView ? { count: 'planned', head: false } : { count: 'exact' });

    // Simple search. When the diacritic-normalised `search_norm` column
    // exists (after applying add-bph-diacritic-normalization.sql), query
    // against it with the normalised user input so "Boehme" finds "Böhme".
    // Falls back to the original tsvector / per-field ilike on first miss.
    if (q.length >= 2) {
      if (mode === 'new' && hasNormalizedColumns !== false) {
        const normQ = sanitizeFilterValue(normalizeBphSearchText(q));
        if (normQ.length > 0) {
          query = query.ilike('search_norm', `%${normQ}%`);
        }
      } else if (mode === 'new') {
        const safe = sanitizeFilterValue(q);
        query = query.textSearch('search_tsv', safe, { type: 'websearch', config: 'simple' });
      } else {
        const safe = sanitizeFilterValue(q);
        query = query.or(`title.ilike.%${safe}%,author.ilike.%${safe}%,shelf_mark.ilike.%${safe}%`);
      }
    }

    const ilikeFilter = (col: string, val: string) => {
      if (!val) return;
      const safe = sanitizeFilterValue(val);
      const normVal = sanitizeFilterValue(normalizeBphSearchText(val));
      const useNorm = mode === 'new' && hasNormalizedColumns !== false && normVal.length > 0;

      if (mode === 'new') {
        // Per-field `*_norm` columns roll up the standard field with its
        // variants (e.g. author_norm covers author + variant_author +
        // pseudonym), so one ilike replaces the previous .or() chain.
        if (useNorm) {
          const normCol = col === 'shelf_mark' ? 'shelf_mark_norm' : `${col}_norm`;
          query = query.ilike(normCol, `%${normVal}%`);
          return;
        }
        if (col === 'author') {
          query = query.or(`author.ilike.%${safe}%,variant_author.ilike.%${safe}%,pseudonym.ilike.%${safe}%`);
        } else if (col === 'title') {
          query = query.or(`title.ilike.%${safe}%,parallel_title.ilike.%${safe}%,uniform_title.ilike.%${safe}%`);
        } else if (col === 'editor') {
          query = query.or(`editor.ilike.%${safe}%,variant_editor.ilike.%${safe}%`);
        } else if (col === 'printer') {
          query = query.or(`printer.ilike.%${safe}%,variant_printer.ilike.%${safe}%`);
        } else if (col === 'publisher') {
          query = query.or(`publisher.ilike.%${safe}%,variant_publisher.ilike.%${safe}%`);
        } else if (col === 'shelf_mark') {
          query = query.or(`shelf_mark.ilike.%${safe}%,state_shelf_mark.ilike.%${safe}%`);
        } else {
          query = query.ilike(col, `%${safe}%`);
        }
      } else {
        // Legacy schema only has author, title, place, printer, publisher, shelf_mark.
        if (['author', 'title', 'place', 'printer', 'publisher', 'shelf_mark'].includes(col)) {
          query = query.ilike(col, `%${safe}%`);
        }
        // editor / language / provenance not available in legacy; silently dropped.
      }
    };
    ilikeFilter('author', author);
    ilikeFilter('title', title);
    ilikeFilter('editor', editor);
    ilikeFilter('place', place);
    ilikeFilter('printer', printer);
    ilikeFilter('publisher', publisher);
    ilikeFilter('shelf_mark', shelfMark);

    if (keyword) query = query.eq('keywords', keyword);
    if (mode === 'new') {
      if (language) query = query.eq('language', language);
      if (provenance) query = query.eq('provenance', provenance);
    }

    if (yearFrom !== null && !Number.isNaN(yearFrom)) query = query.gte('year', yearFrom);
    if (yearTo !== null && !Number.isNaN(yearTo)) query = query.lte('year', yearTo);

    if (digitized === 'true') {
      if (mode === 'new') {
        query = query.or('sl_book_id.not.is.null,ia_identifier.not.is.null');
      } else {
        query = query.not('ia_identifier', 'is', null);
      }
    } else if (digitized === 'sl' && mode === 'new') {
      query = query.not('sl_book_id', 'is', null);
    } else if (digitized === 'held' && mode === 'new') {
      // Catalogue entries with a non-null `present_location` are books
      // physically in the building (Leeszaal, Depot, …). Catalog-only
      // references and works held elsewhere have null present_location.
      // Requested by Paul Dijstelberge (BPH) — visitors wanted a way to see
      // just the volumes they could ask to consult on site.
      query = query.not('present_location', 'is', null);
    } else if (digitized === 'false') {
      if (mode === 'new') {
        query = query.is('sl_book_id', null).is('ia_identifier', null);
      } else {
        query = query.is('ia_identifier', null);
      }
    }

    // First-translation filter — restrict to BPH rows whose linked SL book has
    // `is_first_translation: true`. The legacy schema has no sl_book_id column,
    // so the filter is a no-op there (returns zero rows by design).
    if (firstTranslation) {
      if (mode === 'new' && firstTranslationIds && firstTranslationIds.length > 0) {
        query = query.in('sl_book_id', firstTranslationIds);
      } else {
        // No first-translation ids known (or legacy schema) → return nothing.
        // PostgREST doesn't have a clean "always false" predicate; use an empty
        // `in` with a sentinel that can't appear in sl_book_id.
        query = query.eq('sl_book_id', '__no_first_translations__');
      }
    }

    switch (sort) {
      case 'year_asc':
        query = query.order('year', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
        break;
      case 'year_desc':
        query = query.order('year', { ascending: false, nullsFirst: false }).order('title', { ascending: true });
        break;
      case 'author':
        query = query.order('author', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
        break;
      case 'shelfmark':
        query = query.order('shelf_mark', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
        break;
      default:
        query = query.order('title', { ascending: true });
    }

    return await query.range(offset, offset + limit - 1);
  }

  // Try the cached mode; on missing-column error, retry — first by
  // disabling the external-link columns (the most recent addition), then
  // the diacritic-norm columns, then by falling back to the legacy schema.
  let result = await runQuery(schemaMode || 'new');
  if (
    result.error &&
    isMissingColumnError(result.error) &&
    (schemaMode || 'new') === 'new' &&
    hasExternalLinks !== false
  ) {
    hasExternalLinks = false;
    result = await runQuery('new');
  }
  if (
    result.error &&
    isMissingColumnError(result.error) &&
    (schemaMode || 'new') === 'new' &&
    hasNormalizedColumns !== false
  ) {
    // Missing column with new schema — likely the *_norm columns aren't
    // applied yet. Retry without them.
    hasNormalizedColumns = false;
    result = await runQuery('new');
  }
  if (result.error && isMissingColumnError(result.error) && (schemaMode || 'new') === 'new') {
    schemaMode = 'legacy';
    result = await runQuery('legacy');
  } else if (!result.error && schemaMode === null) {
    schemaMode = 'new';
    if (hasNormalizedColumns === null) hasNormalizedColumns = true;
    if (hasExternalLinks === null) hasExternalLinks = true;
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  // Loose-typed rows — Supabase's typed select() returns a union including a
  // GenericStringError variant which prevents us from spreading the cover URL
  // onto rows. The actual rows are plain catalog records.
  let works = (result.data || []) as unknown as Array<Record<string, unknown>>;

  // Title-prefix relevance bump (issue #1690).
  //
  // When the user has a simple search query (`q`), rows whose title *starts*
  // with the query should appear before rows where the query merely appears
  // somewhere else in the record. The underlying ordering (default: title A-Z)
  // is preserved within each group.
  //
  // Implementation: we re-sort the current page in JS using a stable sort that
  // keeps title-prefix matches first and falls back to the order Postgres
  // already returned. This avoids any Supabase schema changes (no view, no RPC).
  //
  // Limitation: this only re-orders the page that was fetched. If a perfect
  // prefix match sits on page 2 alphabetically, it will not be promoted to
  // page 1 — that would require a server-side computed-column sort or an RPC.
  // For BPH (a few thousand rows) the first page is what users see, so this
  // fix satisfies the partner complaint without infra changes.
  if (q.length >= 2 && works.length > 1) {
    const needle = q.toLocaleLowerCase();
    // Decorate-sort-undecorate to keep the comparator stable.
    const decorated = works.map((row, idx) => {
      const title = (row as { title?: string | null }).title || '';
      const prefixMatch = title.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
      return { row, idx, prefixMatch };
    });
    decorated.sort((a, b) => a.prefixMatch - b.prefixMatch || a.idx - b.idx);
    works = decorated.map((d) => d.row);
  }

  // Attach the SL book cover URL for rows that are linked to a Source Library
  // book. The grid view renders covers from this field; list view ignores it.
  // Best-effort: any MongoDB lookup error simply leaves rows without covers.
  const slBookIds = Array.from(
    new Set(
      works
        .map((w) => (w as { sl_book_id?: string | null }).sl_book_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  if (slBookIds.length > 0) {
    try {
      const db = await getReadDb();
      const books = await db
        .collection('books')
        .find(
          { id: { $in: slBookIds } },
          {
            projection: {
              id: 1,
              image_display: 1,
              image_thumb: 1,
              thumbnail: 1,
              thumbnail_blob: 1,
            },
            maxTimeMS: 8_000,
          },
        )
        .toArray();
      const coverById = new Map<string, string | null>();
      for (const b of books as unknown as Array<{
        id: string;
        image_display?: string | null;
        image_thumb?: string | null;
        thumbnail?: string | null;
        thumbnail_blob?: string | null;
      }>) {
        coverById.set(b.id, getBookThumbnailUrl(b, 'display'));
      }
      works = works.map((w) => {
        const row = w as { sl_book_id?: string | null };
        const id = row.sl_book_id;
        return id ? { ...row, sl_cover: coverById.get(id) ?? null } : w;
      });
    } catch {
      // Covers are decorative for list view and non-essential for grid;
      // skip silently rather than failing the catalogue query.
    }
  }

  return NextResponse.json({
    works,
    total: isPinnedDigitizedView ? BPH_DIGITIZED_PINNED_TOTAL : (result.count || 0),
    offset,
    limit,
    schemaMode: schemaMode || 'unknown',
  });
}
