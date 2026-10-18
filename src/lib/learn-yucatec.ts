// PRIOR ART: src/lib/learn-maya.ts — the glyph course's grading, spaced return and judgement rules; this module imports its spaced return (recordAttempt, LocalState) and stores attempts in the same judgements collection under the same session-user rule, and adds what a lesson-based language course needs: lessons built from sourced words and sentences, explanations for wrong answers, a daily streak, modern-form proposals.
/**
 * /learn/yucatec (#6921): a short-daily-lesson course in Yucatec Maya built
 * from real lines on held pages.
 *
 * Pure functions only, so the page and the tests share them. The course itself
 * is src/data/learn-yucatec-course.json, built and checked verbatim against the
 * page text by scripts/learn/build-yucatec-course.mjs; never edit it by hand.
 *
 * Progress: signed out, localStorage under LOCAL_KEY, never sent. Signed in,
 * every attempt also goes to the /learn/maya judgements collection (kind
 * 'yucatec'), keyed on the session's user id, so the review queue follows the
 * learner between devices.
 */
import courseJson from '@/data/learn-yucatec-course.json';
import { emptyState, parseState as parseSrs, recordAttempt, type LocalState } from '@/lib/learn-maya';

export { JUDGEMENTS_COLLECTION } from '@/lib/learn-maya';
export const PROPOSALS_COLLECTION = 'learn_yucatec_proposals';
export const LOCAL_KEY = 'sl-learn-yucatec-v1';
export const MAX_EXERCISES = 12;
export const MIN_EXERCISES = 8;
export const REVIEW_SIZE = 10;

export interface Quote { key: string; page: number; url: string; es?: string; en?: string; cite?: string }

export interface Word {
  id: string;
  form: string;
  short: string;
  number: number | null;
  note: string | null;
  note_ref: { key: string; page: number; url: string } | null;
  dict: { key: string; page: number; url: string; es: string; en: string };
  attest: { key: string; page: number; url: string; text: string; form: string; checked: string | null };
  dresden: { item_id: string; value: number; crop_url: string; codex_page: number; url: string; color: string } | null;
  /** Shown only once a speaker has confirmed it (see modernForm). */
  modern: { form: string; confirmed_by: string | null; date: string | null } | null;
}

export interface Rule { note?: string; quote?: number; text: string }

export interface Sentence {
  id: string;
  key: string;
  page: number;
  url: string;
  /** Exactly as transcribed on the page. */
  maya: string;
  /** What the learner sees: the transcription, with line-break hyphens joined where `show_note` says so. */
  show: string;
  show_note: string | null;
  es: string | null;
  en: string;
  en_short: string | null;
  words: string[];
  tiles: string[] | null;
  tiles_en: string | null;
  rule: Rule | null;
  fill: string | null;
  fill_text: { blank: string; choices: { text: string; word: string }[]; explain?: Rule } | null;
  checked: string | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  quotes: (Quote & { cite: string })[];
  table: { key: string; page: number; url: string; cite: string; rows: [string, string, string][] } | null;
}

export interface Lesson { id: string; title: string; new: string[]; review?: string[]; sentences: string[] }
export interface Unit { id: string; n: number; title: string; note: string; lessons: Lesson[] }

export interface Course {
  built_at: string;
  books: Record<string, { id: string; cite: string }>;
  notes: Note[];
  words: Word[];
  sentences: Sentence[];
  units: Unit[];
}

export const COURSE = courseJson as unknown as Course;

const wordMap = new Map(COURSE.words.map((w) => [w.id, w]));
const sentenceMap = new Map(COURSE.sentences.map((s) => [s.id, s]));
export const wordById = (id: string) => wordMap.get(id);
export const sentenceById = (id: string) => sentenceMap.get(id);
export const noteById = (id: string) => COURSE.notes.find((n) => n.id === id);
export const cite = (key: string) => COURSE.books[key]?.cite ?? key;
export const allLessons = (): Lesson[] => COURSE.units.flatMap((u) => u.lessons);
export const unitOf = (lessonId: string) => COURSE.units.find((u) => u.lessons.some((l) => l.id === lessonId));

/** A modern form is shown only when a speaker has confirmed it; proposals never reach the page. */
export function modernForm(w: Word): string | null {
  const m = w.modern;
  return m && m.form && m.confirmed_by && m.date ? m.form : null;
}

// ── Exercises ──

export type Exercise =
  | { kind: 'teach'; id: string; word: string }
  | { kind: 'pick'; id: string; word: string; options: string[] }
  | { kind: 'pick-form'; id: string; word: string; options: string[] }
  | { kind: 'match'; id: string; words: string[]; right: string[] }
  | { kind: 'fill'; id: string; sentence: string; blank: string; options: { text: string; word: string }[] }
  | { kind: 'read'; id: string; sentence: string; options: string[] }
  | { kind: 'build'; id: string; sentence: string; tiles: string[] };

export const isGraded = (e: Exercise) => e.kind !== 'teach';

/** FNV-1a, so a lesson is the same lesson every time it is opened. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function shuffle<T>(seed: string, xs: T[]): T[] {
  const a = [...xs];
  let h = hash(seed);
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Words a learner has met by the end of this lesson, oldest first. */
function wordsUpTo(lessonId: string): string[] {
  const out: string[] = [];
  for (const l of allLessons()) {
    for (const id of l.new) if (!out.includes(id)) out.push(id);
    if (l.id === lessonId) break;
  }
  return out;
}

const PRONOUNS = ['yw-in', 'yw-a', 'yw-u'];

/** Three other words for a choice: same kind first (numbers with numbers, pronouns with pronouns), never one with the same gloss. */
function distractors(seed: string, answerId: string, pool: string[]): string[] {
  const ans = wordById(answerId)!;
  const ok = (id: string) => {
    const w = wordById(id);
    return !!w && id !== answerId && w.short !== ans.short && w.form !== ans.form;
  };
  const kind = (id: string) => (PRONOUNS.includes(id) ? 'p' : wordById(id)?.number != null ? 'n' : 'w');
  const same = shuffle(seed, pool.filter((id) => ok(id) && kind(id) === kind(answerId)));
  const other = shuffle(seed + '+', pool.filter((id) => ok(id) && kind(id) !== kind(answerId)));
  return [...same, ...other].slice(0, 3);
}

function pickFor(lessonId: string, wordId: string, kind: 'pick' | 'pick-form', pool: string[]): Exercise {
  const id = `${lessonId}:${kind}:${wordId}`;
  return { kind, id, word: wordId, options: shuffle(id, [wordId, ...distractors(id, wordId, pool)]) };
}

function readFor(lessonId: string, sentenceId: string): Exercise {
  const id = `${lessonId}:read:${sentenceId}`;
  const s = sentenceById(sentenceId)!;
  const unit = unitOf(lessonId);
  const near = new Set(unit?.lessons.flatMap((l) => l.sentences) ?? []);
  const others = COURSE.sentences.filter((o) => o.id !== s.id && o.en !== s.en);
  const pool = [...shuffle(id, others.filter((o) => near.has(o.id))), ...shuffle(id + '+', others.filter((o) => !near.has(o.id)))];
  return { kind: 'read', id, sentence: s.id, options: shuffle(id, [s.id, ...pool.slice(0, 3).map((o) => o.id)]) };
}

function fillFor(lessonId: string, sentenceId: string, pool: string[]): Exercise | null {
  const s = sentenceById(sentenceId)!;
  const id = `${lessonId}:fill:${sentenceId}`;
  if (s.fill_text) return { kind: 'fill', id, sentence: s.id, blank: s.fill_text.blank, options: shuffle(id, s.fill_text.choices) };
  if (!s.fill) return null;
  const w = wordById(s.fill)!;
  const blank = w.attest.key === s.key && w.attest.page === s.page ? w.attest.form : w.form;
  // A suffix (-pel, -tul) cannot fill a word's slot, so it is never offered there.
  const others = PRONOUNS.includes(w.id) ? PRONOUNS.filter((p) => p !== w.id) : distractors(id, w.id, pool.filter((o) => !wordById(o)?.form.startsWith('-')));
  return {
    kind: 'fill',
    id,
    sentence: s.id,
    blank,
    options: shuffle(id, [{ text: blank, word: w.id }, ...others.map((o) => ({ text: wordById(o)!.form, word: o }))]),
  };
}

function buildFor(lessonId: string, sentenceId: string): Exercise | null {
  const s = sentenceById(sentenceId)!;
  if (!s.tiles) return null;
  const id = `${lessonId}:build:${sentenceId}`;
  let tiles = shuffle(id, s.tiles);
  if (tiles.join(' ') === s.tiles.join(' ')) tiles = [...tiles.slice(1), tiles[0]];
  return { kind: 'build', id, sentence: s.id, tiles };
}

/**
 * One lesson, 8–12 graded exercises: each new word is taught on a card and then
 * asked (meaning from the word, or the word from a Dresden numeral), earlier
 * words come back as "which word means…", then a match, then every sentence is
 * read, filled or built. Read-only exercises are dropped first when over 12.
 */
export function buildLesson(lessonId: string): Exercise[] {
  const lesson = allLessons().find((l) => l.id === lessonId);
  if (!lesson) return [];
  const pool = wordsUpTo(lessonId);
  const out: Exercise[] = [];
  for (let i = 0; i < lesson.new.length; i += 2) {
    const pair = lesson.new.slice(i, i + 2);
    for (const w of pair) out.push({ kind: 'teach', id: `${lessonId}:teach:${w}`, word: w });
    for (const w of pair) out.push(pickFor(lessonId, w, wordById(w)?.dresden ? 'pick-form' : 'pick', pool));
  }
  for (const w of lesson.review ?? []) out.push(pickFor(lessonId, w, 'pick-form', pool));
  const matchable = [...lesson.new, ...(lesson.review ?? [])].filter((id, i, a) => a.findIndex((o) => wordById(o)?.short === wordById(id)?.short) === i);
  if (matchable.length >= 3) {
    const words = shuffle(`${lessonId}:match`, matchable).slice(0, 5);
    out.push({ kind: 'match', id: `${lessonId}:match`, words, right: shuffle(`${lessonId}:match:r`, words) });
  }
  const sentenceEx: Exercise[] = [];
  for (const sid of lesson.sentences) {
    sentenceEx.push(readFor(lessonId, sid));
    const f = fillFor(lessonId, sid, pool);
    if (f) sentenceEx.push(f);
    const b = buildFor(lessonId, sid);
    if (b) sentenceEx.push(b);
  }
  out.push(...sentenceEx);
  // Too long: drop a read where the same sentence is also filled or built.
  const graded = () => out.filter(isGraded).length;
  for (let i = out.length - 1; i >= 0 && graded() > MAX_EXERCISES; i--) {
    const e = out[i];
    if (e.kind === 'read' && out.some((o) => (o.kind === 'fill' || o.kind === 'build') && o.sentence === e.sentence)) out.splice(i, 1);
  }
  // Too short: ask the new words the other way round.
  for (const w of lesson.new) {
    if (graded() >= MIN_EXERCISES) break;
    const kind = wordById(w)?.dresden ? 'pick' : 'pick-form';
    if (!out.some((e) => e.id === `${lessonId}:${kind}:${w}`)) out.push(pickFor(lessonId, w, kind, pool));
  }
  return out;
}

/** The item an attempt counts against: the word asked, the word in the blank, or the sentence. */
export function itemOf(e: Exercise): string | null {
  switch (e.kind) {
    case 'pick':
    case 'pick-form':
      return e.word;
    case 'fill': {
      const s = sentenceById(e.sentence);
      return s?.fill ?? s?.fill_text?.choices[0].word ?? e.sentence;
    }
    case 'read':
    case 'build':
      return e.sentence;
    default:
      return null;
  }
}

// ── Grading ──

export function rightAnswer(e: Exercise): string {
  switch (e.kind) {
    case 'pick':
    case 'pick-form':
      return e.word;
    case 'fill':
      return e.blank;
    case 'read':
      return e.sentence;
    case 'build':
      return sentenceById(e.sentence)!.tiles!.join(' ');
    default:
      return '';
  }
}

export const grade = (e: Exercise, answer: string) => e.kind !== 'teach' && e.kind !== 'match' && answer === rightAnswer(e);

/**
 * Why an answer is wrong, as data the page renders: what the learner chose and
 * what it means, next to the right one, each with its page; for tile order,
 * the rule and its page.
 */
export interface Explanation {
  chosen: { label: string; means: string; quote?: Quote; sentence?: Sentence } | null;
  right: { label: string; means: string; quote?: Quote; sentence?: Sentence };
  rule: (Rule & { quoteRef?: Quote & { cite: string } }) | null;
}

const entryOf = (w: Word): Quote => ({ key: w.dict.key, page: w.dict.page, url: w.dict.url, es: w.dict.es, en: w.dict.en, cite: cite(w.dict.key) });

function ruleWithQuote(r: Rule | null | undefined): Explanation['rule'] {
  if (!r) return null;
  const q = r.note ? noteById(r.note)?.quotes[r.quote ?? 0] : undefined;
  return { ...r, quoteRef: q };
}

export function explain(e: Exercise, answer: string): Explanation | null {
  if (e.kind === 'pick' || e.kind === 'pick-form') {
    const w = wordById(e.word)!;
    const c = wordById(answer);
    return {
      chosen: c && c.id !== w.id ? { label: c.form, means: c.short, quote: entryOf(c) } : null,
      right: { label: w.form, means: w.short, quote: entryOf(w) },
      rule: null,
    };
  }
  if (e.kind === 'fill') {
    const s = sentenceById(e.sentence)!;
    const rightOpt = e.options.find((o) => o.text === e.blank)!;
    const chosenOpt = e.options.find((o) => o.text === answer);
    const rw = wordById(rightOpt.word)!;
    const cw = chosenOpt ? wordById(chosenOpt.word) : undefined;
    return {
      chosen: chosenOpt && cw && chosenOpt.text !== e.blank ? { label: chosenOpt.text, means: cw.short, quote: entryOf(cw) } : null,
      right: { label: rightOpt.text, means: rw.short, quote: entryOf(rw), sentence: s },
      rule: ruleWithQuote(s.fill_text?.explain),
    };
  }
  if (e.kind === 'read') {
    const s = sentenceById(e.sentence)!;
    const c = sentenceById(answer);
    return {
      chosen: c && c.id !== s.id ? { label: c.en, means: c.show, sentence: c } : null,
      right: { label: s.en, means: s.show, sentence: s },
      rule: null,
    };
  }
  if (e.kind === 'build') {
    const s = sentenceById(e.sentence)!;
    return {
      chosen: answer ? { label: answer, means: '' } : null,
      right: { label: s.tiles!.join(' '), means: s.tiles_en ?? s.en, sentence: s },
      rule: ruleWithQuote(s.rule),
    };
  }
  return null;
}

// ── Progress: spaced return (learn-maya), lessons done, streak ──

export interface Progress {
  v: 1;
  srs: LocalState;
  lessons: Record<string, { done: number; at: string }>;
  days: string[];
  /** Grammar notes already shown (each opens its unit once). */
  notes: string[];
}

export const emptyProgress = (): Progress => ({ v: 1, srs: emptyState(), lessons: {}, days: [], notes: [] });

export function parseProgress(raw: string | null): Progress {
  if (!raw) return emptyProgress();
  try {
    const p = JSON.parse(raw);
    if (p?.v === 1 && p.srs && typeof p.lessons === 'object' && Array.isArray(p.days)) {
      return {
        v: 1,
        srs: parseSrs(JSON.stringify(p.srs)),
        lessons: p.lessons,
        days: p.days.filter((d: unknown) => typeof d === 'string'),
        notes: Array.isArray(p.notes) ? p.notes.filter((n: unknown) => typeof n === 'string') : [],
      };
    }
  } catch { /* fall through */ }
  return emptyProgress();
}

export function recordItem(p: Progress, itemId: string, correct: boolean): Progress {
  return { ...p, srs: recordAttempt(p.srs, itemId, correct) };
}

/** Local calendar day, YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d - 1));
}

/** A finished lesson or review keeps the streak for that day. */
export function markDay(p: Progress, today: string): Progress {
  return p.days.includes(today) ? p : { ...p, days: [...p.days, today].sort().slice(-400) };
}

export function completeLesson(p: Progress, lessonId: string, today: string): Progress {
  const prev = p.lessons[lessonId];
  return { ...markDay(p, today), lessons: { ...p.lessons, [lessonId]: { done: (prev?.done ?? 0) + 1, at: today } } };
}

/** Merge the server's log into this device's progress: the longer attempt history wins; days, lessons and notes are unioned. */
export function mergeProgress(local: Progress, remote: Progress): Progress {
  const base = remote.srs.seq > local.srs.seq ? remote : local;
  const lessons = { ...remote.lessons };
  for (const [id, l] of Object.entries(local.lessons)) {
    const r = lessons[id];
    lessons[id] = r ? { done: Math.max(r.done, l.done), at: r.at > l.at ? r.at : l.at } : l;
  }
  return {
    ...base,
    lessons,
    days: [...new Set([...local.days, ...remote.days])].sort().slice(-400),
    notes: [...new Set([...local.notes, ...remote.notes])],
  };
}

/** Days in a row with a finished lesson or review, ending today (or yesterday, if today is not done yet). */
export function streak(days: string[], today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : prevDay(today);
  let n = 0;
  while (set.has(d)) { n++; d = prevDay(d); }
  return n;
}

/** A lesson opens when the one before it has been finished once. */
export function isUnlocked(p: Progress, lessonId: string): boolean {
  const ls = allLessons();
  const i = ls.findIndex((l) => l.id === lessonId);
  return i === 0 || (i > 0 && !!p.lessons[ls[i - 1].id]);
}

export function nextLesson(p: Progress): Lesson | null {
  return allLessons().find((l) => !p.lessons[l.id]) ?? null;
}

/** Missed items not yet answered right three times running, most overdue first. */
export function reviewQueue(p: Progress): string[] {
  return Object.entries(p.srs.seen)
    .filter(([id, s]) => s.wrong > 0 && s.due !== Number.MAX_SAFE_INTEGER && (wordMap.has(id) || sentenceMap.has(id)))
    .sort((a, b) => a[1].due - b[1].due)
    .map(([id]) => id);
}

/**
 * A review session: a missed word comes back inside a real sentence where one
 * has it as a blank, else as a sentence to read, else on its own; a missed
 * sentence comes back to read or build.
 */
export function buildReview(p: Progress): Exercise[] {
  const ids = reviewQueue(p).slice(0, REVIEW_SIZE);
  const pool = COURSE.words.map((w) => w.id);
  const out: Exercise[] = [];
  for (const id of ids) {
    const tag = `review-${p.srs.seq}`;
    if (wordMap.has(id)) {
      const asBlank = COURSE.sentences.find((s) => s.fill === id || s.fill_text?.choices[0].word === id);
      const inLine = COURSE.sentences.find((s) => s.words.includes(id));
      if (asBlank) out.push(fillFor(tag, asBlank.id, pool)!);
      else if (inLine) out.push(readFor(tag, inLine.id));
      else out.push(pickFor(tag, id, 'pick-form', pool));
    } else {
      out.push(buildFor(tag, id) ?? readFor(tag, id));
    }
  }
  return out.filter((e, i) => out.findIndex((o) => o.id === e.id) === i);
}

// ── Server-side validation ──

const ITEM_RE = /^y[ws]-[a-z0-9-]{1,40}$/;
const LESSON_RE = /^yl-\d-\d$/;

/** Body of POST /api/learn/yucatec/attempts. Returns an error string or null. */
export function validateAttempt(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body required';
  const b = body as Record<string, unknown>;
  if (b.kind === 'lesson') {
    if (typeof b.lesson_id !== 'string' || !LESSON_RE.test(b.lesson_id) || !allLessons().some((l) => l.id === b.lesson_id)) return 'bad lesson_id';
    return null;
  }
  if (typeof b.item_id !== 'string' || !ITEM_RE.test(b.item_id) || !(wordMap.has(b.item_id) || sentenceMap.has(b.item_id))) return 'bad item_id';
  if (typeof b.correct !== 'boolean') return 'bad correct';
  if (typeof b.answer !== 'string' || b.answer.length > 300) return 'bad answer';
  if (b.exercise != null && (typeof b.exercise !== 'string' || !['pick', 'pick-form', 'match', 'fill', 'read', 'build'].includes(b.exercise))) return 'bad exercise';
  if (b.lesson_id != null && (typeof b.lesson_id !== 'string' || b.lesson_id.length > 40)) return 'bad lesson_id';
  return null;
}

/** Body of POST /api/learn/yucatec/proposals: a speaker's modern form for a word. */
export function validateProposal(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body required';
  const b = body as Record<string, unknown>;
  if (typeof b.word_id !== 'string' || !wordMap.has(b.word_id)) return 'bad word_id';
  if (typeof b.form !== 'string' || !b.form.trim() || b.form.length > 80) return 'form required (up to 80 characters)';
  if (b.note != null && (typeof b.note !== 'string' || b.note.length > 500)) return 'note too long';
  if (b.place != null && (typeof b.place !== 'string' || b.place.length > 80)) return 'place too long';
  return null;
}

/** Rebuild progress from the server's attempt log (signed-in), replaying it through the same spaced return. */
export function progressFromLog(
  attempts: { item_id: string; correct: boolean }[],
  lessons: { lesson_id: string; day: string }[],
): Progress {
  let p = emptyProgress();
  for (const a of attempts) if (wordMap.has(a.item_id) || sentenceMap.has(a.item_id)) p = recordItem(p, a.item_id, a.correct);
  for (const l of lessons) p = completeLesson(p, l.lesson_id, l.day);
  return p;
}
