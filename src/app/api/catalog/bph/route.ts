import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q') || '';
  const keyword = sp.get('keyword') || '';
  const sort = sp.get('sort') || 'title';
  const offset = Math.max(0, parseInt(sp.get('offset') || '0') || 0);
  const digitized = sp.get('digitized'); // 'true' | 'false' | null

  let query = supabase
    .from('bph_works')
    .select('ubn, title, author, year, shelf_mark, keywords, ia_identifier, ustc_sn, place, publisher, printer', { count: 'exact' });

  // Text search
  if (q.length >= 2) {
    query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%,shelf_mark.ilike.%${q}%`);
  }

  // Keyword filter
  if (keyword) {
    query = query.eq('keywords', keyword);
  }

  // Digitized filter
  if (digitized === 'true') {
    query = query.not('ia_identifier', 'is', null);
  } else if (digitized === 'false') {
    query = query.is('ia_identifier', null);
  }

  // Sort
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

  query = query.range(offset, offset + PER_PAGE - 1);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ works: data || [], total: count || 0 });
}
