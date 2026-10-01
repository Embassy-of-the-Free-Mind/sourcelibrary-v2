/**
 * PARITY — src/lib/publication.ts (routes) vs scripts/lib/publication.mjs
 * (workers, maintenance). Runs both over the same fixtures and fails on any
 * divergence, so the twins cannot drift apart silently (#5340).
 */
import { describe, it, expect } from 'vitest';
import * as ts from '@/lib/publication';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as mjs from '../../scripts/lib/publication.mjs';

const REASON_STRINGS: unknown[] = [
  undefined, null, '',
  'launch_curation', 'unprocessed', 'unarchived', 'artwork_import', 'awaiting_qa_eval',
  'duplicate', 'duplicate of some-book-slug', 'same_edition_duplicate', 'duplicate_lower_res',
  'superseded by Claremont NHA 00000000-0000-0000-0000-000000000000',
  'low_resolution', 'too-small-under-200px', 'svg-or-pdf-not-displayable', 'no_pages',
  'fabricated_ocr_4851', 'scan_mismatch: catalogued as X, scanned volume is Y',
  'Leiden IIIF returns 403 for this item', 'IA access-restricted lending item (x)',
  'date 2014 outside collection period', 'tourist photo / broken metadata',
  'kloss_manuscripts_removed_2026-07-08', 'takedown:rights',
  'copyright-review: a modern edition', 'Under copyright (1979 modern edition)',
  'rights_unclear_1988_reprint_qa_2026-09-01', 'awaiting_qa_and_rights_review',
  'single-page IA stub; removal requested by owner (feedback)',
  'awaiting_permission_some_partner_2026-09',
  'an unreviewed free-text reason nobody mapped',
];

const BOOKS: Record<string, unknown>[] = [
  { visible: true },
  { visible: true, hidden_reason: 'launch_curation' },
  { visible: false, hidden: true, hidden_reason: 'duplicate of x' },
  { visible: false, hidden: true },
  { visible: false, hidden: true, hidden_reason: 'kloss_manuscripts_removed_2026-07-08' },
  { hidden: true, hidden_reason: 'launch_curation' },
  { hidden: true, hidden_reason: 'copyright-review: x' },
  {},
  { visible: null },
  { visible: false, publication: { state: 'public', reason: null, note: null } },
];

const OPTS: Record<string, unknown>[] = [
  { state: 'public', by: 'x' },
  { state: 'hidden', by: 'x' },
  { state: 'hidden', reason: 'duplicate', by: 'x' },
  { state: 'hidden', reason: 'not-an-enum', by: 'x' },
  { state: 'takedown', by: 'x' },
  { state: 'takedown', by: 'x', issue: 5303 },
  { state: 'public', by: 'x', override: 'rights-cleared', issue: 5303 },
  { state: 'public', by: '' },
  { state: 'bogus', by: 'x' },
];

function outcome(fn: () => unknown): unknown {
  try { return { ok: fn() ?? true }; } catch (e) { return { threw: (e as Error).message }; }
}

describe('publication twins agree', () => {
  it('enums and the reviewed reason table', () => {
    expect([...ts.PUBLICATION_STATES]).toEqual([...mjs.PUBLICATION_STATES]);
    expect([...ts.PUBLICATION_REASONS]).toEqual([...mjs.PUBLICATION_REASONS]);
    expect([...ts.PUBLICATION_VIEWS]).toEqual([...mjs.PUBLICATION_VIEWS]);
    expect(ts.PUBLICATION_BACKFILLED).toBe(mjs.PUBLICATION_BACKFILLED);
    const shape = (m: { match: string | RegExp; state?: string; reason: string }[]) =>
      m.map((e) => [String(e.match), e.state ?? null, e.reason]);
    expect(shape([...ts.LEGACY_REASON_MAP])).toEqual(shape(mjs.LEGACY_REASON_MAP));
  });

  it('mapLegacyReason', () => {
    for (const s of REASON_STRINGS) expect(ts.mapLegacyReason(s), String(s)).toEqual(mjs.mapLegacyReason(s));
  });

  it('legacyPublication', () => {
    for (const b of BOOKS) expect(ts.legacyPublication(b), JSON.stringify(b)).toEqual(mjs.legacyPublication(b));
  });

  it('derivedLegacyFields', () => {
    for (const s of ts.PUBLICATION_STATES) {
      expect(ts.derivedLegacyFields(s, 'duplicate')).toEqual(mjs.derivedLegacyFields(s, 'duplicate'));
    }
  });

  it('checkTransition', () => {
    for (const from of ts.PUBLICATION_STATES) {
      for (const o of OPTS) {
        expect(outcome(() => ts.checkTransition(from, o as never)), `${from} ${JSON.stringify(o)}`)
          .toEqual(outcome(() => mjs.checkTransition(from, o)));
      }
    }
  });

  it('publicationFilter', () => {
    for (const v of ts.PUBLICATION_VIEWS) {
      expect(JSON.stringify(ts.publicationFilter(v), (_k, x) => (x instanceof RegExp ? String(x) : x)))
        .toBe(JSON.stringify(mjs.publicationFilter(v), (_k: string, x: unknown) => (x instanceof RegExp ? String(x) : x)));
    }
  });

  it('initialPublication', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    for (const o of [{ by: 'x', now }, { state: 'hidden', reason: 'quality', by: 'x', now }, { state: 'public', by: 'x', now }]) {
      expect(ts.initialPublication(o as never)).toEqual(mjs.initialPublication(o));
    }
  });
});
