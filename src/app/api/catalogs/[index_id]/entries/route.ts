import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

interface Entry {
  id: number;
  source_id: string | null;
  title: string;
  author: string | null;
  publication_date: string | null;
  condemnation_year: number | null;
  condemnation_period: string | null;
  scope: string | null;
  reason: string | null;
  ustc_sn: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
}

/**
 * Browseable list of entries on a banned-books reference index.
 * Issue #1851 — Phase 1 (Roman 1948).
 *
 * Query params:
 *   q          — title or author search (case-insensitive trigram match)
 *   filter     — 'held' (only SL-held entries) | 'unheld' (only acquisition targets) | 'all' (default)
 *   sort       — 'author' (default) | 'year' | 'condemned'
 *   page       — 1-indexed
 *   page_size  — default 50, max 200
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ index_id: string }> },
) {
  const { index_id } = await ctx.params;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const filter = url.searchParams.get('filter') || 'all';
  const sort = url.searchParams.get('sort') || 'author';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('page_size') || String(DEFAULT_PAGE_SIZE))));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('index_catalog_entries')
    .select(
      'id, source_id, title, author, publication_date, condemnation_year, condemnation_period, scope, reason, ustc_sn, sl_book_id, sl_book_slug',
      { count: 'exact' },
    )
    .eq('index_id', index_id);

  if (q.length >= 2) {
    // Sanitize for PostgREST `.or()` filter syntax
    const safe = q.replace(/[,()]/g, '');
    query = query.or(`title.ilike.*${safe}*,author.ilike.*${safe}*`);
  }
  if (filter === 'held') query = query.not('sl_book_id', 'is', null);
  else if (filter === 'unheld') query = query.is('sl_book_id', null);

  // Sort
  if (sort === 'year') query = query.order('publication_date', { ascending: true, nullsFirst: false });
  else if (sort === 'condemned') query = query.order('condemnation_year', { ascending: true, nullsFirst: false });
  else query = query.order('author', { ascending: true, nullsFirst: false }).order('title', { ascending: true });

  query = query.range(from, to);
  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    entries: (data || []) as Entry[],
    total: count ?? 0,
    page,
    page_size: pageSize,
    has_more: (count ?? 0) > to + 1,
  });
}
