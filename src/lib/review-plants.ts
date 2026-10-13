// PRIOR ART: src/lib/review-candidates.ts `is_gold` / `gold_answer` (an attention-check field on
// pooled items that no builder ever sets, and book runs do not draw from the pool);
// scripts/maintenance/adjudicate-corrections.mjs planted decoy (#6679, plants ONE edit in a second
// reader's packet, offline, not in a page a volunteer reads). Neither can put a known error inside a
// book run, so this file does.
//
// review-plants — known-error pages inside volunteer book runs (#6682, #6418).
//
// WHY. A book-run review comes from one model reader whose model and settings we only know by its own
// report. Before its reviews and fixes can carry weight, each setup needs a measured catch rate: on a
// page where we KNOW one error, did it find it? So about one page in ten is served with one
// meaning-changing edit in its English. The volunteer is told at the start that some pages carry a
// test error; the model is not told which.
//
// SHAPE OF A PLANT. One whole-word swap in the translation: an antonym (sun → moon) or a changed
// number. (A swapped name was tried and dropped: the name swapped in is on the page by
// construction, which the next rule forbids.) The planted word must not occur anywhere
// else on the page, so a finding that quotes it can only be about the plant. The swap is made in the
// RAW stored text, at a place outside any markup, so the served (stripped) text and the hash agree.
//
// DETERMINISTIC. Whether a page is planted, and how, follows from sha256(volunteer, page): the same
// call twice serves the same page, and nothing in the response tells the model which pages are tests.

import { createHash } from 'crypto';

/** About one page in ten. A ten-page stretch then usually holds one. */
export const PLANT_RATE = 0.1;
/** Below this the page is too short to hide a plant without it being most of the page. */
const MIN_TEXT = 800;
/** Plants go in the middle of the page, away from running heads and page numbers. */
const EDGE = 0.1;
/** Larger than book-run's TAIL (400), measured on the raw text, which is a little longer. */
const TAIL_GUARD = 450;

export type PlantKind = 'antonym' | 'number';

export type Plant = {
  kind: PlantKind;
  original: string;
  planted: string;
  /** Offset of the swap in the raw text. */
  at: number;
  planted_text: string;
};

const ANTONYMS: Array<[string, string]> = [
  ['sun', 'moon'], ['day', 'night'], ['king', 'queen'], ['father', 'mother'], ['brother', 'sister'],
  ['son', 'daughter'], ['first', 'last'], ['before', 'after'], ['left', 'right'], ['east', 'west'],
  ['north', 'south'], ['hot', 'cold'], ['heaven', 'earth'], ['life', 'death'], ['white', 'black'],
  ['always', 'never'], ['many', 'few'], ['great', 'small'], ['fire', 'water'], ['above', 'below'],
  ['light', 'darkness'], ['good', 'evil'], ['young', 'old'], ['open', 'closed'], ['true', 'false'],
];
const SWAP = new Map<string, string>();
for (const [a, b] of ANTONYMS) { SWAP.set(a, b); SWAP.set(b, a); }

function digest(...parts: string[]): Buffer {
  return createHash('sha256').update(parts.join('\u0000')).digest();
}

/** Is this page a test page for this volunteer? */
export function shouldPlant(volunteerId: string, pageId: string, rate = PLANT_RATE): boolean {
  return digest('plant-v1', volunteerId, pageId).readUInt32BE(0) / 0x100000000 < rate;
}

/**
 * Character offsets a swap must not touch: every tag, and everything inside a tagged element
 * (`<note>…</note>`, `<header>…</header>`), which is apparatus rather than the page's text. The
 * `->…<-` centring marks are not tags.
 */
function markupMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const cover = (re: RegExp) => {
    for (const m of text.matchAll(re)) mask.fill(1, m.index!, m.index! + m[0].length);
  };
  cover(/<([a-z][\w-]*)\b[^<>]*>[\s\S]*?<\/\1\s*>/gi);
  cover(/<\/?[a-z][\w-]*\b[^<>]*>/gi);
  return mask;
}

function matchCase(model: string, word: string): string {
  if (model === model.toUpperCase() && model.length > 1) return word.toUpperCase();
  if (model[0] === model[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

const wordCount = (text: string, word: string) =>
  (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu')) ?? []).length;

type Candidate = { kind: PlantKind; at: number; original: string; planted: string };

function candidates(text: string, seed: Buffer): Candidate[] {
  const mask = markupMask(text);
  const lo = Math.floor(text.length * EDGE);
  // The next page carries this page's last lines (book-run `previous_page_tail`, real text): a plant
  // there would show up as two versions of one sentence.
  const hi = Math.min(Math.ceil(text.length * (1 - EDGE)), text.length - TAIL_GUARD);
  const ok = (at: number, len: number) => at >= lo && at + len <= hi && !mask[at] && !mask[at + len - 1];
  const out: Candidate[] = [];

  for (const m of text.matchAll(/(?<![\p{L}\p{N}])\p{L}+(?![\p{L}\p{N}])/gu)) {
    const other = SWAP.get(m[0].toLowerCase());
    if (other && ok(m.index!, m[0].length)) {
      out.push({ kind: 'antonym', at: m.index!, original: m[0], planted: matchCase(m[0], other) });
    }
  }

  for (const m of text.matchAll(/(?<![\p{L}\p{N}.,])\d{1,4}(?![\p{L}\p{N}]|[.,]\d)/gu)) {
    if (!ok(m.index!, m[0].length)) continue;
    const n = Number(m[0]);
    const step = 2 + (seed[4] % 7);
    const planted = String(n < 10 ? n + step : n + step * (n < 100 ? 1 : 10));
    out.push({ kind: 'number', at: m.index!, original: m[0], planted });
  }

  // A planted word that occurs elsewhere on the page would let a finding about that other place
  // count as a catch.
  return out.filter((c) => wordCount(text, c.planted) === 0);
}

const KINDS: PlantKind[] = ['antonym', 'number'];

/**
 * One meaning-changing swap in `text`, chosen deterministically from `seedParts`, or null when the
 * page offers no safe place for one.
 */
export function plantError(text: string, ...seedParts: string[]): Plant | null {
  if (typeof text !== 'string' || text.length < MIN_TEXT) return null;
  const seed = digest('plant-edit-v1', ...seedParts);
  const all = candidates(text, seed);
  // Kind first, then place: antonyms are on almost every page, so picking among all candidates
  // would measure only them (40 of 40 on a sample of real pages).
  const kinds = KINDS.filter((k) => all.some((c) => c.kind === k));
  if (!kinds.length) return null;
  const pool = all.filter((c) => c.kind === kinds[seed[6] % kinds.length]);
  const c = pool[seed.readUInt32BE(0) % pool.length];
  return {
    kind: c.kind,
    original: c.original,
    planted: c.planted,
    at: c.at,
    planted_text: text.slice(0, c.at) + c.planted + text.slice(c.at + c.original.length),
  };
}
