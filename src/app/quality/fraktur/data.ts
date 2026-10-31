// Every figure on /quality/fraktur (#7818), copied from the experiment record named beside it and checked against that
// file on 2026-10-31. Change a figure only together with its record. Rates are drawn from k and n here, never retyped.

const EXP = 'scripts/eval/experiments/';

export const RECORDS = {
  draw7701: `${EXP}2026-10-30-german-cheaper-first-reads-7701.md`,
  correction7818: `${EXP}2026-10-31-correction-pass-paired-7818.md`,
  paddle5660: `${EXP}2026-10-03-open-engine-print-5660.md`,
  bakeoff5660: `${EXP}2026-10-04-ocr-bakeoff-round-3-5660.md`,
  dta6012: `${EXP}2026-10-06-typed-references-dta-camena-eebo-6012.md`,
  perCall7522: `${EXP}2026-10-27-agy-ocr-pages-per-call-7522.md`,
} as const;

/** The leaf shown at the top: Andreae, Chymische Hochzeit (Strasbourg 1616), scan 132, printed page 128. */
export const LEAF = {
  bookId: '69c86fc56c6f3cc53c85715c',
  page: 132,
  printed: '128',
  title: 'Chymische Hochzeit Christiani Rosenkreutz',
  author: 'Johann Valentin Andreae',
  date: 'Strasbourg, 1616',
  copy: 'Bibliotheca Philosophica Hermetica, Amsterdam',
  image: 'https://images.sourcelibrary.org/cropped/69c86fc56c6f3cc53c85715c/69f65e41bcbd6da88681a999.jpg',
  width: 2096,
  height: 2939,
  alt: 'An octavo page in German blackletter. The running head reads Chymische Hochzeit, page 128. Four short Latin notes in italic stand in the left margin.',
  /** Crop boxes in pixels of `image`, checked by eye. */
  crops: {
    head: { x: 1010, y: 225, w: 780, h: 80 },
    umlaut: { x: 690, y: 398, w: 1290, h: 82 },
    longS: { x: 700, y: 780, w: 1280, h: 76 },
    margin: { x: 430, y: 1190, w: 270, h: 130 },
  },
} as const;

/**
 * Chart 1. The #7701 draw of 30 October 2026: 170 German books with no transcription, one interior page each; faces
 * labelled by eye (141 Fraktur, 12 Antiqua, 17 other). Every route read the same 18 Fraktur and 12 Antiqua pages.
 * Opus judged blind against the page image. For the Gemini read, n is the pages it wrote (blocks cut short are not
 * written); for the others, the pages drawn.
 */
export const DRAW_7701 = {
  date: '2026-10-30',
  issue: 7701,
  frame: { books: 170, fraktur: 141, antiqua: 12, other: 17 },
  engines: [
    { engine: 'Gemini 3.8 Flash (in use)', fraktur: [13, 15], antiqua: [8, 9], strong: true },
    { engine: 'PERO-OCR', fraktur: [3, 18], antiqua: [8, 11] },
    { engine: 'LightOnOCR-3 1B', fraktur: [2, 18], antiqua: [11, 12] },
    { engine: 'Kraken Fraktur model', fraktur: [0, 18], antiqua: null },
  ],
  /** Pages with words the page does not print, Fraktur only. */
  wrongTextFraktur: { gemini: [0, 15], lighton: 10, pero: 7, kraken: [17, 18] },
} as const;

/**
 * Chart 2a. Median character error on 29 German pages with a published typed text (Wikisource and similar), 21 of them
 * Fraktur by eye, one page per book; the same page images for every engine (#5660, 3 and 4 October 2026).
 * Kraken's generic model scored 26.0% on the same pages and is left off the scale.
 */
export const CER_5660 = {
  dates: '3–4 October 2026',
  issue: 5660,
  pages: 29,
  fraktur: 21,
  rows: [
    { engine: 'Gemini 3.1 Flash-Lite', cer: 0.5, strong: true },
    { engine: 'dots.ocr', cer: 1.3 },
    { engine: 'MinerU 2.5 Pro', cer: 2.5 },
    { engine: 'olmOCR 2', cer: 2.6 },
    { engine: 'Nanonets OCR2', cer: 2.9 },
    { engine: 'GLM-OCR', cer: 4.2 },
    { engine: 'PaddleOCR-VL 1.6', cer: 5.5 },
  ],
  krakenGeneric: 26.0,
} as const;

/**
 * Chart 2b. Average character error on 40 proofread German Wikisource pages of 1500–1850 that we do not hold, mostly
 * Fraktur (face not recorded per page), before and after the correction pass (#7818, 31 October 2026).
 * PERO's median was 1.9%; its average is pulled up by a few pages it failed.
 */
export const CER_7818 = {
  date: '2026-10-31',
  issue: 7818,
  pages: 40,
  rows: [
    { engine: 'Gemini 3.1 Flash-Lite', cer: 1.5, accepted: 23 },
    { engine: 'Flash-Lite, then the correction pass', cer: 1.1, accepted: 31, strong: true },
    { engine: 'PERO-OCR', cer: 8.8, accepted: 6 },
    { engine: 'PERO-OCR, then the correction pass', cer: 1.4, accepted: 33 },
  ],
  peroMedian: 1.9,
  liteDiff: { points: -0.4, lo: -0.6, hi: -0.2 },
} as const;

/**
 * Chart 3. The correction pass on pages we serve (#7818, 31 October 2026): one page per book from 60 German books the
 * correction lane had processed by 30 October (frame: 18,065 pages in 90 books), seeded draw, draft and served text
 * judged blind by Opus against the page image. Face is not recorded on books, so Fraktur and Antiqua are not split.
 */
export const PASS_7818 = {
  date: '2026-10-31',
  issue: 7818,
  frame: { pages: 18065, books: 90 },
  pages: 60,
  accepted: { draft: 37, served: 45, draftCi: [49, 73], servedCi: [63, 84] },
  effect: { points: 13.3, lo: 5.0, hi: 21.7, gained: 8, lost: 0 },
  wrongText: { draft: 16, served: 8 },
} as const;

/** What is not measured yet. DTA: German books we hold whose same edition the Deutsches Textarchiv has typed (#6012). */
export const DTA_6012 = {
  date: '2026-10-06',
  issue: 6012,
  books: 83,
  pages: 16863,
} as const;
