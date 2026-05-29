import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';

export const preferredRegion = 'fra1';

interface ThumbVote {
  column: 'current' | 'new';
  result_id: string;
  book_id: string;
  page_number?: number;
  vote: 1 | -1;
}

// POST /api/search/compare/vote
// Anonymous, aggregate preference capture for the librarian compare page.
// Body: { tenant, query, winner: 'current'|'new'|'tie', note?, thumbs: ThumbVote[] }
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantSlug = String(body?.tenant || '').trim();
  const query = String(body?.query || '').trim();
  const winner = body?.winner;
  if (!tenantSlug || !query || !['current', 'new', 'tie'].includes(winner)) {
    return NextResponse.json({ error: 'tenant, query, and a valid winner are required' }, { status: 400 });
  }
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) {
    return NextResponse.json({ error: `Unknown tenant: ${tenantSlug}` }, { status: 404 });
  }

  const thumbs: ThumbVote[] = Array.isArray(body?.thumbs)
    ? body.thumbs
        .filter((t: any) => (t?.column === 'current' || t?.column === 'new') && (t?.vote === 1 || t?.vote === -1) && t?.result_id)
        .slice(0, 60) // sanity cap
        .map((t: any) => ({
          column: t.column, result_id: String(t.result_id), book_id: String(t.book_id || ''),
          page_number: typeof t.page_number === 'number' ? t.page_number : undefined, vote: t.vote,
        }))
    : [];

  const db = await getDb();
  await db.collection('search_compare_votes').insertOne({
    tenant: tenantSlug,
    tenantId,
    query,
    winner,                                    // which ranking the librarian preferred
    note: typeof body?.note === 'string' ? body.note.slice(0, 1000) : undefined,
    thumbs,
    ua: request.headers.get('user-agent')?.slice(0, 300) || undefined,
    created_at: new Date(),
  });

  return NextResponse.json({ ok: true });
}
