import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { applyBphFilters, readBphFilters, isUnfiltered } from '@/lib/bph-catalog-filters';
import { getReadDb } from '@/lib/mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';
import { logSearchEvent } from '@/lib/search-event-log';
import { resolveTenantId } from '@/lib/tenant-context';

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
  // Memorix issues no UBN for manuscripts or photographs — 2,012 rows, every
  // `Fot` record and 442 `M ` manuscripts among them. `uuid` is the only key
  // they have, and without it the browser can build no detail link at all, so
  // they rendered as dead plain text (José Bouman 2026-07-31, Natalie Koch
  // 2026-08-05). `full_title` is where manuscript records keep their title;
  // `title` is null on all 812 of them.
  'uuid', 'full_title',
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
// Tracks whether the denormalised `is_first_translation` column from
// add-bph-first-translation.sql has been applied. Auto-detected on first
// error so a runtime that boots before the migration runs degrades to
// "filter returns nothing" rather than erroring the whole catalogue query.
let hasFirstTranslationColumn: boolean | null = null;
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

  // Filters + sort are parsed and applied by the shared module the CSV export
  // also uses, so the two surfaces can never diverge.
  const filters = readBphFilters(sp);
  const {
    q, firstTranslation, sort, language, yearFrom, yearTo, digitized,
    author, title, place, printer, publisher, editor, keyword, shelfMark, provenance,
  } = filters;

  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || String(PER_PAGE), 10) || PER_PAGE));

  // Default unfiltered "digitised on Source Library" view: skip the COUNT(*)
  // and return the pinned 2,222. Any filter / search / advanced field falls
  // through to the normal exact-count path.
  const isPinnedDigitizedView = filters.digitized === 'sl' && isUnfiltered(filters);

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

    // Every user-facing filter and the sort live in src/lib/bph-catalog-filters.ts,
    // shared with the CSV export route so the two can never match different
    // sets. Schema-mode fallbacks stay here — they are about what the database
    // can answer, not about what the user asked for.
    query = applyBphFilters(query, filters, {
      mode,
      hasNormalizedColumns: hasNormalizedColumns !== false,
      hasFirstTranslationColumn: hasFirstTranslationColumn !== false,
    });

    return await query.range(offset, offset + limit - 1);
  }

  // Try the cached mode; on missing-column error, retry — first by
  // disabling the first-translation column (newest addition), then the
  // external-link columns, then the diacritic-norm columns, then by
  // falling back to the legacy schema.
  let result = await runQuery(schemaMode || 'new');
  if (
    result.error &&
    isMissingColumnError(result.error) &&
    (schemaMode || 'new') === 'new' &&
    firstTranslation &&
    hasFirstTranslationColumn !== false
  ) {
    hasFirstTranslationColumn = false;
    result = await runQuery('new');
  }
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
    if (hasFirstTranslationColumn === null) hasFirstTranslationColumn = true;
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
  // Gated on `sort === 'title'`: when the user has explicitly clicked a
  // different sort header (Author, Year, Shelfmark, or any *_desc variant),
  // respect their order without re-ordering by prefix relevance. Without
  // this gate, `cq=X&sort=title_desc` ended up identical to `cq=X&sort=title`
  // because the bump held prefix matches at the top regardless of direction
  // (cowork test pass, 2026-05-28 — step A7).
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
  if (q.length >= 2 && works.length > 1 && sort === 'title') {
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

  const total = isPinnedDigitizedView ? BPH_DIGITIZED_PINNED_TOTAL : (result.count || 0);

  // Record the search. This route is the BPH reading room's front-page search
  // box — the first thing a visitor sees — and until #3483 it logged nothing at
  // all, which made "how much do readers search here?" unanswerable.
  //
  // Two deliberate exclusions, so the count means "searches" and not "requests":
  //   - a request carrying no query and no advanced field is *browsing* the
  //     catalogue (or paging through it), not searching;
  //   - only `offset === 0` is logged, so paginating deeper into one result set
  //     stays one search rather than N.
  // Both matter because this number will be read as a rate against reading-room
  // pageviews; inflating the numerator would repeat the error this fixes.
  const advancedTerms = { author, title, place, printer, publisher, editor, keyword, shelfMark, provenance };
  const hasSearchTerm = !!q || Object.values(advancedTerms).some(Boolean);
  if (hasSearchTerm && offset === 0) {
    // Resolved inside the fire-and-forget path so neither the tenant lookup
    // (cached, but still async) nor the insert sits on the response path.
    void resolveTenantId('bph')
      .then((tenantId) => {
        logSearchEvent({
          request: req,
          // The simple search box is `q`; an advanced-only search has no `q`,
          // so fall back to the field that was actually filled in.
          query: q || Object.values(advancedTerms).find(Boolean) || '',
          resultsCount: total,
          source: 'catalogue',
          tenantId,
          filters: {
            ...Object.fromEntries(Object.entries(advancedTerms).filter(([, v]) => v)),
            language: language || null,
            yearFrom,
            yearTo,
            digitized,
            first_translation: firstTranslation || null,
            sort,
            // Distinguishes "typed in the simple box" from "used the advanced
            // form" — they are different behaviours and worth telling apart.
            advanced: !q,
          },
        });
      })
      .catch(() => {});
  }

  return NextResponse.json({
    works,
    total,
    offset,
    limit,
    schemaMode: schemaMode || 'unknown',
  });
}
