/**
 * The editions whose canonical references we publish — a reviewed list, not a
 * detector.
 *
 * #3661's guard is "publish a locus only where corroborated", and the honest way
 * to hold that line is for a human to have looked at each edition once. Adding a
 * book here is the review; the extractor then verifies what this file claims and
 * refuses the book if the data disagrees.
 *
 * `expect` fields are **regression pins, not inputs**: they record what a
 * reviewed extraction produced, so that a re-OCR or a parser change that shifts
 * the frame fails loudly instead of quietly re-addressing the corpus. They are
 * never consulted to decide where a locus is — see the note on
 * `.claude/docs/invariants/tests-that-are-not-guards.md`.
 */

import type { LocusSystem } from './locus';

export interface LocusEdition {
  book_id: string;
  system: LocusSystem;
  /** Short label for the witness, for the API response. */
  label: string;
  /**
   * True when this edition's OWN pagination is the citation standard (mechanism A
   * in #3661) — Bekker 1831, Stephanus 1578. Enables frame filling.
   * False when the reference is printed in the margin beside the text
   * (mechanism B) — Burnet's OCT, the Oxford translation.
   */
  frame: boolean;
  /** What a reviewed run produced. Drift here is a failure, not a new baseline. */
  expect?: {
    /** printed − scan, for a frame edition. */
    offset?: number;
    /** Inclusive canonical range the accepted anchors span. */
    ref_range?: [number, number];
    /** Floor on accepted anchors, so a silent collapse to a handful is caught. */
    min_anchors?: number;
  };
}

/**
 * ## The two root editions
 *
 * These are the editions the systems are named after, and we hold both complete.
 * That is what makes #3661 tractable at all: they are the reference frame, and
 * every other witness is bridged against them by number, not by guesswork.
 *
 * ## Why the Oxford translations matter more than their count suggests
 *
 * They carry Bekker numbers in the margin AND they are in English, so a reader
 * who cites `1094a` can be shown the Greek and a translation of the same lines.
 * That bridge is the deliverable; the Greek frame alone only relocates the
 * problem.
 */
export const LOCUS_EDITIONS: LocusEdition[] = [
  // ── Aristotle: Bekker ───────────────────────────────────────────
  {
    book_id: '69afe65fda5fa12b664a75a2',
    system: 'bekker',
    label: 'Bekker, Aristotelis Opera vol. I (Reimer, 1831) — Greek',
    frame: true,
    expect: { offset: -16, ref_range: [1, 789], min_anchors: 700 },
  },
  {
    book_id: '69937973b0a84a5763964d43',
    system: 'bekker',
    label: 'Bekker, Aristotelis Opera vol. II (Reimer, 1831) — Greek',
    frame: true,
    expect: { offset: 784, ref_range: [792, 1462], min_anchors: 600 },
  },
  {
    book_id: '69ae6681b3b0e7bf712d6201',
    system: 'bekker',
    label: 'Works of Aristotle vol. 2 (Oxford trans., Ross & Smith) — English',
    frame: false,
    expect: { ref_range: [184, 338], min_anchors: 300 },
  },
  {
    book_id: '69ae668db3b0e7bf712d66a9',
    system: 'bekker',
    label: 'Meteorologica, De Anima, Parva Naturalia (Oxford trans.) — English',
    frame: false,
    expect: { ref_range: [338, 486], min_anchors: 400 },
  },
  {
    book_id: '69ae6694b3b0e7bf712d6885',
    system: 'bekker',
    label: 'Historia Animalium (Oxford trans., D’Arcy Thompson) — English',
    frame: false,
    expect: { ref_range: [486, 633], min_anchors: 400 },
  },

  // ── Plato: Stephanus ────────────────────────────────────────────
  //
  // Stephanus numbers restart in each of the three 1578 volumes, and citation
  // practice keys on the dialogue rather than the volume. Work attribution from
  // the running head is therefore load-bearing here in a way it is not for
  // Bekker, whose numbers are unique corpus-wide.
  {
    book_id: '69b21d36ddb4fa7c305b4440',
    system: 'stephanus',
    label: 'Stephanus, Platonis Opera vol. 1 (1578) — Greek/Latin',
    frame: true,
    // 54 printed numbers are dropped as off-frame: the volume appends Estienne's
    // annotations, paginated separately from 1. Those numbers are real and are
    // not Stephanus references.
    expect: { offset: -42, ref_range: [1, 483], min_anchors: 400 },
  },
  {
    book_id: '69b21d42ddb4fa7c305b4693',
    system: 'stephanus',
    label: 'Stephanus, Platonis Opera vol. 2 (1578) — Greek/Latin',
    frame: true,
    expect: { offset: -12, ref_range: [3, 992], min_anchors: 900 },
  },
  {
    book_id: '69b21d4addb4fa7c305b4a88',
    system: 'stephanus',
    label: 'Stephanus, Platonis Opera vol. 3 (1578) — Greek/Latin',
    frame: true,
    // The weakest frame in the set: 75.9% of printed numbers sit on it, the rest
    // belong to Serranus's separately-paginated annotations. Above the floor, but
    // this is the edition to re-check first if anything drifts.
    expect: { offset: -14, ref_range: [3, 416], min_anchors: 350 },
  },
  {
    book_id: '699376d2b0a84a5763961a97',
    system: 'stephanus',
    label: 'Burnet, Platonis Opera (Republic, Timaeus, Critias), OCT 1902 — Greek',
    frame: false,
    expect: { ref_range: [18, 621], min_anchors: 550 },
  },
  {
    book_id: '69937734b0a84a57639630fa',
    system: 'stephanus',
    label: 'Burnet, Platonis Opera (Laws, Epinomis, Letters, Definitions), OCT 1907 — Greek',
    frame: false,
    expect: { ref_range: [309, 992], min_anchors: 650 },
  },
];

export function locusEdition(bookId: string): LocusEdition | undefined {
  return LOCUS_EDITIONS.find((e) => e.book_id === bookId);
}
