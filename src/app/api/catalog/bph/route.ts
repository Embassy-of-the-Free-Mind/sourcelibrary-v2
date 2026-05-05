import { NextRequest, NextResponse } from 'next/server';
import { supabase, sanitizeFilterValue } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

// Fields exposed to the public catalog UI.
const PUBLIC_FIELDS = [
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // Simple search — searches all fields via tsvector.
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

  // Year range (USTC-style).
  const yearFrom = sp.get('yearFrom') ? parseInt(sp.get('yearFrom')!, 10) : null;
  const yearTo = sp.get('yearTo') ? parseInt(sp.get('yearTo')!, 10) : null;

  // Filters.
  const digitized = sp.get('digitized'); // 'true' | 'false' | 'sl' | null

  const sort = sp.get('sort') || 'title';
  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || String(PER_PAGE), 10) || PER_PAGE));

  let query = supabase
    .from('bph_works')
    .select(PUBLIC_FIELDS, { count: 'exact' });

  // Simple search — full-text across all fields.
  if (q.length >= 2) {
    const safe = sanitizeFilterValue(q);
    // Quote each token, join with & for AND-match in plainto_tsquery semantics.
    // websearch_to_tsquery handles user input safely (quotes, OR, -word).
    query = query.textSearch('search_tsv', safe, { type: 'websearch', config: 'simple' });
  }

  // Per-field ilike filters (advanced search).
  // Each filter is treated as a substring match for resilience to spelling/spacing variants.
  const ilikeFilter = (col: string, val: string) => {
    if (!val) return;
    // Match either the standard column or its variant counterpart.
    const safe = sanitizeFilterValue(val);
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
  };
  ilikeFilter('author', author);
  ilikeFilter('title', title);
  ilikeFilter('editor', editor);
  ilikeFilter('place', place);
  ilikeFilter('printer', printer);
  ilikeFilter('publisher', publisher);
  ilikeFilter('shelf_mark', shelfMark);

  if (keyword) query = query.eq('keywords', keyword);
  if (language) query = query.eq('language', language);
  if (provenance) query = query.eq('provenance', provenance);

  // Year range.
  if (yearFrom !== null && !Number.isNaN(yearFrom)) query = query.gte('year', yearFrom);
  if (yearTo !== null && !Number.isNaN(yearTo)) query = query.lte('year', yearTo);

  // Digitization filters.
  //   true → has any digitized link (Source Library OR Internet Archive)
  //   sl   → digitized on Source Library specifically
  //   false → not digitized anywhere
  if (digitized === 'true') {
    query = query.or('sl_book_id.not.is.null,ia_identifier.not.is.null');
  } else if (digitized === 'sl') {
    query = query.not('sl_book_id', 'is', null);
  } else if (digitized === 'false') {
    query = query.is('sl_book_id', null).is('ia_identifier', null);
  }

  // Sort.
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

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    works: data || [],
    total: count || 0,
    offset,
    limit,
  });
}
