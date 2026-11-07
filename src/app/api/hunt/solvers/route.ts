/**
 * POST /api/hunt/solvers — sign the solvers' list (#8150 slice 3).
 *
 * Body: { progress: string, name?: string, show_name?: boolean, chain?: string }.
 * The progress token must prove every step of the chain. One signature per run.
 *
 * A name is never published by default (safe-defaults.md): it is stored only
 * when the solver ticks "show my name", and it waits for a librarian to approve
 * it (scripts/maintenance/hunt-clues.mjs approve). Until then, and without a
 * name, the list shows the solve with its date and nothing else. We keep no IP
 * address or account with the row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { getDb } from '@/lib/mongodb';
import { HUNT_CLUES_COLLECTION } from '@/lib/hunt-payloads';
import { cleanSolverName, decodeProgress, isComplete, DEFAULT_CHAIN, HUNT_SOLVERS_COLLECTION } from '@/lib/hunt';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { name: 'hunt-solvers', limit: 5, windowSeconds: 600 };
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimitShared(RATE_LIMIT, getClientIp(request));
  if (!rl.allowed) return json({ error: 'Too many requests. Try again later.' }, 429, { 'Retry-After': String(rl.retryAfter) });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  const chain = typeof body.chain === 'string' && /^[a-z0-9-]{1,40}$/.test(body.chain) ? body.chain : DEFAULT_CHAIN;
  const progress = decodeProgress(body.progress);
  if (!progress) return json({ error: 'That progress could not be read. Solve the riddles on this device first.' }, 400);

  const showName = body.show_name === true;
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const name = showName && rawName ? cleanSolverName(rawName) : null;
  if (showName && rawName && !name) {
    return json({ error: 'Use letters and spaces only, at most 40 characters.' }, 400);
  }

  const db = await getDb();
  const last = await db
    .collection(HUNT_CLUES_COLLECTION)
    .findOne({ chain, active: true }, { sort: { step: -1 }, projection: { _id: 0, step: 1, total: 1 } });
  const total = Number(last?.total) || Number(last?.step) || 0;
  if (!isComplete(progress, chain, total)) return json({ error: 'Every riddle has to be solved before you can sign.' }, 403);

  try {
    await db.collection(HUNT_SOLVERS_COLLECTION).insertOne({
      _id: `${chain}:${progress.run}` as unknown as never,
      chain,
      started_at: new Date(progress.started),
      finished_at: new Date(),
      name,
      name_status: name ? 'pending' : null,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return json({ error: 'This solve is already on the list.' }, 409);
    throw err;
  }
  return json({ signed: true, name_pending: Boolean(name) });
}
