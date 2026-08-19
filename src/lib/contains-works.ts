/**
 * What works does this volume actually contain? Derived from the running heads
 * the printer put on every leaf.
 *
 * ## The problem
 *
 * Reported through MCP (#3652 A, #3653 items 1–2): four Aristotle volumes
 * advertise works in their titles that the scans do not contain.
 *
 *   6956953e…  "The Rhetoric, Poetic, and Nicomachean Ethics"  — only the Ethics
 *   69ae633c…  "Aristotelis Opera (Bekker) Vol. 2: Metaphysica…" — the SCHOLIA
 *   69b220b3…  "Metaphysica (Aldine)"                          — Ethics + Politics
 *   69b21bc3…  "Vol. 5 (Rhetoric, Poetics, Politics)"          — Problems, Mechanics, Metaphysics
 *
 * The reporter concluded: *"the Poetics appears in the catalogue under three
 * different titles and is in fact absent from all three. A researcher following
 * the catalog concludes the corpus holds a work it does not."*
 *
 * They were right about the titles and wrong about the conclusion — and only the
 * headers could show that. `ΠΕΡΙ ΠΟΙΗΤΙΚΗΣ` runs across 14 pages of the genuine
 * Bekker volume. **We hold the Poetics. Nothing said so.**
 *
 * ## Why the running head and not something else
 *
 * `<page-type>` cannot do this — it distinguishes text from blank, not one work
 * from another. The catalogue title is the thing under suspicion. The chapter
 * list is uneven and often absent. The running head is the one place where the
 * book states, on every single leaf, which work you are inside — printed for
 * exactly this purpose, and the reporter's own words: *"The running headers in
 * the OCR are perfectly reliable."*
 *
 * ## What this returns and what it does not
 *
 * It returns **header strings with page spans** — the evidence — not resolved
 * work identities. `ΤΩΝ ΜΕΤΑ ΤΑ ΦΥΣΙΚΑ` is legible to a Hellenist and to a
 * model, and mapping it to a canonical work id is a separate, harder problem
 * (#3661). Publishing the evidence without the identification is honest and
 * immediately useful; publishing a guessed identification would be neither.
 */

import { nameFormsFor } from './classical-name-forms';

export interface WorkSpan {
  /** The running head as printed, normalised for grouping. */
  header: string;
  first_page: number;
  last_page: number;
  /** Pages carrying this head. The strength of the claim. */
  page_count: number;
  /** page_count / (last_page - first_page + 1). Low means interleaved, not a block. */
  density: number;
}

/**
 * Collapse the spellings of one head into a single key.
 *
 * Three things make the same work look like several:
 *   - letter-spacing for display: `Π Ο Λ Ι Τ Ι Κ Ω Ν` vs `ΠΟΛΙΤΙΚΩΝ` (41 + 37
 *     pages of the same work in Bekker vol. 2, until this is handled)
 *   - a trailing book numeral: `ΠΟΛΙΤΙΚΩΝ Γ`, `ΠΡΟΒΛΗΜΑΤΩΝ ΚϚ`
 *   - punctuation and case
 */
/**
 * A trailing token is a book numeral only if what precedes it is a WORD.
 *
 * Without that guard, letter-spaced display capitals eat themselves: given
 * `Π Ο Λ Ι Τ Ι Κ Ω Ν`, every letter looks like a trailing numeral and the loop
 * strips right-to-left down to `Π`. Caught by a test, not by reading the code.
 */
function stripTrailingNumeral(s: string): string {
  const precededByWord = (str: string, matchLen: number) => {
    const before = str.slice(0, str.length - matchLen).trimEnd();
    const lastTok = before.split(/\s+/).pop() || '';
    return lastTok.length > 1;
  };
  for (;;) {
    let next = s;
    for (const re of [
      /\s+[IVXLC]{1,5}$/u,
      // Greek alphabetic numerals, optionally with the keraia (΄ / ʹ) that marks
      // a letter as a numeral — "ΠΟΛΙΤΙΚΩΝ ΤΟ Η΄" is book 8.
      /\s+[ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩϚ]{1,3}[΄ʹ´']?$/u,
      // ...and the bare article a Greek head puts before the numeral, so
      // "ἨΘΙΚΩ͂Ν ΜΕΓΆΛΩΝ ΤῸ" collapses onto "ἨΘΙΚΩ͂Ν ΜΕΓΆΛΩΝ".
      /\s+(?:ΤΟ|ΤῸ|ΤΩΝ|ΒΙΒΛΙΟΝ|LIB|LIBER)$/u,
    ]) {
      const m = next.match(re);
      if (m && precededByWord(next, m[0].length)) next = next.slice(0, next.length - m[0].length).trim();
    }
    next = next.trim();
    if (next === s) return s;
    s = next;
  }
}

export function normalizeHeader(raw: string): string {
  let s = raw.toUpperCase().replace(/[.,:;'"·´`]/g, ' ').replace(/\s+/g, ' ').trim();

  // ORDER MATTERS. Strip the book numeral while the letters are still spaced,
  // then collapse. The other way round turns "Π Ο Λ Ι Τ Ι Κ Ω Ν  Δ" into
  // "ΠΟΛΙΤΙΚΩΝΔ", which has no trailing token left to strip — and Bekker vol. 2
  // then reports ΠΟΛΙΤΙΚΩΝ, ΠΟΛΙΤΙΚΩΝΔ and ΠΟΛΙΤΙΚΩΝΕ as three separate works.
  s = stripTrailingNumeral(s);

  // Letter-spaced display capitals: "Π Ο Λ Ι Τ Ι Κ Ω Ν" -> "ΠΟΛΙΤΙΚΩΝ".
  s = s.replace(/(?:(?<=\s|^)\p{L}\s){2,}\p{L}(?=\s|$)/gu, (m) => m.replace(/\s+/g, ''));
  s = s.replace(/\s+/g, ' ').trim();

  return stripTrailingNumeral(s);
}

/** Running heads that name a division of the book rather than a work in it. */
const NOT_A_WORK =
  /^(INTRODUCTION|PREFACE|CONTENTS|INDEX|ERRATA|ADVERTISEMENT|APPENDIX|NOTES?|DEDICATION|PROLEGOMENA|ΠΙΝΑΞ|ΠΡΟΛΟΓΟΣ|CORRIGENDA|BIBLIOGRAPH\w*)$/i;

export interface DeriveOptions {
  /** A head must appear on at least this many pages to count as a work. */
  minPages?: number;
  /** ...and cover at least this share of its own span, so scattered noise drops. */
  minDensity?: number;
  /**
   * The book's author. A running head that is only the author's name names no
   * work — the Aldine Aristotle heads 159 pages with `ἈΡΙΣΤΟΤΈΛΟΥΣ` alone, which
   * would otherwise be reported as a work spanning nearly the whole volume.
   */
  author?: string;
}

/**
 * Derive the contained works from `[pageNumber, headerText]` pairs.
 *
 * Grouped by normalised head rather than by contiguous run: a work's head
 * alternates across the opening in many books (verso carries the work, recto the
 * book number), so strict runs fragment one work into dozens. Bekker vol. 2
 * yields 48 "runs" for 7 works, and 7 clean spans when grouped.
 */
export function deriveContainedWorks(
  headers: Array<[number, string]>,
  opts: DeriveOptions = {},
): WorkSpan[] {
  const minPages = opts.minPages ?? 8;
  const minDensity = opts.minDensity ?? 0.12;

  // Author-name forms to reject, normalised exactly like the heads.
  //
  // The Latin form alone is not enough: a Greek book heads its pages with the
  // Greek genitive. The Aldine Aristotle heads 159 pages `ἈΡΙΣΤΟΤΈΛΟΥΣ` while
  // its `author` field says "Aristotle", so a Latin-only comparison reports the
  // author's name as a contained work spanning most of the volume. The Greek
  // forms built for search (src/lib/classical-name-forms.ts) are exactly the
  // list needed here.
  const authorKeys = [
    ...(opts.author || '').split(/[;,|]/),
    ...nameFormsFor(opts.author),
  ]
    .map((a) => normalizeHeader(a.trim()))
    .filter((a) => a.length >= 4);

  const groups = new Map<string, number[]>();
  for (const [page, raw] of headers) {
    if (!raw) continue;
    const key = normalizeHeader(raw);
    if (!key || key.length < 4 || NOT_A_WORK.test(key)) continue;
    if (!/\p{L}/u.test(key)) continue;
    // A bare preposition left by a truncated head — "ΕΙΣ" ("on…", the opening of
    // every commentary title) heads 123 pages of the Scholia volume and
    // identifies nothing.
    if (!/\s/.test(key) && key.length < 6) continue;
    if (authorKeys.includes(key)) continue;
    const arr = groups.get(key);
    if (arr) arr.push(page);
    else groups.set(key, [page]);
  }

  // Merge a key that is a prefix of a longer one. Once letter-spacing has been
  // collapsed, a numeral fused to the end of the word cannot be told from the
  // word's own last letter — ΠΟΛΙΤΙΚΩΝ, ΠΟΛΙΤΙΚΩΝΔ and ΠΟΛΙΤΙΚΩΝΕ are the same
  // work, but ΠΟΛΙΤΙΚΩΝ genuinely ends in Ν, which is also the numeral 50. So
  // resolve it here, where both candidates are visible, instead of guessing
  // during normalisation.
  const keys = [...groups.keys()].sort((a, b) => a.length - b.length);
  for (const short of keys) {
    if (!groups.has(short) || short.length < 6) continue;
    for (const long of keys) {
      if (long === short || !groups.has(long)) continue;
      if (long.startsWith(short) && long.length - short.length <= 2) {
        groups.get(short)!.push(...groups.get(long)!);
        groups.delete(long);
      }
    }
  }

  const spans: WorkSpan[] = [];
  for (const [header, pages] of groups) {
    pages.sort((a, b) => a - b);
    const first = pages[0];
    const last = pages[pages.length - 1];
    const density = pages.length / (last - first + 1);
    if (pages.length < minPages || density < minDensity) continue;
    spans.push({ header, first_page: first, last_page: last, page_count: pages.length, density: Number(density.toFixed(3)) });
  }
  return spans.sort((a, b) => a.first_page - b.first_page);
}
