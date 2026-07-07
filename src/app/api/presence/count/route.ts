/**
 * Live reader count — GET /api/presence/count
 *
 * Returns the aggregate presence snapshot for the "N people are reading right
 * now" line (issue #3059):
 *   { count: number, titles: string[] }
 *
 * `count` is distinct anonymous visitors active in the last ~2 min. `titles`
 * is a small sample of visible-book titles open right now (empty below a
 * small floor so a lone reader isn't singled out). Never exposes who.
 *
 * Cached briefly so it doesn't hammer Mongo — the number only needs to feel
 * live, not tick every request.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getPresenceSnapshot } from '@/lib/presence';

export async function GET() {
  try {
    const db = await getDb();
    const snapshot = await getPresenceSnapshot(db);
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=45' },
    });
  } catch {
    // A count failure should degrade to "hidden", never error the page.
    return NextResponse.json(
      { count: 0, titles: [] },
      { headers: { 'Cache-Control': 'public, max-age=15' } }
    );
  }
}
