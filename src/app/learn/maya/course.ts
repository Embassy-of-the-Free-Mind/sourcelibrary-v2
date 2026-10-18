/**
 * The /learn/maya course (#6921, v2): lessons 0-3 of six, as data.
 *
 * Every picture is a crop of a page held in the library (the Dresden Codex,
 * Landa's Relación) or a drawing from `maya_signs` (David Stuart's syllabary),
 * with its credit and a link to its page. Crops new to the course are rendered
 * by scripts/learn/build-maya-course-crops.mjs (course-crops.json); the numeral
 * and day-sign crops are v1's, from learn_maya_items, each checked by eye.
 *
 * Writing (Derek, 2026-10-18): picture first, then one plain line. One idea per
 * card, about 25 words of English at most. tests/unit/learn-maya-course.test.ts
 * holds the word limit and the banned-phrase list.
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
export const PALENQUE_PAGE = '/book/6a9f3f9c83c3b522416e4456?page=222';

export interface Fig {
  src: string;
  alt: string;
  /** The credit line, linked to href (the page or the source). */
  credit: string;
  href: string;
}

type CropId = keyof typeof crops;
export const crop = (id: CropId, alt: string): Fig => ({ src: crops[id].url, alt, credit: crops[id].label, href: crops[id].page_url });

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
export const WAYEB_NOTE = 'These two are often confused (Kettunen & Helmke, Wayeb handbook, 2025).';
/** Said wherever Stuart's drawings stand beside a codex or Landa sign. */
export const CARVED_NOTE = 'Stuart draws the carved form, around AD 700. A painted sign looks rougher.';

export interface Syllable {
  value: string;
  src: string;
  /** What to look at: the feature that tells it from its neighbours. */
  feature: string;
}

const st = (file: string) => `${R2}/reference/maya/stuart-syllabary-v2/${file}.png`;

export const SYLLABLES = {
  ba: { value: 'ba', src: st("stuart2013-b-a-1-28d3df35"), feature: 'a striped oval on top and small circles along the bottom' },
  ma: { value: 'ma', src: st('stuart2013-ma-2-ed07eeee'), feature: 'a small ringed circle on top with dots around it, and no circles along the bottom' },
  la: { value: 'la', src: st('stuart2013-la-1-58d19365'), feature: 'a ring on top and two small rings below, either side of a V' },
  na: { value: 'na', src: st('stuart2013-na-1-57a3e69e'), feature: 'a flat band, wider than tall, with small marks inside' },
  ka: { value: 'ka', src: st('stuart2013-ka-2-b3c3a0aa'), feature: 'one long curved stroke with short teeth' },
  sa: { value: 'sa', src: st('stuart2013-sa-3-f248e3d6'), feature: 'a squared bracket with a column of dots down its open side' },
  e: { value: 'e', src: st('stuart2013-e-1-3e0e4802'), feature: 'three dots under an arc, in a rounded square' },
  ti: { value: 'ti', src: st('stuart2013-ti-1-b5a2073a'), feature: 'a ribbed cap over two rings, with a dot in the lower ring' },
  tu: { value: 'tu', src: st('stuart2013-tu-1-3def7bb5'), feature: 'a tall stack, cross-hatched in its lower half' },
  o: { value: 'o', src: st('stuart2013-o-1-e7be482c'), feature: 'a narrow upright with a cross-hatched top and dots running down it' },
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
  Akbal: { fig: bank('day-32-day-g2-3-885f24b5', 32, 'Akbal'), feature: 'two upright panels, with small scallops along the bottom' },
  Kan: { fig: bank('day-32-day-g5-2-f86d4491', 32, 'Kan'), feature: 'a small bar at the top and a short stub at the bottom' },
  Cimi: { fig: bank('day-32-day-g1-3-c59d7d51', 32, 'Cimi'), feature: 'a closed eye with lashes' },
  Manik: { fig: bank('day-32-day-g4-2-5f193859', 32, 'Manik'), feature: 'a shape like a hand, curled at the lower left' },
  Lamat: { fig: bank('day-32-day-g44-3-f0a114db', 32, 'Lamat'), feature: 'a cross making four quarters, a small ring in each' },
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

// ── Lesson 0: the story, as short screens ──

export interface IntroScreen {
  fig?: Fig;
  title: string;
  body: string;
  /** Source detail, small, under the text. */
  note?: string;
}

export const INTRO: IntroScreen[] = [
  {
    fig: crop('dresden-53-leaf', 'A page of the Dresden Codex: columns of glyphs, bar-and-dot numbers in red and black, and two seated figures'),
    title: 'This is a Maya book',
    body: `A page of the [Dresden Codex](${dresdenPage(32)}), one of four Maya books that survived. In this course you will read a date on it.`,
    note: `Later lessons go on to a sentence carved at [Palenque](${PALENQUE_PAGE}) in 692.`,
  },
  {
    title: '“Burned them all”',
    body: `In 1566 Bishop Diego de Landa wrote that the friars found many of these books and [burned them all](${landaPage(439)}).`,
  },
  {
    fig: crop('landa-abc', "The scribe's signs for Landa, with Landa's letters"),
    title: 'A key',
    body: 'In the same chapter, a Maya scribe wrote him an “a, b, c”. Landa put a Spanish letter beside each sign.',
  },
  {
    fig: crop('landa-le', 'Four signs for le, labelled e, L, e, Lé'),
    title: 'Four signs for one word',
    body: `Landa spelled *le*, “noose”, letter by letter. The scribe wrote [four signs](${landaPage(441)}). Landa labelled them e, L, e, Lé.`,
  },
  {
    title: 'Syllables',
    body: `The scribe wrote sounds, one syllable per sign. Landa read them as letters, and [his key](${landaPage(443)}) made no sense. It stayed misread for 386 years.`,
  },
  {
    fig: crop('landa-ca', 'Landa sign 11'),
    title: 'Knorozov',
    body: 'In 1952 Yuri Knorozov read the signs as syllables. Landa’s “ca” is the syllable *ka*. You will read his page that way in lesson 3.',
    note: 'The story in full: Michael D. Coe, *Breaking the Maya Code*.',
  },
];

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

/** A teaching card: the picture first, then a title and one plain line. */
export interface Example {
  title: string;
  body: string;
  /** Source detail, small, under the line. */
  note?: string;
  figs?: (Fig & { caption?: string; numeral?: number })[];
  pairs?: { left: Fig; right: Fig; caption: string }[];
  syllables?: SyllableKey[];
  /** A spelling, drawn sign by sign with the reading under each. */
  signs?: SyllableKey[];
  /** A stacked number, top to bottom, with its places. */
  stack?: { digits: number[]; places: number[] };
  days?: DaySign[];
  /** Names shown as a row of small chips (the twenty day names). */
  chips?: string[];
  interactive?: 'cycles-13-20';
}

export interface Lesson {
  id: string;
  n: number;
  title: string;
  blurb: string;
  open: boolean;
  steps: (Example | Item)[];
  recap: string[];
}

export const isItem = (s: Example | Item): s is Item => 'kind' in s;

const COL = [360, 20, 1];

export const LESSONS: Lesson[] = [
  { id: 'intro', n: 0, title: 'A bishop and a scribe', blurb: 'Landa, his alphabet, and Knorozov', open: true, steps: [], recap: [] },
  {
    id: 'counting',
    n: 1,
    title: 'Counting',
    blurb: 'Dots, bars, shells, and stacked numbers',
    open: true,
    steps: [
      {
        title: 'A dot is 1. A bar is 5.',
        body: 'Count the bars in fives, then add the dots. A shell is zero.',
        figs: [
          { ...bank('num-41-pos-L5-c82e6a82', 41, 'One dot'), caption: '1', numeral: 1 },
          { ...bank('num-27-pos-c1-360-e094b2a2', 27, 'Three dots'), caption: '3', numeral: 3 },
          { ...bank('num-32-lo-g41-b-c12d6069', 32, 'Two bars and three dots'), caption: '13', numeral: 13 },
          { ...bank('num-32-lo-g42-0-382d991e', 32, 'The shell'), caption: '0', numeral: 0 },
        ],
      },
      { id: 'c1-one', kind: 'count', prompt: 'What number is this?', fig: bank('num-32-up-g3-360-7be0f623', 32, 'A Maya number'), value: 1, why: 'One dot: 1.' },
      { id: 'c1-seven', kind: 'count', prompt: 'What number is this?', fig: bank('num-41-s3a-3-60e33857', 41, 'A Maya number'), value: 7, why: 'One bar and two dots: 5 + 2 = 7.' },
      {
        title: 'Red or black, same number',
        body: 'The scribes wrote numbers in black and in red. The colour does not change the value.',
        figs: [{ ...bank('num-41-s3b-4-1dca193c', 41, 'Two red bars'), caption: 'Two bars in red: 10', numeral: 10 }],
      },
      { id: 'c1-ten', kind: 'count', prompt: 'This one is red and worn. What number is it?', fig: bank('num-27-dist-c3-1-b79c6b8a', 27, 'A Maya number in red'), value: 10, why: 'Two bars: 2 × 5 = 10.' },
      { id: 'c1-fourteen', kind: 'count', prompt: 'What number is this?', fig: bank('num-27-pos-c2-1-f201ecb9', 27, 'A Maya number'), value: 14, why: 'Two bars and four dots: 10 + 4 = 14. Five dots would make a bar.' },
      { id: 'c1-sixteen', kind: 'count', prompt: 'What number is this?', fig: bank('num-41-pos-L2-348ee661', 41, 'A Maya number'), value: 16, why: 'Three bars and one dot: 15 + 1 = 16.' },
      { id: 'c1-zero', kind: 'count', prompt: 'What number is this?', fig: bank('num-27-dist-c4-20-b8b00b4e', 27, 'A Maya number in red'), value: 0, why: 'The shell is zero. It holds a place empty, like the 0 in 20.' },
      {
        title: 'Bigger numbers stack',
        body: 'Read from the top. The bottom place counts ones, the place above counts twenties. 2 twenties and 5 ones: 45.',
        stack: { digits: [2, 5], places: [20, 1] },
      },
      { id: 'c1-place-45', kind: 'place', prompt: 'Top place: twenties. Bottom: ones. What number?', digits: [2, 5], places: [20, 1], options: [45, 7, 102, 25], why: '2 twenties and 5 ones: 40 + 5 = 45.' },
      { id: 'c1-place-20', kind: 'place', prompt: 'And this one?', digits: [1, 0], places: [20, 1], options: [20, 1, 10, 21], why: 'One twenty, and a shell in the ones place: 20.' },
      {
        id: 'c1-wild',
        kind: 'place',
        prompt: 'This column on Dresden page 53 counts days. In day counts the third place is 360 days. How many days?',
        fig: crop('dresden-53-column', 'A column of three numbers on Dresden page 53'),
        digits: [1, 7, 2],
        places: COL,
        options: [502, 542, 10, 142],
        why: '1 × 360 + 7 × 20 + 2 = 502 days, one of the running totals in this page’s table.',
        wild: { href: dresdenPage(32), label: 'Open Dresden page 53' },
      },
    ],
    recap: [
      'A dot is 1, a bar is 5, a shell is 0.',
      'Stacked numbers read from the top, place by place.',
      'In day counts the third place is 360. You read 502 days on Dresden page 53.',
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
        body: 'Read down: 1 Imix, 2 Ik, 3 Akbal. The red number lies on its side, left of the sign.',
        figs: [{ src: `${R2}/learn-maya/${DRESDEN}/study-days-214d46f5.jpg`, alt: '1 Imix, 2 Ik, 3 Akbal on Dresden page 53', credit: 'Dresden Codex, page 53', href: dresdenPage(32) }],
      },
      {
        title: 'What to look for',
        body: 'Each sign has one feature that tells it apart.',
        days: ['Imix', 'Ik', 'Akbal', 'Kan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc', 'Chuen'],
      },
      { id: 'c2-ik', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g2-2-519c866c', 32, 'A day sign'), answer: 'Ik', options: ['Ik', 'Kan', 'Imix', 'Akbal'], why: 'The T-shaped mark in the middle: Ik, wind.' },
      { id: 'c2-kan', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g5-2-f86d4491', 32, 'A day sign'), answer: 'Kan', options: ['Ik', 'Kan', 'Lamat', 'Muluc'], why: 'A small bar at the top, a stub at the bottom: Kan, yellow.' },
      {
        title: 'Both move one step a day',
        body: 'The number goes 1 to 13, then starts again. The sign goes through twenty names: 12 Eb, 13 Ben, 1 Ix.',
        chips: ['Imix', 'Ik', 'Akbal', 'Kan', 'Chicchan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc', 'Chuen', 'Eb', 'Ben', 'Ix', 'Men', 'Cib', 'Caban', 'Etznab', 'Cauac', 'Ahau'],
      },
      { id: 'c2-next', kind: 'next', prompt: 'What day comes after 3 Akbal?', from: [3, 'Akbal'], options: [[4, 'Kan'], [4, 'Ik'], [3, 'Kan'], [4, 'Akbal']], why: '3 becomes 4, and Akbal is followed by Kan.' },
      { id: 'c2-cimi', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g4-1-db7e5efd', 32, 'A day sign'), answer: 'Cimi', options: ['Akbal', 'Manik', 'Cimi', 'Chuen'], why: 'The closed eye with lashes is Cimi. *Cimil* is death.' },
      {
        title: 'Some days are words',
        body: `[Ik](${YUCATEC}) is [wind, air, breath](${pioPage(197)}), [kan](${YUCATEC}) is [yellow](${pioPage(208)}), [oc](${YUCATEC}) is [foot](${pioPage(295)}), and [cimil](${YUCATEC}) is [illness, death](${pioPage(91)}).`,
        note: 'Juan Pío Pérez, Yucatec dictionary, 1866–77.',
        figs: [
          { ...DAY_FIG.Ik!.fig, caption: 'Ik: wind' },
          { ...DAY_FIG.Kan!.fig, caption: 'Kan: yellow' },
          { ...DAY_FIG.Oc!.fig, caption: 'Oc: foot' },
          { ...DAY_FIG.Cimi!.fig, caption: 'Cimi: death' },
        ],
      },
      { id: 'c2-word', kind: 'word', prompt: 'Kan is a day and a word. What does *kan* mean?', word: 'kan', answer: 'kan', options: ['kan', 'ik', 'oc', 'cimil'], why: 'Pío Pérez: “KAN: yellow, the color yellow.”' },
      {
        title: 'Back in 260 days',
        body: 'The same number and sign meet again after 13 × 20 = 260 days.',
        interactive: 'cycles-13-20',
      },
      { id: 'c2-wrap', kind: 'next', prompt: 'What day comes after 13 Manik?', from: [13, 'Manik'], options: [[14, 'Lamat'], [1, 'Lamat'], [1, 'Manik'], [13, 'Lamat']], why: 'After 13 the number goes back to 1, and the sign moves on to Lamat.' },
      { id: 'c2-oc', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g3-2-3683ccbe', 32, 'A day sign'), answer: 'Oc', options: ['Muluc', 'Oc', 'Chuen', 'Imix'], why: 'A curl on the right with a dot inside: Oc, foot.' },
      { id: 'c2-lamat', kind: 'day', prompt: 'Which day sign is this?', fig: bank('day-32-day-g44-3-f0a114db', 32, 'A day sign'), answer: 'Lamat', options: ['Muluc', 'Cimi', 'Ik', 'Lamat'], why: 'A cross making four quarters, a ring in each: Lamat.' },
      {
        id: 'c2-wild',
        kind: 'day',
        prompt: 'Dresden page 53: read the day at the bottom of the left column, number and sign.',
        note: 'The red number lies on its side, left of the sign. Some paint has worn away: find the bar first.',
        fig: crop('dresden-53-days', 'Three columns of days on Dresden page 53'),
        answer: [8, 'Cimi'],
        options: [[3, 'Cimi'], [8, 'Cimi'], [8, 'Akbal'], [13, 'Cimi']],
        why: 'A red bar and three dots is 8, and the closed eye is Cimi: 8 Cimi. [Förstemann](/book/6a09ff94fa20006dbaba9ecb?page=167) read the same in 1906.',
        wild: { href: dresdenPage(32), label: 'Open Dresden page 53' },
      },
    ],
    recap: [
      'A day is a number from 1 to 13 and one of twenty signs.',
      'Both move one step a day. The same day comes back after 260 days.',
      'Some day names are words: ik wind, kan yellow, oc foot. You read 8 Cimi on Dresden page 53.',
    ],
  },
  {
    id: 'syllables',
    n: 3,
    title: 'Landa’s key: syllables',
    blurb: 'Read Landa’s page as syllables',
    open: true,
    steps: [
      {
        title: 'Landa’s page, read again',
        body: `The “a b c” the scribe wrote for Landa ([page 320 of our copy](${landaPage(443)})). Read as syllables, many of the signs are right.`,
        figs: [crop('landa-abc', "The scribe's signs for Landa, with Landa's letters")],
      },
      {
        title: 'His “ca” is ka. His “é” is e.',
        body: 'Left, the scribe’s sign for Landa. Right, David Stuart’s drawing of the same sign.',
        note: CARVED_NOTE,
        pairs: [
          { left: crop('landa-ca', 'Landa sign 11'), right: { src: SYLLABLES.ka.src, alt: 'ka', credit: STUART_CREDIT, href: STUART_SOURCE }, caption: 'Sign 11, “ca”: the syllable ka' },
          { left: crop('landa-e', 'Landa sign 8'), right: { src: SYLLABLES.e.src, alt: 'e', credit: STUART_CREDIT, href: STUART_SOURCE }, caption: 'Sign 8, “é”: the syllable e' },
        ],
      },
      {
        title: 'One sign, one syllable',
        body: 'Most signs are a consonant and a vowel: ba, la, ma. A few are a vowel alone: e, o.',
        note: CARVED_NOTE,
        syllables: ['ba', 'la', 'ma', 'ka', 'na', 'e', 'o', 'ko', 'ti'],
      },
      { id: 'c3-ka', kind: 'sign', prompt: 'Which sign is ka?', answer: 'ka', options: ['sa', 'e', 'ka', 'ti'], why: 'The bare comb is ka, the same sign as Landa’s “ca”.' },
      { id: 'c3-ma', kind: 'sign', prompt: 'Which sign is ma?', answer: 'ma', options: ['ba', 'ma', 'la', 'na'], why: 'A small ringed circle on top, and no circles along the bottom: ma.' },
      {
        title: 'The last vowel is silent',
        body: 'Every sign ends in a vowel. At the end of a word that vowel is silent, and usually repeats the one before: ba-la-ma is *balam*.',
        note: `Pío Pérez gives [balam](${YUCATEC}) as [“tiger, lion”](${pioPage(59)}), his words for the jaguar.`,
        signs: ['ba', 'la', 'ma'],
      },
      {
        id: 'c3-balam',
        kind: 'read',
        prompt: 'Read these three signs as one word.',
        signs: ['ba', 'la', 'ma'],
        entry: 'balam',
        options: [{ text: 'balam' }, { text: 'balama', rule: 'silent' }, { text: 'malam', misread: { index: 0, as: 'ma' } }, { text: 'bala', rule: 'dropped' }],
        why: 'ba-la-ma, last vowel silent: balam, the jaguar.',
      },
      {
        id: 'c3-kan',
        kind: 'read',
        prompt: 'You met this word in lesson 2. Read it.',
        signs: ['ka', 'na'],
        entry: 'kan',
        options: [{ text: 'kana', rule: 'silent' }, { text: 'kan' }, { text: 'san', misread: { index: 0, as: 'sa' } }, { text: 'nak', rule: 'order' }],
        why: 'ka-na, last vowel silent: kan, yellow, the day Kan.',
      },
      { id: 'c3-ti', kind: 'sign', prompt: 'Which sign is ti?', answer: 'ti', options: ['tu', 'o', 'ti', 'ka'], why: 'A ribbed cap over two rings, a dot in the lower one: ti.' },
      {
        id: 'c3-ok',
        kind: 'spell',
        prompt: 'Spell *oc*, “foot” (lesson 2). It is said *ok*.',
        word: 'ok',
        entry: 'oc',
        answer: ['o', 'ko'],
        options: [['o', 'ka'], ['o', 'ko'], ['ko', 'o'], ['o']],
        why: 'o-ko: the silent last sign repeats the o.',
      },
      { id: 'c3-e', kind: 'sign', prompt: 'Which sign is e?', answer: 'e', options: ['ko', 'la', 'e', 'ma'], why: 'Three dots under an arc: e, Landa’s “é”.' },
      {
        id: 'c3-wild',
        kind: 'tap',
        prompt: 'Landa asked for *ma in kati*, “I do not want”. The scribe wrote these five signs (page 318 of our copy). Tap ka.',
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
        why: 'The comb runs along the top of the round sign: ka. Landa printed his labels above them: ma, i, n, ka, ti.',
        wild: { href: landaPage(441), label: 'Open Landa, page 318' },
      },
    ],
    recap: [
      'Most signs are a consonant and a vowel. A few are a vowel alone.',
      'The last vowel is silent: ba-la-ma is balam, ka-na is kan, o-ko is ok.',
      'Landa’s “ca” and “é” are ka and e. You found ka on Landa’s page 318.',
    ],
  },
  { id: 'word-signs', n: 4, title: 'Word signs', blurb: 'Signs for whole words: K’IN, HA’, AJAW, BALAM', open: false, steps: [], recap: [] },
  { id: 'palenque-date', n: 5, title: 'A date at Palenque', blurb: 'The Tablet of the Cross, from its first glyph', open: false, steps: [], recap: [] },
  { id: 'codex-ai', n: 6, title: 'The codex and the AI', blurb: 'Read Dresden captions with the AI’s guess beside you', open: false, steps: [], recap: [] },
];

/**
 * The glyph on each lesson's node in the course map. Lessons 4-6 are locked and
 * shown greyed. Stuart's and Wayeb's drawings are carved forms and are credited
 * under the map; the codex glyphs are crops of the Dresden page.
 */
export type NodeGlyph = { numeral: number } | { src: string; alt: string; drawing?: boolean };
export const NODE_GLYPH: Record<string, NodeGlyph> = {
  intro: { src: crops['landa-ca'].url, alt: 'Landa’s sign 11' },
  counting: { numeral: 13 },
  days: { src: DAY_FIG.Cimi!.fig.src, alt: 'The day sign Cimi, Dresden page 53' },
  syllables: { src: SYLLABLES.ka.src, alt: 'The syllable ka', drawing: true },
  'word-signs': { src: `${R2}/reference/maya/wayeb-handbook-2025/wayeb2025-logo-ajaw-1-d4ca9359.png`, alt: 'The word sign AJAW', drawing: true },
  'palenque-date': { src: `${R2}/reference/maya/palenque-mythology-2006/tc-main-tablet-A1-B2-3deaf928.png`, alt: 'The first glyph of the Tablet of the Cross', drawing: true },
  'codex-ai': { src: DAY_FIG.Ik!.fig.src, alt: 'The day sign Ik, Dresden page 53' },
};
export const MAP_CREDITS: { label: string; text: string; href?: string }[] = [
  { label: 'Lesson 3', text: STUART_CREDIT, href: STUART_SOURCE },
  { label: 'Lesson 4', text: 'Drawing: Kettunen & Helmke 2025, Wayeb Workshop Handbook', href: 'https://www.wayeb.org/resources-links/wayeb-resources/workshop-handbook/' },
  { label: 'Lesson 5', text: 'Drawing: David Stuart, The Palenque Mythology (2006), used with permission' },
];

export const OPEN_LESSONS = LESSONS.filter((l) => l.open && l.steps.length).map((l) => l.id);

/** Every course item by id, with its lesson: the judgements route accepts these ids. */
export const COURSE_ITEMS: Map<string, { lesson: string; item: Item }> = new Map(
  LESSONS.flatMap((l) => l.steps.filter(isItem).map((item) => [item.id, { lesson: l.id, item }] as const)),
);
