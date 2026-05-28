import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

interface Work {
  work_key: string;
  author: string | null;
  title: string;
  scope: string | null;
  author_normalized: string;
  edition_ids: string[];
  edition_count: number;
  first_year: number | null;
  last_year: number | null;
  ustc_sn: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  author_held_count: number | null;
  author_held_sample_slug: string | null;
  author_held_sample_id: string | null;
}

/**
 * Cross-edition deduplicated banned-works browser. Issue #1851.
 *
 * Query params:
 *   collection      — collection_slug (e.g., 'index-librorum-prohibitorum'),
 *                     joined to index_catalogs to scope which editions count
 *   q               — title or author search (>= 2 chars)
 *   editions        — comma-separated list of index_ids to filter by
 *   filter_mode     — 'any' (default) or 'all'
 *   filter          — 'held' (only SL-linked) | 'unheld' (acquisition gaps) | 'author_held' (we hold author, not exact work) | 'all'
 *   sort            — 'author' (default) | 'first_year' | 'edition_count' (desc)
 *   page, page_size — pagination
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const collection = url.searchParams.get('collection') || 'index-librorum-prohibitorum';
  const q = (url.searchParams.get('q') || '').trim();
  const editionsParam = (url.searchParams.get('editions') || '').trim();
  const filterMode = url.searchParams.get('filter_mode') === 'all' ? 'all' : 'any';
  const filter = url.searchParams.get('filter') || 'all';
  const sort = url.searchParams.get('sort') || 'author';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('page_size') || '50')));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Resolve which index_ids belong to the collection
  const { data: catalogRows } = await supabase
    .from('index_catalogs')
    .select('id')
    .eq('collection_slug', collection);
  const collectionIndexIds = (catalogRows || []).map(r => r.id);
  if (collectionIndexIds.length === 0) {
    return NextResponse.json({ works: [], total: 0, page, page_size: pageSize, editions: [] });
  }

  // Resolve the editions filter — defaults to all editions in this collection
  const selectedEditions = editionsParam
    ? editionsParam.split(',').filter(id => collectionIndexIds.includes(id))
    : collectionIndexIds;

  let query = supabase
    .from('v_index_catalog_works')
    .select('*', { count: 'exact' });

  // Edition filter — works whose edition_ids array OVERLAPS (any) or CONTAINS (all) the selection
  if (selectedEditions.length > 0) {
    if (filterMode === 'all') {
      query = query.contains('edition_ids', selectedEditions);
    } else {
      query = query.overlaps('edition_ids', selectedEditions);
    }
  }

  // Search
  if (q.length >= 2) {
    const safe = q.replace(/[,()]/g, '');
    query = query.or(`title.ilike.*${safe}*,author.ilike.*${safe}*`);
  }

  // SL filter
  if (filter === 'held') query = query.not('sl_book_id', 'is', null);
  else if (filter === 'unheld') query = query.is('sl_book_id', null).or('author_held_count.is.null,author_held_count.eq.0');
  else if (filter === 'author_held') query = query.is('sl_book_id', null).gt('author_held_count', 0);

  // Sort
  if (sort === 'first_year') query = query.order('first_year', { ascending: true, nullsFirst: false });
  else if (sort === 'edition_count') query = query.order('edition_count', { ascending: false });
  else query = query.order('author', { ascending: true, nullsFirst: false }).order('title', { ascending: true });

  query = query.range(from, to);
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    works: (data || []) as Work[],
    total: count ?? 0,
    page,
    page_size: pageSize,
    has_more: (count ?? 0) > to + 1,
    editions: collectionIndexIds,
  });
}
