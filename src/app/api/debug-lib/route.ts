import { NextRequest, NextResponse } from 'next/server';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

// TEMP: run each library-page query separately to find which one throws.
export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get('provider') || 'internet_archive';
  const out: Record<string, unknown> = {};
  const t = async (label: string, fn: () => Promise<unknown>) => {
    const start = Date.now();
    try { const r = await fn(); out[label] = { ms: Date.now() - start, ok: true, sample: JSON.stringify(r).slice(0, 120) }; }
    catch (e) { out[label] = { ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) }; }
  };
  await t('mainGrid', () => browseBooks({ provider, hasPages: false, sort: 'popular', offset: 0, limit: 60 } as Parameters<typeof browseBooks>[0]).then(r => ({ rows: r.books.length, total: r.total })));
  await t('sample', () => browseBooks({ provider, hasPages: false, sort: 'popular', limit: 50 } as Parameters<typeof browseBooks>[0]).then(r => ({ rows: r.books.length })));
  await t('languages', () => getLanguageCounts({ provider }).then(r => ({ n: r.length })));
  await t('contrib', () => supabase.from('books_catalog').select('contributing_library').eq('visible', true).eq('image_source_provider', provider).gt('pages_count', 0).gt('pages_translated', 0).not('contributing_library', 'is', null).then(r => ({ rows: (r.data || []).length, err: r.error?.message })));
  return NextResponse.json({ provider, ...out });
}
