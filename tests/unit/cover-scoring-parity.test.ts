/**
 * PARITY — src/lib/cover-scoring.ts (ensure-cover + book page render fallback)
 * vs scripts/lib/cover-scoring.mjs (pipeline Phase 3 / 8.9, batch scripts).
 *
 * Runs BOTH implementations over the same fixtures and fails on any
 * divergence, so "keep in lock-step" is enforced rather than hoped. This is a
 * behavioral guard, not a source-shape one: it executes both scorers.
 */
import { describe, it, expect } from 'vitest';
import {
  scorePageForCover as scoreTs,
  parsePageTypeFromOcr as parseTs,
  HAND_IN_FRAME_RE as handTs,
} from '@/lib/cover-scoring';
import {
  scorePageForCover as scoreMjs,
  parsePageTypeFromOcr as parseMjs,
  HAND_IN_FRAME_RE as handMjs,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/cover-scoring.mjs';

type Fixture = { name: string; page: Record<string, unknown>; title?: string };

const FIXTURES: Fixture[] = [
  {
    name: 'decorated title page with imprint and title match',
    title: 'Atalanta Fugiens Emblemata Nova',
    page: {
      page_number: 3,
      page_type: 'title-page',
      ocr: { data: '# ATALANTA FUGIENS\n## Emblemata Nova\nTypis Hieronymi Galleri, decorative woodcut border, atalanta fugiens emblemata' },
    },
  },
  {
    name: 'untyped page that looks like a title page (heading density)',
    page: { page_number: 2, ocr: { data: '# TITLE\n# AUTHOR\n# CITY\nprinted by John Day' } },
  },
  {
    name: 'blank page recognized from OCR content',
    page: { page_number: 1, ocr: { data: 'This page is blank, aged paper with no printed content.' } },
  },
  {
    name: 'scanner hand in frame',
    page: { page_number: 1, ocr: { data: 'A gloved hand is visible at the bottom edge, holding the volume open.' } },
  },
  {
    name: 'digitizer insert',
    page: { page_number: 1, ocr: { data: 'Digitized by the Internet Archive in 2010 with funding from Microsoft Corporation' } },
  },
  {
    name: 'ex-libris bookplate',
    page: { page_number: 2, ocr: { data: 'Ex libris plate of the University Library, with an accession stamp.' } },
  },
  {
    name: 'frontispiece with engraving',
    page: { page_number: 1, page_type: 'frontispiece', ocr: { data: 'An allegorical engraved portrait of the author within an oval frame.' } },
  },
  {
    name: 'binding photo mislabeled as frontispiece',
    page: { page_number: 1, page_type: 'frontispiece', ocr: { data: 'Photograph of the leather cover and binding of the volume.' } },
  },
  { name: 'hidden page', page: { page_number: 1, page_type: 'title-page', hidden: true } },
  { name: 'no OCR, no type, no page number', page: {} },
  {
    name: 'page type parsed from OCR tag',
    page: { page_number: 4, ocr: { data: '<page-type>frontispiece</page-type>\nAn emblem engraving.' } },
  },
  {
    name: 'ocr_head projection instead of full ocr.data',
    page: { page_number: 3, page_type: 'title-page', ocr_head: 'DE PROVIDENTIA ET FATO, typis excudebat, ornamental border' },
  },
  { name: 'deep interior text page', page: { page_number: 40, page_type: 'text', ocr: { data: 'Caput primum. De rerum natura.' } } },
];

describe('cover scorer TS/mjs parity', () => {
  for (const f of FIXTURES) {
    it(`agrees on: ${f.name}`, () => {
      const ts = scoreTs(f.page as never, { bookTitle: f.title });
      const mjs = scoreMjs(f.page, { bookTitle: f.title });
      expect(ts).toEqual(mjs);
    });
  }

  it('agrees on parsePageTypeFromOcr', () => {
    for (const text of ['<page-type>title-page</page-type>', 'no tag here', '', null]) {
      expect(parseTs(text)).toEqual(parseMjs(text));
    }
  });

  it('exports an identical hand-in-frame pattern', () => {
    expect(handTs.source).toBe(handMjs.source);
    expect(handTs.flags).toBe(handMjs.flags);
  });
});

describe('scoring behavior (pins the failure classes ensure-cover shipped with)', () => {
  it('rejects the scanner-hand page outright', () => {
    expect(scoreTs({ page_number: 1, ocr_head: 'A gloved hand is visible at the edge' })).toEqual({ score: -75, reason: 'hand in frame' });
  });

  it('prefers a scored title page over an earlier plain page', () => {
    const titlePage = scoreTs({ page_number: 3, page_type: 'title-page', ocr_head: 'TITLE typis apud decorative border' });
    const firstLeaf = scoreTs({ page_number: 1, ocr_head: 'Some faint text.' });
    expect(titlePage.score).toBeGreaterThan(30);
    expect(titlePage.score).toBeGreaterThan(firstLeaf.score);
  });

  it('does not flag hand-colored / handwriting language as a hand in frame', () => {
    for (const text of [
      'A hand-colored woodcut of the zodiac',
      'Handwriting in the lower margin',
      'On the other hand, the author argues',
      'the hand of God depicted in the engraving',
    ]) {
      expect(handTs.test(text)).toBe(false);
    }
  });

  it('flags real hand-in-frame descriptions', () => {
    for (const text of [
      "The scanner's hand is visible at the corner",
      'A gloved hand holding the page flat',
      'fingers are visible at the bottom of the frame',
      'a thumb is visible on the left edge',
    ]) {
      expect(handTs.test(text)).toBe(true);
    }
  });
});
