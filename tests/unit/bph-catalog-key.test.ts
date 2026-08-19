import { describe, it, expect } from 'vitest';
import { catalogKeyColumn, catalogRowKey } from '@/lib/bph-catalog-key';

// Values below are real, taken from bph_works on 2026-08-05 — not invented.
// The manuscript uuid/shelfmark pair is the row José Bouman's report points at.
const REAL_MANUSCRIPT_UUID = '5f8c42fc-f718-19a1-57d9-f5a2cc470d41'; // shelf_mark "M 341"
const REAL_NUMERIC_UBN = '8841';
const REAL_SHELFMARK_UBN = 'BPH 151'; // UBNs are not always numeric

describe('catalogKeyColumn', () => {
  it('routes a uuid to the uuid column', () => {
    expect(catalogKeyColumn(REAL_MANUSCRIPT_UUID)).toBe('uuid');
  });

  it('routes a numeric UBN to the ubn column', () => {
    expect(catalogKeyColumn(REAL_NUMERIC_UBN)).toBe('ubn');
  });

  // UBNs like "BPH 151" are why normalizeUbn exists at all; they must not be
  // mistaken for uuids just because they aren't plain digits.
  it('routes a shelf-mark-shaped UBN to the ubn column', () => {
    expect(catalogKeyColumn(REAL_SHELFMARK_UBN)).toBe('ubn');
  });

  // The safety property the whole dual-key scheme rests on. Verified against
  // production (`ubn LIKE '%-%-%-%-%'` → 0 rows), and pinned here so a future
  // identifier scheme that introduces hyphenated UBNs fails loudly instead of
  // silently 404ing every affected record.
  it('only claims uuid for a full 8-4-4-4-12 hex shape', () => {
    for (const notAUuid of [
      '1234-5678',
      'BPH-151',
      'M 341',
      'Fot 6',
      '5f8c42fc-f718-19a1-57d9',           // truncated
      '5f8c42fc-f718-19a1-57d9-f5a2cc4',   // short last group
      'zzzzzzzz-f718-19a1-57d9-f5a2cc470d41', // non-hex
    ]) {
      expect(catalogKeyColumn(notAUuid)).toBe('ubn');
    }
  });
});

describe('catalogRowKey', () => {
  it('prefers the human-meaningful UBN when a row has both', () => {
    expect(catalogRowKey({ ubn: REAL_NUMERIC_UBN, uuid: REAL_MANUSCRIPT_UUID })).toBe(REAL_NUMERIC_UBN);
  });

  it('falls back to uuid for the records Memorix gives no UBN', () => {
    expect(catalogRowKey({ ubn: null, uuid: REAL_MANUSCRIPT_UUID })).toBe(REAL_MANUSCRIPT_UUID);
  });

  // Without this, callers build `/catalog/null`, which soft-404s with a 200.
  it('returns null when a row has neither, so callers render plain text', () => {
    expect(catalogRowKey({ ubn: null, uuid: null })).toBeNull();
    expect(catalogRowKey({})).toBeNull();
    expect(catalogRowKey(null)).toBeNull();
    expect(catalogRowKey(undefined)).toBeNull();
  });
});
