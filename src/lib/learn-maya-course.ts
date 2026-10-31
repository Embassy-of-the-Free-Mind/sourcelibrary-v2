// PRIOR ART: src/lib/learn-maya.ts — v1's item grading and spaced return over a flat bank of rungs. The course (v2) is lessons that each open with a worked example and end on a real page, and its review is "what you missed last sitting", so it needs per-lesson state and wrong-answer explanations that v1 has no place for. v1's judgement storage is kept and reused.
/**
 * /learn/maya as a short course (#6921, v2): pure logic shared by the page and the tests.
 *
 * The lessons themselves (copy, crops, items) are in src/app/learn/maya/course.ts.
 * This file holds what can be wrong about them: how a number is described, how a
 * stacked number is read, how days step on, how a syllabic spelling is read, and
 * the learner's local progress (which lesson, which items were missed, and when).
 */

export const COURSE_KEY = 'sl-learn-maya-v2';

// ── Numbers ──

const WORDS = ['no', 'one', 'two', 'three', 'four'];

/** "one bar and two dots", "three dots", "the shell". */
export function describeNumeral(n: number): string {
  if (n === 0) return 'the shell';
  const bars = Math.floor(n / 5);
  const dots = n % 5;
  const b = bars ? `${WORDS[bars]} bar${bars > 1 ? 's' : ''}` : '';
  const d = dots ? `${WORDS[dots]} dot${dots > 1 ? 's' : ''}` : '';
  return [b, d].filter(Boolean).join(' and ');
}

/** The one line a right answer leaves behind. */
export function numeralWhy(n: number): string {
  if (n === 0) return 'The shell is zero.';
  const bars = Math.floor(n / 5);
  const dots = n % 5;
  if (!bars) return `${cap(describeNumeral(n))}: ${n}.`;
  if (!dots) return `${cap(describeNumeral(n))}: ${bars} × 5 = ${n}.`;
  return `${cap(describeNumeral(n))}: ${bars * 5} + ${dots} = ${n}.`;
}

/** "You said 7: one bar and two dots. This is one dot." */
export function numeralWrong(chosen: number, value: number): string {
  return `You said ${chosen}: ${describeNumeral(chosen)}. This is ${describeNumeral(value)}.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Value of a stacked number, digits top to bottom, places top to bottom (e.g. [360, 20, 1]). */
export function placeValue(digits: number[], places: number[]): number {
  return digits.reduce((sum, d, i) => sum + d * places[i], 0);
}

/**
 * A number written in the given places, top to bottom, or null if it does not fit
 * (a digit over 19, or a remainder no place can hold).
 */
export function toPlaces(n: number, places: number[]): number[] | null {
  let r = n;
  const out = places.map((p, i) => {
    const d = Math.floor(r / p);
    r -= d * p;
    // The second place of the calendar count runs only to 17 (18 × 20 = 360).
    const max = i > 0 && places[i - 1] / p < 20 ? places[i - 1] / p - 1 : 19;
    return d > max ? -1 : d;
  });
  if (r !== 0 || out.some((d) => d < 0 || d > 19)) return null;
  return out;
}

/** Why a reading of a stacked number went wrong: the misreading that produces it, if it is a known one. */
export function placeMistake(chosen: number, digits: number[], places: number[]): 'sum' | 'upside-down' | 'plain-count' | 'skipped-top' | null {
  if (chosen === digits.reduce((a, b) => a + b, 0)) return 'sum';
  const plain = places.map((_, i) => 20 ** (places.length - 1 - i));
  if (places.some((p, i) => p !== plain[i]) && chosen === placeValue(digits, plain)) return 'plain-count';
  if (digits.length > 1 && chosen === placeValue([...digits].reverse(), places)) return 'upside-down';
  if (digits.length > 2 && chosen === placeValue(digits.slice(1), places.slice(1))) return 'skipped-top';
  return null;
}

// ── Days ──

/** The twenty day names, as Landa and the colonial books spell them. */
export const DAY_SIGNS = [
  'Imix', 'Ik', 'Akbal', 'Kan', 'Chicchan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc',
  'Chuen', 'Eb', 'Ben', 'Ix', 'Men', 'Cib', 'Caban', 'Etznab', 'Cauac', 'Ahau',
] as const;
export type DaySign = (typeof DAY_SIGNS)[number];
export type Day = [number, DaySign];

/** The day k days after d: the number runs 1-13, the sign through the twenty, both one step a day. */
export function addDays([n, sign]: Day, k: number): Day {
  const i = DAY_SIGNS.indexOf(sign);
  return [((((n - 1 + k) % 13) + 13) % 13) + 1, DAY_SIGNS[(((i + k) % 20) + 20) % 20]];
}

export const dayLabel = ([n, s]: Day) => `${n} ${s}`;
export const sameDay = (a: Day, b: Day) => a[0] === b[0] && a[1] === b[1];

/** Why a "what day comes next" answer is wrong, in one sentence. */
export function nextDayWrong(from: Day, chosen: Day, steps = 1): string {
  const right = addDays(from, steps);
  const parts: string[] = [];
  if (chosen[0] !== right[0]) {
    parts.push(
      chosen[0] > 13
        ? `Numbers stop at 13: after 13 the count starts again at 1.`
        : chosen[0] === from[0]
          ? `The number moves on too: ${from[0]} becomes ${right[0]}.`
          : `The number moves one step: ${from[0]} becomes ${right[0]}.`,
    );
  }
  if (chosen[1] !== right[1]) {
    parts.push(
      chosen[1] === from[1]
        ? `The sign moves on too: after ${from[1]} comes ${right[1]}.`
        : `The sign moves one step along the twenty: after ${from[1]} comes ${right[1]}.`,
    );
  }
  return `You said ${dayLabel(chosen)}. ${parts.join(' ')}`;
}

// ── Syllables ──

/**
 * Read a syllabic spelling: every sign is spoken but the last sign's vowel,
 * which is silent (ba-la-ma → balam, o-ko → ok). One sign alone is read whole.
 */
export function readSpelling(signs: string[]): string {
  if (!signs.length) return '';
  const last = signs[signs.length - 1];
  const head = signs.slice(0, -1).join('');
  if (signs.length === 1) return last;
  return head + last.replace(/[aeiou]$/, '');
}

/** "ba-la-ma" */
export const spellingLabel = (signs: string[]) => signs.join('-');

// ── Local progress ──

export interface Missed {
  lesson: string;
  /** Sitting in which it was missed: it comes back in a LATER sitting. */
  sitting: number;
  /** What the learner chose, and what was right, as short labels for "you mixed up X and Y". */
  chose: string;
  right: string;
}

export interface CourseState {
  v: 2;
  /** Incremented once per visit; a missed item from an earlier sitting opens the next one. */
  sitting: number;
  introSeen: boolean;
  done: Record<string, string>; // lesson id → ISO date finished
  missed: Record<string, Missed>; // item id → the miss
  answered: number;
}

export function emptyCourse(): CourseState {
  return { v: 2, sitting: 0, introSeen: false, done: {}, missed: {}, answered: 0 };
}

export function parseCourse(raw: string | null): CourseState {
  if (!raw) return emptyCourse();
  try {
    const s = JSON.parse(raw);
    if (s?.v === 2 && typeof s.sitting === 'number' && s.done && s.missed) return { ...emptyCourse(), ...s };
  } catch { /* fall through */ }
  return emptyCourse();
}

/** A new visit: one more sitting. */
export const startSitting = (s: CourseState): CourseState => ({ ...s, sitting: s.sitting + 1 });

/** A wrong answer is remembered for the next sitting; a right one (in review or in a lesson) clears it. */
export function recordAnswer(s: CourseState, lesson: string, itemId: string, correct: boolean, chose: string, right: string): CourseState {
  const missed = { ...s.missed };
  if (correct) delete missed[itemId];
  else missed[itemId] = { lesson, sitting: s.sitting, chose, right };
  return { ...s, missed, answered: s.answered + 1 };
}

export const REVIEW_SIZE = 3;

/** Missed items from earlier sittings, oldest first, at most REVIEW_SIZE. */
export function reviewDue(s: CourseState): string[] {
  return Object.entries(s.missed)
    .filter(([, m]) => m.sitting < s.sitting)
    .sort((a, b) => a[1].sitting - b[1].sitting)
    .slice(0, REVIEW_SIZE)
    .map(([id]) => id);
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three'];

/** "Last time you mixed up ba and ma. Two quick ones." */
export function reviewIntro(s: CourseState, ids: string[]): string {
  const pairs = ids.map((id) => s.missed[id]).filter(Boolean).map((m) => `${m.chose} and ${m.right}`);
  const unique = [...new Set(pairs)];
  const list = unique.length > 1 ? `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}` : unique[0];
  const n = ids.length;
  return `Last time you mixed up ${list}. ${COUNT_WORDS[n] ?? n} quick ${n === 1 ? 'one' : 'ones'}.`;
}

export function finishLesson(s: CourseState, lesson: string, date = new Date()): CourseState {
  return { ...s, done: { ...s.done, [lesson]: date.toISOString().slice(0, 10) } };
}

/** The first open lesson among those that exist, or the last one. */
export function nextLesson(s: CourseState, open: string[]): string {
  return open.find((id) => !s.done[id]) ?? open[open.length - 1];
}
