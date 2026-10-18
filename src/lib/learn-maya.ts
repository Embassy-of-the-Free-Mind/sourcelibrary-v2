// PRIOR ART: src/lib/review-queue.ts — rating config for review queues whose items are pages; these items carry their own answer key, a learner's attempt and spaced return, which that module has no place for. src/lib/volunteer-id.ts is deliberately not used: a signed-out learner's progress stays in localStorage and is never sent (the 2026-08-05 decision recorded there).
/**
 * /learn/maya (#6921): item types, grading, spaced return and the held-out check.
 *
 * Pure functions only, so the page and the tests share them. Storage of
 * judgements is server-side (src/app/api/learn/maya/*); a signed-out learner's
 * progress lives in localStorage under LOCAL_KEY and is never sent.
 *
 * Schema of the stored items and judgements: scripts/learn/README.md
 */

export const ITEMS_COLLECTION = 'learn_maya_items';
export const JUDGEMENTS_COLLECTION = 'learn_maya_judgements';
export const LOCAL_KEY = 'sl-learn-maya-v1';

/**
 * Rungs in teaching order. Glyph captions (#6903) slot in after 'word' once
 * that test says which captions the AI reads well enough: add the rung here,
 * give its items `prompt.kind: 'pick'` or `'gloss'`, and the page needs no new
 * screen.
 */
export const RUNGS = ['numeral', 'day-sign', 'word'] as const;
export type Rung = (typeof RUNGS)[number];

export const RUNG_LABEL: Record<Rung, string> = {
  numeral: 'Numbers',
  'day-sign': 'Day signs',
  word: 'Words',
};

export const DAY_SIGNS = [
  'Imix', 'Ik', 'Akbal', 'Kan', 'Chicchan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc',
  'Chuen', 'Eb', 'Ben', 'Ix', 'Men', 'Cib', 'Caban', 'Etznab', 'Cauac', 'Ahau',
] as const;

export interface Evidence {
  kind: 'leaf' | 'forstemann' | 'dictionary' | 'source';
  label: string;
  url: string;
  text?: string;
}

export interface MayaItem {
  _id: string;
  rung: Rung;
  order: number;
  status: 'live' | 'heldout' | 'retired';
  prompt: { kind: 'count' | 'pick' | 'gloss'; text: string; options?: string[] };
  image?: { book_id: string; leaf: number; codex_page: number; src: string; box: [number, number, number, number]; color: string; crop_url?: string };
  word?: {
    headword: string;
    form: string;
    source: { book_id: string; page_number: number; title: string; line: string; url: string };
  };
  answer: {
    value?: number;
    sign?: string;
    coefficient?: number;
    position?: number;
    short?: string;
    gloss_es?: string;
    gloss_en?: string;
    keywords?: string[];
    number?: number | null;
  };
  note: string | null;
  /** The one sentence the reveal leaves behind (built by scripts/learn/build-maya-items.mjs). */
  teach: string | null;
  ai: { reading: string; confident: boolean; model: string | null; run: string };
  evidence: Evidence[];
  gold: { is_gold: boolean; basis: string | null; checked_by_eye: boolean };
  links: { word_id?: string; numeral_ids?: string[]; day_sign_ids?: string[]; glyph_sign?: string | null };
}

/**
 * Shown once, before a learner first meets the numeral rule or a day sign: the
 * sign as painted on the Dresden Codex, with Landa's c. 1566 drawing as history.
 */
export interface StudyCard {
  _id: string;
  rung: 'study';
  order: number;
  study_for: { rung: Rung; sign: string | null };
  title: string;
  text: string;
  figures: { kind: 'codex' | 'history'; label: string; url: string; crop_url: string }[];
}

/** The card a learner should see before this item, or null if they have seen them all. */
export function studyCardFor(item: MayaItem, cards: StudyCard[], studied: string[]): StudyCard | null {
  const wanted = cards.filter((c) => c.study_for.rung === item.rung && (c.study_for.sign === null || c.study_for.sign === item.answer.sign));
  return wanted.sort((a, b) => a.order - b.order).find((c) => !studied.includes(c._id)) ?? null;
}

/** Gold items carry a checked answer (Förstemann, the arithmetic, an expert): a beginner is not asked to judge them. */
export const asksVerdict = (item: MayaItem) => !item.gold?.is_gold;

/** Dictionary text marks sense breaks with "|"; show them as semicolons. */
export const showSenses = (t: string) => t.replace(/[.,;]?\s*\|\s*/g, '; ');

export type Verdict = 'agree' | 'disagree' | 'unsure';
export const VERDICTS: Verdict[] = ['agree', 'disagree', 'unsure'];

/** The pre-rendered crop (R2), else the public crop route; the box is normalised on the full leaf. */
export function cropUrl(image: NonNullable<MayaItem['image']>): string {
  if (image.crop_url) return image.crop_url;
  const [x, y, w, h] = image.box;
  const q = new URLSearchParams({ url: image.src, x: String(x), y: String(y), w: String(w), h: String(h), padding: '0.004' });
  return `/api/crop-image?${q.toString()}`;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Did the learner's try match the answer? Glosses match on any content word of the dictionary's sense. */
export function gradeAnswer(item: MayaItem, answer: string): boolean {
  const a = answer.trim();
  if (!a) return false;
  if (item.rung === 'numeral') return Number(a) === item.answer.value;
  if (item.prompt.kind === 'pick') return a === (item.answer.sign ?? item.answer.short ?? '');
  const keys = (item.answer.keywords ?? []).map(norm);
  const words: string[] = norm(a).match(/\p{L}{3,}|\d+/gu) ?? [];
  if (item.answer.number != null && words.includes(String(item.answer.number))) return true;
  return words.some((w) => keys.some((k) => k === w || (w.length >= 4 && k.length >= 4 && (k.startsWith(w) || w.startsWith(k)))));
}

// ── Local progress: spaced return + held-out check ──

export interface SeenState { box: number; due: number; right: number; wrong: number }
export interface CheckResult { at: number; score: number; total: number; date: string }
export interface LocalState {
  v: 1;
  seq: number;
  seen: Record<string, SeenState>;
  checks: CheckResult[];
  checkSkippedAt: number | null;
  studied: string[];
}

export const CHECK_EVERY = 50;
export const CHECK_SIZE = 10;
/** Items until a missed item comes back, by box. A third right answer in a row retires it. */
const RETURN_AFTER = [4, 12, 40];

export function emptyState(): LocalState {
  return { v: 1, seq: 0, seen: {}, checks: [], checkSkippedAt: null, studied: [] };
}

export function parseState(raw: string | null): LocalState {
  if (!raw) return emptyState();
  try {
    const s = JSON.parse(raw);
    if (s?.v === 1 && typeof s.seq === 'number' && s.seen && Array.isArray(s.checks)) return { checkSkippedAt: null, studied: [], ...s };
  } catch { /* fall through */ }
  return emptyState();
}

export function recordAttempt(state: LocalState, id: string, correct: boolean): LocalState {
  const seq = state.seq + 1;
  const prev = state.seen[id] ?? { box: 0, due: 0, right: 0, wrong: 0 };
  const box = correct ? Math.min(prev.box + 1, RETURN_AFTER.length) : 0;
  const due = correct && box >= RETURN_AFTER.length ? Number.MAX_SAFE_INTEGER : seq + RETURN_AFTER[correct ? box : 0];
  return {
    ...state,
    seq,
    seen: { ...state.seen, [id]: { box, due, right: prev.right + (correct ? 1 : 0), wrong: prev.wrong + (correct ? 0 : 1) } },
  };
}

/**
 * Next item in a rung: a missed item that is due comes back first; then the
 * next unseen item in teaching order; then the earliest-due seen item.
 * Returns null when every item in the rung is retired.
 */
export function nextItem(items: MayaItem[], state: LocalState, rung: Rung, skip?: string): MayaItem | null {
  const pool = items.filter((i) => i.rung === rung && i.status === 'live' && i._id !== skip);
  const due = pool
    .filter((i) => state.seen[i._id] && state.seen[i._id].due <= state.seq && state.seen[i._id].wrong > 0)
    .sort((a, b) => state.seen[a._id].due - state.seen[b._id].due);
  if (due.length) return due[0];
  const unseen = pool.filter((i) => !state.seen[i._id]).sort((a, b) => a.order - b.order);
  if (unseen.length) return unseen[0];
  const open = pool
    .filter((i) => state.seen[i._id].due !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => state.seen[a._id].due - state.seen[b._id].due);
  return open[0] ?? null;
}

export function rungProgress(items: MayaItem[], state: LocalState, rung: Rung): { seen: number; total: number } {
  const pool = items.filter((i) => i.rung === rung && i.status === 'live');
  return { seen: pool.filter((i) => state.seen[i._id]).length, total: pool.length };
}

/** The held-out check runs before the first item and again every CHECK_EVERY items. */
export function checkDue(state: LocalState): boolean {
  const last = state.checks[state.checks.length - 1];
  const since = Math.max(last?.at ?? -1, state.checkSkippedAt ?? -1);
  if (since < 0) return state.seq === 0;
  return state.seq - since >= CHECK_EVERY;
}

export function heldOut(items: MayaItem[]): MayaItem[] {
  return items.filter((i) => i.status === 'heldout').sort((a, b) => RUNGS.indexOf(a.rung) - RUNGS.indexOf(b.rung) || a.order - b.order).slice(0, CHECK_SIZE);
}

/** Rung to open on: the first one the learner has not finished seeing. */
export function startingRung(items: MayaItem[], state: LocalState): Rung {
  for (const r of RUNGS) {
    const p = rungProgress(items, state, r);
    if (p.seen < p.total) return r;
  }
  return RUNGS[0];
}

/** Server-side validation of a judgement body. Returns an error string or null. */
export function validateJudgement(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body required';
  const b = body as Record<string, unknown>;
  if (b.kind === 'check') {
    if (typeof b.score !== 'number' || typeof b.total !== 'number' || b.score < 0 || b.total < 1 || b.score > b.total) return 'bad score';
    if (!Array.isArray(b.answers) || b.answers.length > CHECK_SIZE) return 'bad answers';
    return null;
  }
  if (typeof b.item_id !== 'string' || !/^[A-Za-z0-9-]{3,60}$/.test(b.item_id)) return 'bad item_id';
  // null: a gold item, where the learner answered but was not asked to judge.
  if (b.verdict !== null && !VERDICTS.includes(b.verdict as Verdict)) return 'bad verdict';
  if (typeof b.answer !== 'string' || b.answer.length > 200) return 'bad answer';
  if (typeof b.correct !== 'boolean') return 'bad correct';
  if (b.correction != null && (typeof b.correction !== 'string' || b.correction.length > 500)) return 'bad correction';
  return null;
}

export interface QueueStats { agree: number; disagree: number; unsure: number; right: number; wrong: number }

/** An item goes to the expert queue when a learner disputes the AI, or two are unsure, and no expert has ruled since. */
export function needsExpert(s: QueueStats, lastLearnerDisputeAt: Date | null, expertAt: Date | null): boolean {
  const disputed = s.disagree > 0 || s.unsure >= 2;
  if (!disputed) return false;
  if (!expertAt) return true;
  return !!lastLearnerDisputeAt && lastLearnerDisputeAt > expertAt;
}
