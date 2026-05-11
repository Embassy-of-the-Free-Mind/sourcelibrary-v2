import { NextRequest, NextResponse } from 'next/server';
import { supabase, sanitizeFilterValue } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

// New (expanded) field set — requires expand-bph-works-schema.sql to have been run.
const FIELDS_NEW = [
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
].join(', ');

// Legacy field set — works against the original 11-column bph_works schema.
const FIELDS_LEGACY = 'ubn, title, author, year, shelf_mark, keywords, ia_identifier, ustc_sn, place, publisher, printer';

// Cache the schema mode for the lifetime of the runtime.
let schemaMode: 'new' | 'legacy' | null = null;

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

  const sort = sp.get('sort') || 'title';
  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || String(PER_PAGE), 10) || PER_PAGE));

  // Run the query in the requested mode. Returns the supabase result object.
  async function runQuery(mode: 'new' | 'legacy') {
    const fields = mode === 'new' ? FIELDS_NEW : FIELDS_LEGACY;
    let query = supabase.from('bph_works').select(fields, { count: 'exact' });

    // Simple search.
    if (q.length >= 2) {
      const safe = sanitizeFilterValue(q);
      if (mode === 'new') {
        // Full-text across all fields.
        query = query.textSearch('search_tsv', safe, { type: 'websearch', config: 'simple' });
      } else {
        query = query.or(`title.ilike.%${safe}%,author.ilike.%${safe}%,shelf_mark.ilike.%${safe}%`);
      }
    }

    const ilikeFilter = (col: string, val: string) => {
      if (!val) return;
      const safe = sanitizeFilterValue(val);
      if (mode === 'new') {
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
    } else if (digitized === 'false') {
      if (mode === 'new') {
        query = query.is('sl_book_id', null).is('ia_identifier', null);
      } else {
        query = query.is('ia_identifier', null);
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

  // Try the cached mode; on missing-column error, retry in legacy and remember.
  let result = await runQuery(schemaMode || 'new');
  if (result.error && isMissingColumnError(result.error) && (schemaMode || 'new') === 'new') {
    schemaMode = 'legacy';
    result = await runQuery('legacy');
  } else if (!result.error && schemaMode === null) {
    schemaMode = 'new';
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  let works = result.data || [];

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

  return NextResponse.json({
    works,
    total: result.count || 0,
    offset,
    limit,
    schemaMode: schemaMode || 'unknown',
  });
}
