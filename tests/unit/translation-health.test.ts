/**
 * Semantic health checks at the translation door (issue #3756).
 *
 * assessTranslationHealth was extracted from retranslate-pages.mjs; these
 * fixtures pin the thresholds EXACTLY as ported (COLLAPSE_ABS_CAP 800, the
 * 0.3 collapse ratio behind a 400-char OCR floor, the 3× runaway ratio, the
 * 20k raw cap) so a drift in the shared copy fails loudly. The CJK fixture is
 * the #2532 lesson: length-ratio runaway flags were ~97% false positives on
 * CJK (which legitimately expands ~3× in chars) — normal expansion must NOT
 * be flagged.
 */
import { describe, it, expect } from 'vitest';
import {
  assessTranslationHealth,
  bodyLen,
  isCollapsed,
  isExcess,
  COLLAPSE_ABS_CAP,
  BLOCK_TAGS,
  writePageTranslation,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

const latinOcr = 'x'.repeat(2000); // a substantial page (body 2000)

describe('threshold constants (ported exactly from retranslate-pages)', () => {
  it('COLLAPSE_ABS_CAP is 800', () => {
    expect(COLLAPSE_ABS_CAP).toBe(800);
  });
  it('BLOCK_TAGS carries the editorial-wrapper list', () => {
    expect(BLOCK_TAGS).toEqual(['meta','image-desc','vocab','summary','keywords','warning','note',
      'scan-quality','language','page-type','page-num','header','sig','insert','columns','script']);
  });
});

describe('bodyLen', () => {
  it('strips editorial block wrappers before measuring', () => {
    const tr = `<summary>${'s'.repeat(600)}</summary> ${'x'.repeat(100)}`;
    expect(bodyLen(tr)).toBe(100);
  });
  it('handles null/empty', () => {
    expect(bodyLen(null)).toBe(0);
    expect(bodyLen('')).toBe(0);
  });
});

describe('collapsed page', () => {
  it('a wrapper-only sliver against real OCR is collapsed', () => {
    const tr = `<summary>${'s'.repeat(600)}</summary> ${'x'.repeat(100)}`;
    expect(isCollapsed(latinOcr, tr)).toBe(true);
    expect(assessTranslationHealth(latinOcr, tr)).toEqual({ healthy: false, reason: 'collapsed' });
  });

  it('"continued from previous page" stub under 60 chars is collapsed', () => {
    const tr = 'Continued from previous page.';
    expect(assessTranslationHealth('x'.repeat(500), tr)).toEqual({ healthy: false, reason: 'collapsed' });
  });

  it('dense page: low ratio but body >= 800 is NOT a collapse (absolute cap)', () => {
    // Ratio-only flagged ~20% false positives from oversized OCR denominators.
    const tr = 'x'.repeat(800);
    expect(assessTranslationHealth('x'.repeat(10000), tr).healthy).toBe(true);
    // one char below the cap with the same low ratio IS a collapse
    expect(assessTranslationHealth('x'.repeat(10000), 'x'.repeat(799)))
      .toEqual({ healthy: false, reason: 'collapsed' });
  });

  it('short OCR (< 400 body) never counts as collapsed', () => {
    expect(assessTranslationHealth('x'.repeat(399), 'x'.repeat(20)).healthy).toBe(true);
  });
});

describe('runaway page', () => {
  it('translation body > 3x OCR body (OCR >= 300) is a runaway', () => {
    expect(isExcess('x'.repeat(500), 'x'.repeat(2000))).toBe(true);
    expect(assessTranslationHealth('x'.repeat(500), 'x'.repeat(2000)))
      .toEqual({ healthy: false, reason: 'runaway' });
  });

  it('the 3x ratio is strict: exactly 3x is NOT a runaway', () => {
    expect(assessTranslationHealth('x'.repeat(300), 'x'.repeat(900)).healthy).toBe(true);
    expect(assessTranslationHealth('x'.repeat(300), 'x'.repeat(901)).healthy).toBe(false);
  });

  it('raw length > 20000 is always a runaway, regardless of OCR', () => {
    expect(assessTranslationHealth('', 'x'.repeat(20001)))
      .toEqual({ healthy: false, reason: 'runaway' });
  });

  it('low-OCR pages (headers, image-only) are exempt from the ratio', () => {
    expect(assessTranslationHealth('x'.repeat(299), 'x'.repeat(5000)).healthy).toBe(true);
  });
});

describe('healthy page', () => {
  it('an ordinary translation of an ordinary page is healthy', () => {
    expect(assessTranslationHealth(latinOcr, 'x'.repeat(1800)))
      .toEqual({ healthy: true, reason: null });
  });
});

describe('CJK expansion (#2532: NOT a runaway)', () => {
  it('a ~2.8x char expansion of a CJK page is healthy', () => {
    const cjkOcr = '道'.repeat(1000); // body 1000
    const english = 'x'.repeat(2800); // ~2.8x — normal CJK-to-English expansion
    expect(assessTranslationHealth(cjkOcr, english)).toEqual({ healthy: true, reason: null });
  });
});

// ── refuseUnhealthy mode of writePageTranslation ───────────────────────────
function makeDbStub() {
  const calls: { updates: unknown[]; revisions: unknown[] } = { updates: [], revisions: [] };
  const pageDoc = { id: 'p1', book_id: 'b1', translation: { data: 'old ai', source: 'ai' } };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => pageDoc,
        find: () => ({ toArray: async () => [pageDoc] }),
        updateOne: async (...args: unknown[]) => { if (name === 'pages') calls.updates.push(args); return { modifiedCount: 1 }; },
        insertMany: async (docs: unknown[]) => { if (name === 'page_revisions') calls.revisions.push(...docs); return {}; },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return { db, calls };
}

const baseArgs = {
  page: { id: 'p1', book_id: 'b1', ocr: { data: latinOcr } },
  book: { language: 'latin' },
  promptRef: { id: 'x', name: 'Standard Translation', version: 12 },
};

describe('writePageTranslation refuseUnhealthy', () => {
  it('refuses a collapsed result: no write, no revision, reason surfaced', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'tiny.', refuseUnhealthy: true });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'collapsed' });
    expect(calls.updates.length).toBe(0);
    expect(calls.revisions.length).toBe(0);
  });

  it('refuses a runaway result', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'x'.repeat(20001), refuseUnhealthy: true });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'runaway' });
    expect(calls.updates.length).toBe(0);
  });

  it('writes a healthy result normally', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'x'.repeat(1800), refuseUnhealthy: true });
    expect(r.written).toBe(true);
    expect(calls.updates.length).toBe(1);
  });

  it('is OPT-IN: without the flag an unhealthy result still writes (worker behavior unchanged)', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'tiny.' });
    expect(r.written).toBe(true);
    expect(r.unhealthy).toBeUndefined();
    expect(calls.updates.length).toBe(1);
  });
});
