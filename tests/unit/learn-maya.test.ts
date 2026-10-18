import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixtures from '../fixtures/learn-maya-items-6921.json';
import {
  CHECK_EVERY,
  asksVerdict,
  showSenses,
  studyCardFor,
  type StudyCard,
  checkDue,
  emptyState,
  gradeAnswer,
  needsExpert,
  nextItem,
  recordAttempt,
  validateJudgement,
  type MayaItem,
} from '@/lib/learn-maya';

/**
 * /learn/maya (#6921). Fixtures are five real items as built by
 * scripts/learn/build-maya-items.mjs from the production pages (a numeral the
 * scribe miswrote, a day sign, and three dictionary words), not hand-written
 * ones: the gloss keywords are whatever the dictionary page's text produced.
 */
const items = (fixtures as unknown as (MayaItem | StudyCard)[]).filter((i): i is MayaItem => i.rung !== 'study');
const cards = (fixtures as unknown as (MayaItem | StudyCard)[]).filter((i): i is StudyCard => i.rung === 'study');
const get = (id: string) => items.find((i) => i._id === id)!;

describe('gradeAnswer', () => {
  it('a numeral is graded on the painted value, not Förstemann\'s correction', () => {
    const n = get('num-32-up-g2-1');
    expect(gradeAnswer(n, '13')).toBe(true);
    expect(gradeAnswer(n, '14')).toBe(false);
  });

  it('a day sign is graded on the sign', () => {
    const d = get('day-32-day-g4-3');
    expect(gradeAnswer(d, 'Lamat')).toBe(true);
    expect(gradeAnswer(d, 'Manik')).toBe(false);
  });

  it('a word is a pick among four short glosses, one of them its own', () => {
    // Pío Pérez: "ZAC: the eleventh month ... | White." In the Chumayel line it means white.
    const z = get('word-zac');
    expect(z.prompt.options).toHaveLength(4);
    expect(z.prompt.options).toContain('white');
    expect(gradeAnswer(z, 'white')).toBe(true);
    expect(gradeAnswer(z, z.prompt.options!.find((o) => o !== 'white')!)).toBe(false);
  });

  it('a typed gloss (kept for later rungs) matches any sense on the dictionary page', () => {
    const typed = (id: string) => ({ ...get(id), prompt: { kind: 'gloss' as const, text: '' } });
    expect(gradeAnswer(typed('word-zac'), 'white')).toBe(true);
    expect(gradeAnswer(typed('word-cimil'), 'death')).toBe(true);
    expect(gradeAnswer(typed('word-cimil'), 'dying')).toBe(false);
    expect(gradeAnswer(typed('word-ho'), '5')).toBe(true);
    expect(gradeAnswer(typed('word-ho'), 'Merida')).toBe(true);
    expect(gradeAnswer(typed('word-zac'), 'the')).toBe(false);
  });
});

describe('study cards and gold', () => {
  it('a day sign is preceded by Landa\'s key, then by its own card, each once', () => {
    const d = get('day-32-day-g4-3'); // Lamat
    expect(studyCardFor(d, cards, [])?._id).toBe('study-landa');
    expect(studyCardFor(d, cards, ['study-landa'])?._id).toBe('study-day-lamat');
    expect(studyCardFor(d, cards, ['study-landa', 'study-day-lamat'])).toBeNull();
    expect(studyCardFor(get('num-32-up-g2-1'), cards, [])?._id).toBe('study-numerals');
    expect(studyCardFor(get('word-zac'), cards, [])).toBeNull();
  });

  it('gold items are not put to the learner for a verdict; words are', () => {
    expect(asksVerdict(get('num-32-up-g2-1'))).toBe(false);
    expect(asksVerdict(get('day-32-day-g4-3'))).toBe(false);
    expect(asksVerdict(get('word-zac'))).toBe(true);
  });

  it('dictionary sense breaks show as semicolons', () => {
    expect(showSenses(get('word-cimil').answer.gloss_es!)).toBe('CIMIL: enfermedad; Muerte.');
  });
});

describe('spaced return', () => {
  const pool = items.filter((i) => i.rung === 'word');

  it('a missed item comes back after a few items, ahead of unseen ones', () => {
    let s = emptyState();
    const first = nextItem(pool, s, 'word')!;
    s = recordAttempt(s, first._id, false);
    for (const other of pool.filter((i) => i._id !== first._id)) s = recordAttempt(s, other._id, true);
    for (let k = 0; k < 4; k++) s = { ...s, seq: s.seq + 1 };
    expect(nextItem(pool, s, 'word')!._id).toBe(first._id);
  });

  it('three right answers in a row retire an item', () => {
    let s = emptyState();
    const id = pool[0]._id;
    for (let k = 0; k < 3; k++) s = recordAttempt(s, id, true);
    expect(s.seen[id].due).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('a rung with every item retired returns null', () => {
    let s = emptyState();
    for (const i of pool) for (let k = 0; k < 3; k++) s = recordAttempt(s, i._id, true);
    expect(nextItem(pool, s, 'word')).toBeNull();
  });
});

describe('held-out check cadence', () => {
  it('runs at the start, then every CHECK_EVERY items', () => {
    const s = emptyState();
    expect(checkDue(s)).toBe(true);
    const after = { ...s, checks: [{ at: 0, score: 3, total: 10, date: '2026-10-18' }] };
    expect(checkDue({ ...after, seq: CHECK_EVERY - 1 })).toBe(false);
    expect(checkDue({ ...after, seq: CHECK_EVERY })).toBe(true);
  });

  it('a skipped check is offered again after CHECK_EVERY items, not on every load', () => {
    const s = { ...emptyState(), checkSkippedAt: 0, seq: 3 };
    expect(checkDue(s)).toBe(false);
    expect(checkDue({ ...s, seq: CHECK_EVERY })).toBe(true);
  });
});

describe('expert queue', () => {
  const t = (iso: string) => new Date(iso);
  it('a dispute with no expert verdict is queued; an expert verdict clears it until a newer dispute', () => {
    const s = { agree: 1, disagree: 1, unsure: 0, right: 1, wrong: 1 };
    expect(needsExpert(s, t('2026-10-18'), null)).toBe(true);
    expect(needsExpert(s, t('2026-10-18'), t('2026-10-19'))).toBe(false);
    expect(needsExpert(s, t('2026-10-20'), t('2026-10-19'))).toBe(true);
    expect(needsExpert({ ...s, disagree: 0 }, null, null)).toBe(false);
    expect(needsExpert({ ...s, disagree: 0, unsure: 2 }, t('2026-10-18'), null)).toBe(true);
  });
});

describe('validateJudgement', () => {
  it('accepts an item verdict and a check, rejects the rest', () => {
    expect(validateJudgement({ item_id: 'num-41-pos-L1', answer: '8', correct: true, verdict: 'agree' })).toBeNull(); // a real id: capitals included
    expect(validateJudgement({ kind: 'check', score: 4, total: 10, answers: [] })).toBeNull();
    expect(validateJudgement({ item_id: 'num-41-pos-l1', answer: '8', correct: true, verdict: 'maybe' })).toBe('bad verdict');
    expect(validateJudgement({ kind: 'check', score: 11, total: 10, answers: [] })).toBe('bad score');
    expect(validateJudgement({ item_id: 'day-32-day-g4-3', answer: 'Lamat', correct: true, verdict: null })).toBeNull();
  });
});

// ── The judgement route: the learner is the session, never the body ──

let currentUserId: string | null = null;
const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId }, expires: 'later' } : null)),
}));
vi.mock('@/lib/mongodb', () => {
  const db = {
    collection: (name: string) => ({
      findOne: async (q: { _id: string }) => (name === 'learn_maya_items' && q._id === 'word-zac' ? { _id: 'word-zac', rung: 'word', status: 'live' } : null),
      insertOne: async (doc: Record<string, unknown>) => { inserted.push(doc); return { insertedId: 'x' }; },
    }),
  };
  return { getDb: vi.fn(async () => db), getReadDb: vi.fn(async () => db) };
});

const post = async (body: unknown) => {
  const { POST } = await import('@/app/api/learn/maya/judgements/route');
  const { NextRequest } = await import('next/server');
  return POST(new NextRequest('http://localhost/api/learn/maya/judgements', { method: 'POST', body: JSON.stringify(body) }));
};

describe('POST /api/learn/maya/judgements', () => {
  beforeEach(() => { inserted.length = 0; currentUserId = null; });

  it('refuses a signed-out learner and stores nothing', async () => {
    const r = await post({ item_id: 'word-zac', answer: 'white', correct: true, verdict: 'agree' });
    expect(r.status).toBe(401);
    expect(inserted).toHaveLength(0);
  });

  it('attributes to the session user, ignoring any id in the body', async () => {
    currentUserId = 'user-a';
    const r = await post({ item_id: 'word-zac', answer: 'white', correct: true, verdict: 'disagree', correction: 'sac = white here', learner: { id: 'someone-else' }, volunteer_id: 'v-1' });
    expect(r.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].learner).toEqual({ kind: 'user', id: 'user-a' });
    expect(inserted[0]).toMatchObject({ item_id: 'word-zac', rung: 'word', tier: 'learner', verdict: 'disagree', correction: 'sac = white here' });
    expect(JSON.stringify(inserted[0])).not.toContain('someone-else');
  });

  it('rejects an unknown item', async () => {
    currentUserId = 'user-a';
    const r = await post({ item_id: 'word-nope', answer: '', correct: false, verdict: 'unsure' });
    expect(r.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });
});
