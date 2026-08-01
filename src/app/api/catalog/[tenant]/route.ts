// Generic per-tenant catalogue API. Reads from the unified
// `library_catalog_records` table filtered by `tenant_id`.
//
// The legacy BPH route at /api/catalog/bph still reads from `bph_works` (its
// own table with normalised search columns + a pinned digitised counter) and
// continues to serve the EFM Webflow embed. Next.js prefers the static
// `/api/catalog/bph` route for that path; everything else falls through here.

import { NextRequest, NextResponse } from 'next/server';
import { supabase, sanitizeFilterValue } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

const FIELDS = [
  'catalog_id',
  'title', 'parallel_title', 'uniform_title',
  'author', 'variant_author', 'pseudonym',
  'editor', 'variant_editor',
  'place', 'printer', 'publisher', 'variant_printer', 'variant_publisher',
  'year', 'year_text',
  'shelf_mark', 'state_shelf_mark', 'present_location',
  'keywords', 'language',
  'series_title', 'volume_title',
  'bibliography', 'remarks',
  'number_of_copies', 'object_size_cm', 'binding', 'bound_with',
  'provenance', 'thumbnail', 'file_count',
  'sl_book_id', 'sl_book_slug',
  'sl_external_book_id', 'sl_external_slug', 'sl_external_source',
  'ia_identifier', 'ustc_sn',
  'metadata',
].join(', ');

interface RouteContext {
  params: Promise<{ tenant: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { tenant } = await params;
  if (!tenant) {
    return NextResponse.json({ error: 'Missing tenant' }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;

  const q = sp.get('q')?.trim() || '';

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

  let query = supabase
    .from('library_catalog_records')
    .select(FIELDS, { count: 'exact' })
    .eq('tenant_id', tenant);

  if (q.length >= 2) {
    const safe = sanitizeFilterValue(q);
    // Every public field on the record, not just the title/author block. A
    // librarian searching by catalogue number, shelf location or a phrase from
    // the remarks got silence before — the same gap José Bouman hit on the BPH
    // catalogue (see expand-bph-search-norm.sql for the equivalent there).
    // `library_catalog_records` holds no staff-only columns, so "every field"
    // is literally safe here; if one is ever added, it must NOT be listed.
    // The table is ~1.6K rows, so the un-indexed ILIKE chain is cheap.
    const searchCols = [
      'catalog_id',
      'title', 'parallel_title', 'uniform_title', 'series_title', 'volume_title',
      'author', 'variant_author', 'pseudonym', 'editor', 'variant_editor',
      'place', 'printer', 'publisher', 'variant_printer', 'variant_publisher',
      'year_text',
      'shelf_mark', 'state_shelf_mark', 'present_location', 'provenance',
      'keywords', 'language',
      'binding', 'bound_with', 'object_size_cm',
      'bibliography', 'remarks',
      'ia_identifier',
    ];
    const ors = searchCols.map((c) => `${c}.ilike.%${safe}%`);
    // ustc_sn is an integer column — ILIKE would be a type error, so match it
    // exactly and only when the query is all digits.
    if (/^\d+$/.test(q)) ors.push(`ustc_sn.eq.${q}`);
    query = query.or(ors.join(','));
  }

  const ilikeFilter = (val: string, columns: string[]) => {
    if (!val) return;
    const safe = sanitizeFilterValue(val);
    if (columns.length === 1) {
      query = query.ilike(columns[0], `%${safe}%`);
    } else {
      query = query.or(columns.map(c => `${c}.ilike.%${safe}%`).join(','));
    }
  };

  ilikeFilter(author, ['author', 'variant_author', 'pseudonym']);
  ilikeFilter(title, ['title', 'parallel_title', 'uniform_title']);
  ilikeFilter(editor, ['editor', 'variant_editor']);
  ilikeFilter(place, ['place']);
  ilikeFilter(printer, ['printer', 'variant_printer']);
  ilikeFilter(publisher, ['publisher', 'variant_publisher']);
  ilikeFilter(shelfMark, ['shelf_mark', 'state_shelf_mark']);
  ilikeFilter(language, ['language']);
  ilikeFilter(provenance, ['provenance']);
  if (keyword) {
    const safe = sanitizeFilterValue(keyword);
    query = query.ilike('keywords', `%${safe}%`);
  }

  if (yearFrom !== null && !Number.isNaN(yearFrom)) query = query.gte('year', yearFrom);
  if (yearTo !== null && !Number.isNaN(yearTo)) query = query.lte('year', yearTo);

  if (digitized === 'true') {
    query = query.or('sl_book_id.not.is.null,ia_identifier.not.is.null,sl_external_book_id.not.is.null');
  } else if (digitized === 'sl') {
    query = query.not('sl_book_id', 'is', null);
  } else if (digitized === 'false') {
    query = query
      .is('sl_book_id', null)
      .is('ia_identifier', null)
      .is('sl_external_book_id', null);
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

  const result = await query.range(offset, offset + limit - 1);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  let works = (result.data || []) as unknown as Array<Record<string, unknown>>;

  // Title-prefix relevance bump (matches BPH route #1690): when there's a
  // simple search query, rows whose title *starts* with the needle bubble to
  // the top of the current page. Stable within each group; only re-orders
  // the fetched page, not the global result set.
  if (q.length >= 2 && works.length > 1) {
    const needle = q.toLocaleLowerCase();
    const decorated = works.map((row, idx) => {
      const t = (row as { title?: string | null }).title || '';
      const prefixMatch = t.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
      return { row, idx, prefixMatch };
    });
    decorated.sort((a, b) => a.prefixMatch - b.prefixMatch || a.idx - b.idx);
    works = decorated.map(d => d.row);
  }

  // Attach SL cover URL for rows linked to a digitised book. Best-effort:
  // any Mongo error leaves rows without covers (grid view degrades to icons).
  const slBookIds = Array.from(
    new Set(
      works
        .map(w => (w as { sl_book_id?: string | null }).sl_book_id)
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
      works = works.map(w => {
        const row = w as { sl_book_id?: string | null };
        const id = row.sl_book_id;
        return id ? { ...row, sl_cover: coverById.get(id) ?? null } : w;
      });
    } catch {
      // Covers are decorative; skip silently.
    }
  }

  return NextResponse.json({
    works,
    total: result.count || 0,
    offset,
    limit,
    tenant,
  });
}
