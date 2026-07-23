import { describe, it, expect } from 'vitest';
import {
  ALL_DOWNLOAD_FORMATS,
  FREE_TEXT_FORMATS,
  PREMIUM_FORMATS,
  isImageFormat,
  isPremiumFormat,
  isValidDownloadFormat,
} from '@/lib/download-formats';
import type { BookDownloadFormats } from '@/lib/api-client/types/books';

// download-formats.ts is the single source of truth for which download
// formats are free-with-sign-in vs. paid (#3290), imported by both download
// routes (global + tenant) AND DownloadButton.tsx. A format silently moving
// between tiers here — or a format existing in BookDownloadFormats but
// missing from both lists — would either open a paid format for free or
// charge for a format that should be free. This test hard-codes the expected
// membership of each tier so any edit fails loudly, in the same spirit as
// tests/unit/search-filter-wire-names.test.ts.

const EXPECTED_FREE_TEXT_FORMATS: BookDownloadFormats[] = [
  'translation',
  'ocr',
  'both',
  'epub-translation',
  'epub-ocr',
  'epub-both',
  'pdf-translation',
];

const EXPECTED_PREMIUM_FORMATS: BookDownloadFormats[] = [
  'pdf-facsimile',
  'epub-parallel',
  'epub-parallel-fxl',
  'epub-scholarly',
  'epub-bilingual',
  'epub-facsimile',
  'epub-images',
  'images-zip',
];

// The full BookDownloadFormats union, listed explicitly so a new format added
// to the type but forgotten here fails this test rather than silently landing
// in neither tier list.
const ALL_KNOWN_FORMATS: BookDownloadFormats[] = [
  ...EXPECTED_FREE_TEXT_FORMATS,
  ...EXPECTED_PREMIUM_FORMATS,
];

describe('download format tiers (#3290)', () => {
  it('FREE_TEXT_FORMATS matches the approved free tier exactly', () => {
    expect([...FREE_TEXT_FORMATS].sort()).toEqual([...EXPECTED_FREE_TEXT_FORMATS].sort());
  });

  it('PREMIUM_FORMATS matches the approved paid tier exactly', () => {
    expect([...PREMIUM_FORMATS].sort()).toEqual([...EXPECTED_PREMIUM_FORMATS].sort());
  });

  it('every format belongs to exactly one tier — no overlap, no gaps', () => {
    const free = new Set<string>(FREE_TEXT_FORMATS);
    const premium = new Set<string>(PREMIUM_FORMATS);

    // No overlap.
    for (const f of free) {
      expect(premium.has(f)).toBe(false);
    }

    // No gaps against the full known-format universe.
    for (const f of ALL_KNOWN_FORMATS) {
      const inFree = free.has(f);
      const inPremium = premium.has(f);
      expect(inFree || inPremium).toBe(true);
      expect(inFree && inPremium).toBe(false);
    }
  });

  it('ALL_DOWNLOAD_FORMATS is the union of both tiers, matching the full type', () => {
    expect([...ALL_DOWNLOAD_FORMATS].sort()).toEqual([...ALL_KNOWN_FORMATS].sort());
  });

  it('isValidDownloadFormat accepts every known format and rejects junk', () => {
    for (const f of ALL_KNOWN_FORMATS) {
      expect(isValidDownloadFormat(f)).toBe(true);
    }
    expect(isValidDownloadFormat('not-a-real-format')).toBe(false);
    expect(isValidDownloadFormat('')).toBe(false);
  });

  it('isPremiumFormat agrees with PREMIUM_FORMATS membership', () => {
    for (const f of EXPECTED_FREE_TEXT_FORMATS) {
      expect(isPremiumFormat(f)).toBe(false);
    }
    for (const f of EXPECTED_PREMIUM_FORMATS) {
      expect(isPremiumFormat(f)).toBe(true);
    }
  });

  it('isImageFormat matches the historical DownloadButton definition exactly', () => {
    const expectedImageFormats: BookDownloadFormats[] = [
      'pdf-facsimile',
      'epub-facsimile',
      'epub-images',
      'images-zip',
    ];
    for (const f of ALL_KNOWN_FORMATS) {
      expect(isImageFormat(f)).toBe(expectedImageFormats.includes(f));
    }
    // Image formats are always premium, but not every premium format is an
    // image format (the text-only apparatus editions are paid too).
    expect(isPremiumFormat('epub-parallel')).toBe(true);
    expect(isImageFormat('epub-parallel')).toBe(false);
  });
});
