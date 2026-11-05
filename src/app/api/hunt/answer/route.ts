/**
 * POST /api/hunt/answer — check an answer to one riddle of the hunt (#8150 slice 3).
 *
 * Body: { step: number, answer: string, progress?: string, chain?: string }.
 * A right answer returns the next riddle, the page the reader has just read
 * (its citation), and a new progress token. A wrong one returns
 * { correct: false } and nothing else.
 *
 * Answers are short words, so this route is a guessing oracle. The shared
 * (Mongo-backed) limiter holds it to a human pace across every serverless
 * instance; the in-memory one would count per lambda and let a script through.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { getDb } from '@/lib/mongodb';
import { HUNT_CLUES_COLLECTION } from '@/lib/hunt-payloads';
import { answerMatches, decodeProgress, encodeProgress, withSolvedStep, isComplete, DEFAULT_CHAIN, MAX_STEPS } from '@/lib/hunt';

export const dynamic = 'force-dynamic';

const PER_MINUTE = { name: 'hunt-answer', limit: 10, windowSeconds: 60 };
const PER_DAY = { name: 'hunt-answer-day', limit: 200, windowSeconds: 86400 };
const NO_STORE = { 'Cache-Control': 'private, no-store' };

interface ClueRow {
  chain: string;
  step: number;
  total?: number;
  payload?: string;
  answer_salt?: string;
  answer_hashes?: string[];
  target?: { citation?: string; url?: string };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  for (const cfg of [PER_MINUTE, PER_DAY]) {
    const rl = await checkRateLimitShared(cfg, ip);
    if (!rl.allowed) {
      return json({ error: 'Too many answers for now. Take a break and come back.' }, 429, { 'Retry-After': String(rl.retryAfter) });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return json({ error: 'Send JSON: {"step": 1, "answer": "..."}' }, 400);
  }
  const chain = typeof body.chain === 'string' && /^[a-z0-9-]{1,40}$/.test(body.chain) ? body.chain : DEFAULT_CHAIN;
  const step = Number(body.step);
  const answer = typeof body.answer === 'string' ? body.answer : '';
  if (!Number.isInteger(step) || step < 1 || step > MAX_STEPS) return json({ error: 'Choose which riddle you are answering.' }, 400);
  if (!answer.trim() || answer.length > 120) return json({ error: 'Type an answer of a word or two.' }, 400);
  if (!process.env.PROVENANCE_SECRET_KEY) return json({ error: 'The hunt is closed right now.' }, 503);

  const clues = (await getDb()).collection<ClueRow>(HUNT_CLUES_COLLECTION);
  const clue = await clues.findOne(
    { chain, step, active: true },
    { projection: { _id: 0, chain: 1, step: 1, total: 1, answer_salt: 1, answer_hashes: 1, target: 1 } },
  );
  if (!clue) return json({ error: 'There is no such riddle.' }, 404);
  if (!answerMatches(clue, answer)) return json({ correct: false });

  const total = Number(clue.total) || step;
  const progress = withSolvedStep(decodeProgress(body.progress), chain, step);
  const next =
    step < total
      ? await clues.findOne({ chain, step: step + 1, active: true }, { projection: { _id: 0, step: 1, payload: 1 } })
      : null;

  return json({
    correct: true,
    chain,
    step,
    total,
    read: clue.target?.citation ? { citation: clue.target.citation, url: clue.target.url ?? null } : null,
    next: next?.payload ? { step: next.step, riddle: next.payload } : null,
    solved: progress.steps,
    complete: isComplete(progress, chain, total),
    progress: encodeProgress(progress),
  });
}
