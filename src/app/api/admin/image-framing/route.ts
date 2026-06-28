import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb, getReadDb } from '@/lib/mongodb';

const CONFIG_ID = 'image_framing';

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// GET ?slot=... → { x, y, scale } | null  (admin only; the public page reads
// the same system_config doc server-side directly.)
export const GET = withAdminAuth(async (request: NextRequest) => {
  const slot = new URL(request.url).searchParams.get('slot');
  if (!slot) return NextResponse.json({ error: 'Missing slot' }, { status: 400 });
  const db = await getReadDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await db.collection('system_config').findOne({ _id: CONFIG_ID } as any);
  const framing = (doc?.slots as Record<string, unknown> | undefined)?.[slot] ?? null;
  return NextResponse.json({ slot, framing });
});

// POST { slot, x, y, scale } → upsert framing for that slot.
export const POST = withAdminAuth(async (request: NextRequest) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const slot = typeof body.slot === 'string' ? body.slot : '';
  if (!slot) return NextResponse.json({ error: 'Missing slot' }, { status: 400 });

  const framing = {
    x: clampNum(body.x, 0, 100, 50),
    y: clampNum(body.y, 0, 100, 50),
    scale: clampNum(body.scale, 1, 4, 1),
  };

  const db = await getDb();
  await db.collection('system_config').updateOne(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { _id: CONFIG_ID } as any,
    { $set: { [`slots.${slot}`]: framing, updated_at: new Date().toISOString() } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, slot, framing });
});
