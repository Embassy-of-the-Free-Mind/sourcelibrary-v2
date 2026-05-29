import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

// POST /api/search/click — records which search result a user clicked.
// Closes the search measurement loop: paired with `search_query` events it
// yields click-through rate, mean clicked-rank, and zero-click (abandoned)
// rate, broken down by ranking strategy (auto-rrf / auto-ladder / ladder…).
// Anonymous + fire-and-forget (sent via navigator.sendBeacon), so it stays off
// the navigation critical path. Mirrors the existing analytics_events shape.
export async function POST(request: NextRequest) {
  let b: any;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const query = String(b?.query || '').trim().slice(0, 300);
  if (!query) return NextResponse.json({ ok: false }, { status: 400 });

  try {
    const db = await getDb();
    await db.collection('analytics_events').insertOne({
      event: 'search_result_click',
      query,
      ranking: typeof b?.ranking === 'string' ? b.ranking.slice(0, 40) : null, // e.g. auto-rrf:conceptual
      slug: typeof b?.slug === 'string' ? b.slug.slice(0, 200) : undefined,
      page_number: typeof b?.page_number === 'number' ? b.page_number : undefined,
      rank: typeof b?.rank === 'number' ? b.rank : undefined,                   // 1-based position, if known
      view: typeof b?.view === 'string' ? b.view.slice(0, 20) : undefined,      // all | books | index | images
      total: typeof b?.total === 'number' ? b.total : undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      created_at: new Date(),
    });
  } catch {
    // Telemetry must never break the click — swallow and move on.
  }
  return NextResponse.json({ ok: true });
}
