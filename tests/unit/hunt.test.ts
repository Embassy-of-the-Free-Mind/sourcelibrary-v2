/**
 * The Trithemian hunt (#8150 slice 3): answers are checked against salted
 * hashes, progress is a token only we can sign, the solvers' list needs every
 * step, and the answer route asks the SHARED limiter. No real riddle or answer
 * appears here: the repo is public.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  normalizeAnswer,
  hashAnswer,
  answerMatches,
  encodeProgress,
  decodeProgress,
  withSolvedStep,
  isComplete,
  cleanSolverName,
} from '@/lib/hunt';
// The loader script hashes with its own copy of the reduction; the two must agree.
// @ts-expect-error untyped .mjs
import { normalizeAnswer as scriptNormalize, hashAnswer as scriptHash } from '../../scripts/maintenance/hunt-clues.mjs';

const limiter = vi.fn(async (..._a: unknown[]) => ({ allowed: true as const }) as { allowed: true } | { allowed: false; retryAfter: number });
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitShared: (...a: unknown[]) => limiter(...a),
  getClientIp: () => '203.0.113.7',
}));

const SALT = 'a1b2c3';
const clues: Record<number, Record<string, unknown>> = {
  1: { chain: 'trithemius', step: 1, total: 2, answer_salt: SALT, answer_hashes: [hashAnswer(SALT, 'Lantern')], target: { citation: 'Book A, p. 3', url: 'https://example.test/a' } },
  2: { chain: 'trithemius', step: 2, total: 2, payload: 'second riddle text', answer_salt: SALT, answer_hashes: [hashAnswer(SALT, 'Quill')] },
};
const inserted: unknown[] = [];
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: (name: string) => ({
      findOne: async (q: { step?: number }, opts?: { sort?: unknown }) =>
        name === 'hunt_clues' ? (opts?.sort ? clues[2] : clues[q.step ?? 0] ?? null) : null,
      insertOne: async (doc: { _id: string }) => {
        if (inserted.some((d) => (d as { _id: string })._id === doc._id)) throw Object.assign(new Error('dup'), { code: 11000 });
        inserted.push(doc);
      },
    }),
  }),
}));

type Handler = (r: Request) => Promise<Response>;
let answerPOST: Handler;
let solversPOST: Handler;
const post = (h: Handler, body: unknown) =>
  h(new Request('https://sourcelibrary.org/api/hunt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

beforeAll(async () => {
  process.env.PROVENANCE_SECRET_KEY = 'hunt-test-key';
  ({ POST: answerPOST } = (await import('@/app/api/hunt/answer/route')) as unknown as { POST: Handler });
  ({ POST: solversPOST } = (await import('@/app/api/hunt/solvers/route')) as unknown as { POST: Handler });
});
beforeEach(() => limiter.mockClear());

describe('answers', () => {
  it('ignores case, accents, spaces, punctuation and long s', () => {
    expect(normalizeAnswer('  Léon-Battista ')).toBe('leonbattista');
    expect(normalizeAnswer('ſteganographia')).toBe('steganographia');
    expect(normalizeAnswer('Cæsar')).toBe('caesar');
    expect(normalizeAnswer('15')).toBe('15');
  });
  it('the loader script reduces and hashes exactly as the route does', () => {
    for (const s of ['Léon-Battista', 'ſtella', 'Œuvre 15', 'x y z']) {
      expect(scriptNormalize(s)).toBe(normalizeAnswer(s));
      expect(scriptHash('salt', s)).toBe(hashAnswer('salt', s));
    }
  });
  it('matches any accepted answer and nothing else', () => {
    const clue = { answer_salt: 's', answer_hashes: [hashAnswer('s', 'one'), hashAnswer('s', 'uno')] };
    expect(answerMatches(clue, 'ONE')).toBe(true);
    expect(answerMatches(clue, 'u n o')).toBe(true);
    expect(answerMatches(clue, 'two')).toBe(false);
    expect(answerMatches(clue, '  ')).toBe(false);
    expect(answerMatches({ answer_salt: 's', answer_hashes: ['not-a-hash'] }, 'one')).toBe(false);
    expect(answerMatches({}, 'one')).toBe(false);
  });
});

describe('progress tokens', () => {
  it('round-trip, accumulate steps and keep one run id', () => {
    const a = withSolvedStep(null, 'trithemius', 2);
    const b = withSolvedStep(decodeProgress(encodeProgress(a)), 'trithemius', 1);
    expect(b.steps).toEqual([1, 2]);
    expect(b.run).toBe(a.run);
    expect(isComplete(b, 'trithemius', 2)).toBe(true);
    expect(isComplete(b, 'trithemius', 3)).toBe(false);
    expect(isComplete(b, 'other', 2)).toBe(false);
  });
  it('refuse a token whose steps were edited', () => {
    const t = encodeProgress(withSolvedStep(null, 'trithemius', 1))!;
    const [body, mac] = t.split('.');
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    o.s = [1, 2, 3, 4, 5, 6, 7];
    const forged = `${Buffer.from(JSON.stringify(o)).toString('base64url')}.${mac}`;
    expect(decodeProgress(forged)).toBeNull();
    expect(decodeProgress('garbage')).toBeNull();
    expect(decodeProgress(undefined)).toBeNull();
  });
});

describe('solver names', () => {
  it('accept names in any script and refuse links or markup', () => {
    expect(cleanSolverName('  Anna  Maria ')).toBe('Anna Maria');
    expect(cleanSolverName("O'Neill")).toBe("O'Neill");
    expect(cleanSolverName('李白')).toBe('李白');
    expect(cleanSolverName('see http://spam.example')).toBeNull();
    expect(cleanSolverName('<b>x</b>')).toBeNull();
    expect(cleanSolverName('x'.repeat(41))).toBeNull();
  });
});

describe('POST /api/hunt/answer', () => {
  it('a wrong answer says only that', async () => {
    const res = await post(answerPOST, { step: 1, answer: 'candle' });
    expect(await res.json()).toEqual({ correct: false });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('a right answer returns the next riddle, the page read and progress', async () => {
    const body = await (await post(answerPOST, { step: 1, answer: ' lantern ' })).json();
    expect(body.correct).toBe(true);
    expect(body.next).toEqual({ step: 2, riddle: 'second riddle text' });
    expect(body.read.citation).toBe('Book A, p. 3');
    expect(decodeProgress(body.progress)?.steps).toEqual([1]);
    expect(body.complete).toBe(false);
  });
  it('never returns another clue’s hashes or salt', async () => {
    const text = await (await post(answerPOST, { step: 1, answer: 'lantern' })).text();
    expect(text).not.toContain(SALT);
    expect(text).not.toContain(hashAnswer(SALT, 'Quill'));
  });
  it('asks the shared limiter, per minute and per day, and stops at its refusal', async () => {
    await post(answerPOST, { step: 1, answer: 'x' });
    expect(limiter.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(['hunt-answer', 'hunt-answer-day']);
    limiter.mockResolvedValueOnce({ allowed: false, retryAfter: 30 });
    const res = await post(answerPOST, { step: 1, answer: 'lantern' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });
  it('refuses a missing step or an empty answer', async () => {
    expect((await post(answerPOST, { answer: 'x' })).status).toBe(400);
    expect((await post(answerPOST, { step: 1, answer: ' ' })).status).toBe(400);
  });
});

describe('POST /api/hunt/solvers', () => {
  it('needs every step, signs once, and holds a name for approval', async () => {
    const one = encodeProgress(withSolvedStep(null, 'trithemius', 1));
    expect((await post(solversPOST, { progress: one })).status).toBe(403);

    const both = encodeProgress(withSolvedStep(decodeProgress(one), 'trithemius', 2));
    const ok = await post(solversPOST, { progress: both, name: 'Anna', show_name: true });
    expect(await ok.json()).toEqual({ signed: true, name_pending: true });
    expect(inserted.at(-1)).toMatchObject({ name: 'Anna', name_status: 'pending' });
    expect((await post(solversPOST, { progress: both })).status).toBe(409);
  });
  it('stores no name unless the solver ticks to show it', async () => {
    const p = encodeProgress(withSolvedStep(withSolvedStep(null, 'trithemius', 1), 'trithemius', 2));
    await post(solversPOST, { progress: p, name: 'Quiet', show_name: false });
    expect(inserted.at(-1)).toMatchObject({ name: null, name_status: null });
  });
});
