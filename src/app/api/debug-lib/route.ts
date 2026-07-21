import { NextRequest, NextResponse } from 'next/server';
import { browseBooks } from '@/lib/books-catalog';

export const runtime = 'nodejs';

// TEMPORARY diagnostic for the empty library-page grid. Returns row/count only.
export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get('provider') || 'internet_archive';
  const out: Record<string, unknown> = {};
  const run = async (label: string, opts: Parameters<typeof browseBooks>[0]) => {
    try {
      const r = await browseBooks(opts);
      out[label] = { rows: r.books.length, total: r.total };
    } catch (e) {
      out[label] = { error: e instanceof Error ? e.message : String(e) };
    }
  };
  await run('exact', { provider, hasTranslation: true, sort: 'popular', offset: 0, limit: 60, exactCount: true } as Parameters<typeof browseBooks>[0]);
  await run('estimated', { provider, hasTranslation: true, sort: 'popular', offset: 0, limit: 60 } as Parameters<typeof browseBooks>[0]);
  await run('noTrans_est', { provider, sort: 'popular', offset: 0, limit: 60 } as Parameters<typeof browseBooks>[0]);
  await run('sample', { provider, hasTranslation: true, sort: 'popular', limit: 50 } as Parameters<typeof browseBooks>[0]);
  return NextResponse.json({ provider, ...out });
}
