/**
 * The /learn/maya course (#6921, v2): lessons 0-3 of six, as data.
 *
 * Every picture is a crop of a page held in the library (the Dresden Codex,
 * Landa's Relación) or a drawing from `maya_signs` (David Stuart's syllabary),
 * with its credit and a link to its page. Crops new to the course are rendered
 * by scripts/learn/build-maya-course-crops.mjs (course-crops.json); the numeral
 * and day-sign crops are v1's, from learn_maya_items, each checked by eye.
 *
 * Text fields accept [label](href) links and *italics* (see Prose in MayaCourse.tsx).
 */
import crops from './course-crops.json';
import { type Day, type DaySign } from '@/lib/learn-maya-course';

const DRESDEN = '69dfd990220eedf04e13b0cf';
const LANDA = '69f8c0f74c6a515115aedadd';
const PIO = '6acc3dfa230e9a56175cdd32';
const R2 = 'https://images.sourcelibrary.org';

export const dresdenPage = (leaf: number) => `/book/${DRESDEN}?page=${leaf}`;
export const landaPage = (n: number) => `/book/${LANDA}?page=${n}`;
export const pioPage = (n: number) => `/book/${PIO}?page=${n}`;
/** The sister course (job learn-yucatec): Yucatec words in the glyph lessons link to it. */
export const YUCATEC = '/learn/yucatec';

export interface Fig {
  src: string;
  alt: string;
  /** The credit line, linked to href (the page or the source). */
  credit: string;
  href: string;
}

type CropId = keyof typeof crops;
const crop = (id: CropId, alt: string): Fig => ({ src: crops[id].url, alt, credit: crops[id].label, href: crops[id].page_url });

const CODEX_PAGE: Record<number, number> = { 9: 9, 27: 48, 32: 53, 41: 62 };
/** A v1 crop (learn_maya_items): item id + its hash, on a Dresden leaf. */
const bank = (file: string, leaf: number, alt: string): Fig => ({
  src: `${R2}/learn-maya/${DRESDEN}/${file}.jpg`,
  alt,
  credit: `Dresden Codex, page ${CODEX_PAGE[leaf]}`,
  href: dresdenPage(leaf),
});

// ── Stuart's syllabary (maya_signs, source stuart-syllabary-v2) ──

export const STUART_CREDIT = 'Drawing © David Stuart, used with permission';
export const STUART_SOURCE = 'https://mayadecipherment.com/2013/09/18/maya-hieroglyphic-syllabary/';
export const WAYEB_NOTE = 'Kettunen & Helmke (2025, Wayeb handbook) list these two among the signs most easily confused.';

export interface Syllable {
  value: string;
  src: string;
  /** What to look at: the feature that tells it from its neighbours. */
  feature: string;
}

const st = (file: string) => `${R2}/reference/maya/stuart-syllabary-v2/${file}.png`;

export const SYLLABLES = {
  ba: { value: 'ba', src: st("stuart2013-b-a-1-28d3df35"), feature: 'a striped oval at the top and a fringe with small circles along the bottom' },
  ma: { value: 'ma', src: st('stuart2013-ma-2-ed07eeee'), feature: 'a small ringed circle at the top, with dots around it, and no circles along the bottom' },
  la: { value: 'la', src: st('stuart2013-la-1-58d19365'), feature: 'a round sign with a small ring at the top and two small rings below, either side of a V' },
  na: { value: 'na', src: st('stuart2013-na-1-57a3e69e'), feature: 'a flat band, wider than it is tall, with small marks inside' },
  ka: { value: 'ka', src: st('stuart2013-ka-2-b3c3a0aa'), feature: 'a thin curved comb: one long stroke with short teeth along it, and nothing else' },
  sa: { value: 'sa', src: st('stuart2013-sa-3-f248e3d6'), feature: 'a squared bracket with short strokes and a column of dots down its open side' },
  e: { value: 'e', src: st('stuart2013-e-1-3e0e4802'), feature: 'a rounded square with three dots under an arc' },
  ti: { value: 'ti', src: st('stuart2013-ti-1-b5a2073a'), feature: 'a tall stack: a ribbed cap over two rings, a dot in the lower one' },
  tu: { value: 'tu', src: st('stuart2013-tu-1-3def7bb5'), feature: 'a tall stack whose lower half is cross-hatched' },
  o: { value: 'o', src: st('stuart2013-o-1-e7be482c'), feature: 'a narrow upright with a cross-hatched top, dots running down it and a ring of dots below' },
  ko: { value: 'ko', src: st('stuart2013-ko-1-7e6b919c'), feature: 'a wide oval with a dark band across the middle and a curl at each end' },
} satisfies Record<string, Syllable>;
export type SyllableKey = keyof typeof SYLLABLES;

/** Wayeb confusable groups that the course's signs fall in (maya_signs, kind 'confusable'). */
export const CONFUSABLE: [SyllableKey, SyllableKey][] = [['ba', 'ma'], ['ka', 'sa']];
export const isConfusable = (a: string, b: string) => CONFUSABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// ── Day signs (v1 crops, Dresden page 53; features as written for v1) ──

export const DAY_FIG: Partial<Record<DaySign, { fig: Fig; feature: string }>> = {
  Imix: { fig: bank('day-32-day-g2-1-64a3a7c5', 32, 'Imix'), feature: 'short strokes hang down to the lower edge' },
  Ik: { fig: bank('day-32-day-g2-2-519c866c', 32, 'Ik'), feature: 'a T-shaped mark in the middle' },
  Akbal: { fig: bank('day-32-day-g2-3-885f24b5', 32, 'Akbal'), feature: 'two upright panels, with a row of small scallops along the bottom' },
  Kan: { fig: bank('day-32-day-g5-2-f86d4491', 32, 'Kan'), feature: 'a small bar at the top and a short upright stub at the bottom centre' },
  Cimi: { fig: bank('day-32-day-g1-3-c59d7d51', 32, 'Cimi'), feature: 'a closed eye with lashes' },
  Manik: { fig: bank('day-32-day-g4-2-5f193859', 32, 'Manik'), feature: 'a shape like a hand, curled at the lower left' },
  Lamat: { fig: bank('day-32-day-g44-3-f0a114db', 32, 'Lamat'), feature: 'a cross dividing it into four, with a small ring in each quarter' },
  Muluc: { fig: bank('day-32-day-g3-1-62602572', 32, 'Muluc'), feature: 'a ring with a dot at its centre' },
  Oc: { fig: bank('day-32-day-g3-2-3683ccbe', 32, 'Oc'), feature: 'a curl on the right side, with a dot inside it' },
  Chuen: { fig: bank('day-32-day-g3-3-b492eeea', 32, 'Chuen'), feature: 'two curls facing each other above a pointed chin' },
  Eb: { fig: bank('day-32-day-g42-1-2abbea67', 32, 'Eb'), feature: 'a face in profile' },
  Ix: { fig: bank('day-32-day-g42-3-99ed4249', 32, 'Ix'), feature: 'scattered spots' },
};

// ── Dictionary entries (Pío Pérez, verbatim from the page's translation; v1 learn_maya_items) ──

export interface Entry { word: string; short: string; text: string; href: string; page: number }
export const ENTRIES: Record<string, Entry> = {
  kan: { word: 'kan', short: 'yellow', text: 'KAN: yellow, the color yellow.', href: pioPage(208), page: 208 },
  ik: { word: 'ik', short: 'wind', text: 'IK, IKAL: wind, air, breath, breathing, spirit, life.', href: pioPage(197), page: 197 },
  oc: { word: 'oc', short: 'foot', text: 'OC: foot and leg, footstep, trail, footprint.', href: pioPage(295), page: 295 },
  cimil: { word: 'cimil', short: 'death', text: 'CIMIL: illness. | Death.', href: pioPage(91), page: 91 },
  eb: { word: 'eb', short: 'staircase', text: 'EB, EBIL: staircase, ladder, step.', href: pioPage(139), page: 139 },
  balam: { word: 'balam', short: 'tiger, lion', text: 'BALAM, BALAMIL: tiger, lion.', href: pioPage(59), page: 59 },
};

// ── Items ──

interface Base {
  id: string;
  prompt: string;
  /** One line shown with a right answer. */
  why: string;
  /** The last item of a lesson: a real page, linked. */
  wild?: { href: string; label: string };
}

export type Item = Base & (
  | { kind: 'count'; fig: Fig; value: number }
  | { kind: 'place'; fig?: Fig; digits: number[]; places: number[]; options: number[] }
  | { kind: 'day'; fig: Fig; answer: Day | DaySign; options: (Day | DaySign)[]; note?: string }
  | { kind: 'next'; from: Day; options: Day[] }
  | { kind: 'word'; word: string; answer: string; options: string[] }
  | { kind: 'sign'; answer: SyllableKey; options: SyllableKey[] }
  | { kind: 'read'; signs: SyllableKey[]; entry: string; options: { text: string; misread?: { index: number; as: SyllableKey }; rule?: 'silent' | 'order' | 'dropped' }[] }
  | { kind: 'spell'; word: string; entry: string; answer: SyllableKey[]; options: SyllableKey[][] }
  | { kind: 'tap'; fig: Fig; zones: { label: string; x0: number; x1: number }[]; answer: number; after: Fig; hint: string }
);

export interface Example {
  title: string;
  body: string[];
  figs?: (Fig & { caption?: string; numeral?: number })[];
  pairs?: { left: Fig; right: Fig; caption: string }[];
  syllables?: SyllableKey[];
  days?: DaySign[];
  interactive?: 'numeral-builder' | 'cycles-13-20';
  after?: string[];
}

export interface Lesson {
  id: string;
  n: number;
  title: string;
  blurb: string;
  open: boolean;
  /** Worked examples are shown before the items at the same index in `steps`. */
  steps: (Example | Item)[];
  recap: string[];
}

export const isItem = (s: Example | Item): s is Item => 'kind' in s;

const COL = [360, 20, 1];

export const LESSONS: Lesson[] = [
  { id: 'intro', n: 0, title: 'Introduction', blurb: 'Four books, and a key misread for 386 years', open: true, steps: [], recap: [] },
  {
    id: 'counting',
    n: 1,
    title: 'Counting',
    blurb: 'Bar, dot and shell; then numbers in places',
    open: true,
    steps: [
      {
        title: 'A dot is one. A bar is five.',
        body: [
          'Up to nineteen, a Maya number is bars with dots above them. Count the bars in fives, then add the dots. A shell is zero.',
          'These are from the Dresden Codex. The scribes wrote numbers in black and in red; the colour does not change the value.',
        ],
        figs: [
          { ...bank('num-41-pos-L5-c82e6a82', 41, 'One dot'), caption: 'One dot: 1', numeral: 1 },
          { ...bank('num-27-pos-c1-360-e094b2a2', 27, 'Three dots'), caption: 'Three dots: 3', numeral: 3 },
          { ...bank('num-41-s3b-4-1dca193c', 41, 'Two red bars'), caption: 'Two bars, in red: 10', numeral: 10 },
          { ...bank('num-32-lo-g41-b-c12d6069', 32, 'Two bars and three dots'), caption: 'Two bars and three dots: 13', numeral: 13 },
          { ...bank('num-32-lo-g42-0-382d991e', 32, 'The shell'), caption: 'The shell: 0', numeral: 0 },
        ],
      },
      { id: 'c1-one', kind: 'count', prompt: 'What number is this?', fig: bank('num-32-up-g3-360-7be0f623', 32, 'A Maya number'), value: 1, why: 'One dot: 1.' },
      { id: 'c1-seven', kind: 'count', prompt: 'What number is this?', fig: bank('num-41-s3a-3-60e33857', 41, 'A Maya number'), value: 7, why: 'One bar and two dots: 5 + 2 = 7.' },
      { id: 'c1-ten', kind: 'count', prompt: 'This one is in red, and worn. What number is it?', fig: bank('num-27-dist-c3-1-b79c6b8a', 27, 'A Maya number in red'), value: 10, why: 'Two bars: 2 × 5 = 10. Red or black, the value is the same.' },
      { id: 'c1-fourteen', kind: 'count', prompt: 'What number is this?', fig: bank('num-27-pos-c2-1-f201ecb9', 27, 'A Maya number'), value: 14, why: 'Two bars and four dots: 10 + 4 = 14. Four dots is the most a number has; five dots become a bar.' },
      { id: 'c1-sixteen', kind: 'count', prompt: 'What number is this?', fig: bank('num-41-pos-L2-348ee661', 41, 'A Maya number'), value: 16, why: 'Three bars and one dot: 15 + 1 = 16.' },
      { id: 'c1-zero', kind: 'count', prompt: 'What number is this?', fig: bank('num-27-dist-c4-20-b8b00b4e', 27, 'A Maya number in red'), value: 0, why: 'The shell is zero. Here it holds a place empty, as 0 does in 20 or 105.' },
      {
        title: 'Bigger numbers stack',
        body: [
          'Above nineteen, the Maya stacked numbers in places, read from the top down. The bottom place counts ones; the place above it counts twenties.',
          'Two twenties and five ones is 2 × 20 + 5 = 45. A shell keeps a place empty: one twenty and a shell is 20.',
          'Try it: press + and − beside each place. "Plain counting" is twenties all the way up; "calendar places" is the count the codices use for days, which comes up at the end of this lesson.',
        ],
        interactive: 'numeral-builder',
      },
      { id: 'c1-place-45', kind: 'place', prompt: 'What number is this? The top place counts twenties, the bottom ones.', digits: [2, 5], places: [20, 1], options: [45, 7, 102, 25], why: '2 twenties and 5 ones: 40 + 5 = 45.' },
      { id: 'c1-place-20', kind: 'place', prompt: 'And this one?', digits: [1, 0], places: [20, 1], options: [20, 1, 10, 21], why: 'One twenty, and the shell holds the ones place empty: 20.' },
      {
        id: 'c1-wild',
        kind: 'place',
        prompt: 'This column on Dresden page 53 counts days. It has three places, and in the codex day counts the third place is 18 twenties, 360 days, close to a year. How many days is it?',
        fig: crop('dresden-53-column', 'A column of three numbers on Dresden page 53'),
        digits: [1, 7, 2],
        places: COL,
        options: [502, 542, 10, 142],
        why: '1 × 360 + 7 × 20 + 2 = 502 days, one of the running totals in this page\'s table.',
        wild: { href: dresdenPage(32), label: 'Open Dresden page 53' },
      },
    ],
    recap: [
      'A dot is one, a bar is five, a shell is zero. Up to nineteen, bars sit under the dots.',
      'Stacked numbers are read in places from the top: in plain counting each place is twenty times the one below.',
      'In the codex day counts the third place is 360, not 400. You read a running total on Dresden page 53: 502 days.',
    ],
  },
  {
    id: 'days',
    n: 2,
    title: 'Days',
    blurb: '13 numbers and 20 day signs',
    open: true,
    steps: [
      {
        title: 'A day is a number and a sign',
        body: [
          'On Dresden page 53 the red numbers stand on their side, to the left of each sign. Read down: 1 Imix, 2 Ik, 3 Akbal, three days in a row.',
          'The numbers run from 1 to 13, the signs through twenty names. Each day both move one step. After 13 the number starts again at 1 while the sign moves on: 12 Eb, 13 Ben, 1 Ix.',
          'So the same pair comes back only after 13 × 20 = 260 days.',
        ],
        figs: [{ src: `${R2}/learn-maya/${DRESDEN}/study-days-214d46f5.jpg`, alt: '1 Imix, 2 Ik, 3 Akbal on Dresden page 53', credit: 'Dresden Codex, page 53', href: dresdenPage(32) }],
        interactive: 'cycles-13-20',
        after: ['The twenty, in order: Imix, Ik, Akbal, Kan, Chicchan, Cimi, Manik, Lamat, Muluc, Oc, Chuen, Eb, Ben, Ix, Men, Cib, Caban, Etznab, Cauac, Ahau.'],
      },
      {
        title: 'What to look for',
        body: [
          `Several names are also Yucatec words, in Juan Pío Pérez's dictionary (1866–77): [ik](${YUCATEC}) is [wind, air, breath](${pioPage(197)}), [kan](${YUCATEC}) is [yellow](${pioPage(208)}), [oc](${YUCATEC}) is [foot](${pioPage(295)}), and [cimil](${YUCATEC}) is [illness, death](${pioPage(91)}).`,
          'Here are the signs of this lesson as the Dresden scribe painted them, each with the feature that tells it apart.',
        ],
        days: ['Imix', 'Ik', 'Akbal', 'Kan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc', 'Chuen'],
      },
      { id: 'c2-ik', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g2-2-519c866c', 32, 'A day sign'), answer: 'Ik', options: ['Ik', 'Kan', 'Imix', 'Akbal'], why: 'The T-shaped mark in the middle is Ik, wind.' },
      { id: 'c2-kan', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g5-2-f86d4491', 32, 'A day sign'), answer: 'Kan', options: ['Ik', 'Kan', 'Lamat', 'Muluc'], why: 'A small bar at the top, a stub at the bottom: Kan, yellow.' },
      { id: 'c2-next', kind: 'next', prompt: 'What day comes after 3 Akbal?', from: [3, 'Akbal'], options: [[4, 'Kan'], [4, 'Ik'], [3, 'Kan'], [4, 'Akbal']], why: 'Both move one step: 3 becomes 4, and Akbal is followed by Kan.' },
      { id: 'c2-cimi', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g4-1-db7e5efd', 32, 'A day sign'), answer: 'Cimi', options: ['Akbal', 'Manik', 'Cimi', 'Chuen'], why: 'The closed eye with lashes is Cimi; *cimil* is death.' },
      { id: 'c2-word', kind: 'word', prompt: 'Kan is a day and a word. What does *kan* mean in Pío Pérez\'s dictionary?', word: 'kan', answer: 'kan', options: ['kan', 'ik', 'oc', 'cimil'], why: 'Pío Pérez: "KAN: yellow, the color yellow."' },
      { id: 'c2-wrap', kind: 'next', prompt: 'What day comes after 13 Manik?', from: [13, 'Manik'], options: [[14, 'Lamat'], [1, 'Lamat'], [1, 'Manik'], [13, 'Lamat']], why: 'The number goes back to 1 after 13, and the sign moves on to Lamat.' },
      { id: 'c2-oc', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g3-2-3683ccbe', 32, 'A day sign'), answer: 'Oc', options: ['Muluc', 'Oc', 'Chuen', 'Imix'], why: 'A curl on the right with a dot inside: Oc, foot.' },
      { id: 'c2-lamat', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g44-3-f0a114db', 32, 'A day sign'), answer: 'Lamat', options: ['Muluc', 'Cimi', 'Ik', 'Lamat'], why: 'A cross dividing it into four, a ring in each quarter: Lamat.' },
      {
        id: 'c2-wild',
        kind: 'day',
        prompt: 'On Dresden page 53, read the day at the bottom of the left-hand column, number and sign.',
        note: 'The red number stands on its side to the left of the sign, and some of its paint has worn away: look for the bar first.',
        fig: crop('dresden-53-days', 'Three columns of days on Dresden page 53'),
        answer: [8, 'Cimi'],
        options: [[3, 'Cimi'], [8, 'Cimi'], [8, 'Akbal'], [13, 'Cimi']],
        why: 'A red bar and three dots, 8, and the closed eye of Cimi: 8 Cimi. [Förstemann](/book/6a09ff94fa20006dbaba9ecb?page=167) read the same in 1906.',
        wild: { href: dresdenPage(32), label: 'Open Dresden page 53' },
      },
    ],
    recap: [
      'A day is a number from 1 to 13 and one of twenty signs. Each day both move one step, and after 13 the number starts again at 1.',
      'The same pair comes back after 260 days.',
      'Some day names are Yucatec words: ik wind, kan yellow, oc foot. You read 8 Cimi on Dresden page 53.',
    ],
  },
  {
    id: 'syllables',
    n: 3,
    title: "Landa's key: syllables",
    blurb: 'Read Landa\'s page the way Knorozov did',
    open: true,
    steps: [
      {
        title: "Landa's page, read again",
        body: [
          `This is the "a b c" the scribe wrote for Landa ([page 320 of our copy](${landaPage(443)})). Landa wrote a Spanish letter beside each sign. Read as syllables, many of the signs are right.`,
          'His sign 11, which he called "ca", is the syllable *ka*. His sign 8, "é", is *e*. Here they are beside David Stuart\'s drawings of the same two signs. Stuart draws them as they were carved in Classic inscriptions, around AD 700; copied for Landa, or painted in a codex, the same sign looks rougher.',
        ],
        figs: [crop('landa-abc', "The scribe's signs for Landa, with Landa's letters")],
        pairs: [
          { left: crop('landa-ca', 'Landa sign 11'), right: { src: SYLLABLES.ka.src, alt: 'ka', credit: STUART_CREDIT, href: STUART_SOURCE }, caption: 'Landa\'s "ca": the syllable ka, a comb' },
          { left: crop('landa-e', 'Landa sign 8'), right: { src: SYLLABLES.e.src, alt: 'e', credit: STUART_CREDIT, href: STUART_SOURCE }, caption: 'Landa\'s "é": the syllable e' },
        ],
      },
      {
        title: 'The spelling rule',
        body: [
          'Most signs stand for a consonant and a vowel together: *ba*, *la*, *ma*. A few stand for a vowel alone: *e*, *o*.',
          'Many Yucatec words end in a consonant, but every sign ends in a vowel. So the scribe writes one more sign, and its vowel is not spoken. Usually it repeats the vowel before it: ba-la-ma is read *balam*.',
          `Pío Pérez gives [balam](${YUCATEC}) as ["tiger, lion"](${pioPage(59)}), his words for the jaguar.`,
          'These are the signs of this lesson, in David Stuart\'s drawings of the Classic carved forms. A sign in the Dresden Codex is the same sign in a painter\'s hand, and looks different.',
        ],
        syllables: ['ba', 'la', 'ma', 'ka', 'na', 'e', 'o', 'ko', 'ti'],
      },
      { id: 'c3-ka', kind: 'sign', prompt: 'Which sign is ka?', answer: 'ka', options: ['sa', 'e', 'ka', 'ti'], why: 'The bare comb is ka, the same sign as Landa\'s "ca".' },
      { id: 'c3-ma', kind: 'sign', prompt: 'Which sign is ma?', answer: 'ma', options: ['ba', 'ma', 'la', 'na'], why: 'The small ringed circle at the top, and no circles along the bottom: ma.' },
      {
        id: 'c3-balam',
        kind: 'read',
        prompt: 'Read these three signs as one word.',
        signs: ['ba', 'la', 'ma'],
        entry: 'balam',
        options: [{ text: 'balam' }, { text: 'balama', rule: 'silent' }, { text: 'malam', misread: { index: 0, as: 'ma' } }, { text: 'bala', rule: 'dropped' }],
        why: 'ba-la-ma: the last vowel is silent, so balam, the jaguar.',
      },
      {
        id: 'c3-kan',
        kind: 'read',
        prompt: 'You met this word in lesson 2. Read it.',
        signs: ['ka', 'na'],
        entry: 'kan',
        options: [{ text: 'kana', rule: 'silent' }, { text: 'kan' }, { text: 'san', misread: { index: 0, as: 'sa' } }, { text: 'nak', rule: 'order' }],
        why: 'ka-na: the a of na is silent, so kan, yellow, the day Kan.',
      },
      { id: 'c3-ti', kind: 'sign', prompt: 'Which sign is ti?', answer: 'ti', options: ['tu', 'o', 'ti', 'ka'], why: 'A ribbed cap over two rings, with a dot in the lower one: ti.' },
      {
        id: 'c3-ok',
        kind: 'spell',
        prompt: 'How would a scribe spell *oc*, "foot" (lesson 2)? It is said *ok*.',
        word: 'ok',
        entry: 'oc',
        answer: ['o', 'ko'],
        options: [['o', 'ka'], ['o', 'ko'], ['ko', 'o'], ['o']],
        why: 'o-ko: the silent last sign repeats the o before it.',
      },
      { id: 'c3-e', kind: 'sign', prompt: 'Which sign is e?', answer: 'e', options: ['ko', 'la', 'e', 'ma'], why: 'Three dots under an arc: e, Landa\'s "é".' },
      {
        id: 'c3-wild',
        kind: 'tap',
        prompt: 'Landa asked the scribe to write *ma in kati*, "I do not want". These are the five signs the scribe wrote, on page 318 of our copy. Tap the one that is ka.',
        hint: 'Look for the comb.',
        fig: crop('landa-makati-signs', 'Five signs the scribe wrote for Landa'),
        zones: [
          { label: 'ma', x0: 0.03, x1: 0.31 },
          { label: 'i', x0: 0.33, x1: 0.535 },
          { label: 'n', x0: 0.54, x1: 0.61 },
          { label: 'ka', x0: 0.625, x1: 0.815 },
          { label: 'ti', x0: 0.83, x1: 0.95 },
        ],
        answer: 3,
        after: crop('landa-makati', 'The five signs with the labels Landa printed above them'),
        why: 'The comb runs along the top of the round sign: ka. Landa printed the labels above them: ma, i, n, ka, ti. The scribe was writing syllables all along.',
        wild: { href: landaPage(441), label: 'Open Landa, page 318' },
      },
    ],
    recap: [
      'Most signs are a consonant and a vowel: ka, ma, ti. A few are a vowel alone: e, o.',
      'The last sign\'s vowel is silent and usually repeats the vowel before it: ba-la-ma is balam, ka-na is kan, o-ko is ok.',
      'Landa\'s "ca" and "é" are the syllables ka and e. You found ka in what the scribe wrote for him on page 318.',
    ],
  },
  { id: 'word-signs', n: 4, title: 'Word signs', blurb: 'K\'IN, HA\', AJAW, BALAM, and signs that help them', open: false, steps: [], recap: [] },
  { id: 'palenque-date', n: 5, title: 'Read a date at Palenque', blurb: 'The Tablet of the Cross, from its first glyph', open: false, steps: [], recap: [] },
  { id: 'codex-ai', n: 6, title: 'The codex and the AI', blurb: 'Read Dresden captions with the AI\'s guess beside you', open: false, steps: [], recap: [] },
];

export const OPEN_LESSONS = LESSONS.filter((l) => l.open && l.steps.length).map((l) => l.id);

/** Every course item by id, with its lesson: the judgements route accepts these ids. */
export const COURSE_ITEMS: Map<string, { lesson: string; item: Item }> = new Map(
  LESSONS.flatMap((l) => l.steps.filter(isItem).map((item) => [item.id, { lesson: l.id, item }] as const)),
);
