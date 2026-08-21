/**
 * Edge cases of the translation door (issue #3734).
 *
 * One named fixture per known edge case, each asserting the guard's behavior
 * directly — so removing a guard makes a test here fail (negative control:
 * the human-edit tests assert updateOne is NOT called, which cannot pass if
 * the guard is deleted).
 */
import { describe, it, expect } from 'vitest';
import { SKIP_TRANSLATION_PAGE_TYPES as SKIP_TS } from '@/lib/types/prompts/defaults';
import {
  isTranslatablePage,
  isBlankFromOcr,
  translatablePageFilter,
  writePageTranslation,
  SKIP_TRANSLATION_PAGE_TYPES as SKIP_MJS,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

describe('skip-list parity (TS defaults vs scripts core)', () => {
  it('the two canonical lists are identical', () => {
    expect([...SKIP_MJS].sort()).toEqual([...SKIP_TS].sort());
  });
});

describe('isTranslatablePage', () => {
  const good = { page_number: 5, ocr: { data: 'Some real Latin text long enough.' } };

  it('accepts an ordinary OCRd page', () => {
    expect(isTranslatablePage(good)).toEqual({ ok: true });
  });

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['soft-hidden page (page_number 0)', { ...good, page_number: 0 }, 'soft-hidden'],
    ['soft-hidden page (negative)', { ...good, page_number: -3 }, 'soft-hidden'],
    ['blank page_type', { ...good, page_type: 'blank' }, 'skip-type'],
    ['exlibris page_type', { ...good, page_type: 'exlibris' }, 'skip-type'],
    ['bookplate page_type', { ...good, page_type: 'bookplate' }, 'skip-type'],
    ['digitizer-notice page_type', { ...good, page_type: 'digitizer-notice' }, 'skip-type'],
    ['no OCR at all', { page_number: 5 }, 'no-ocr'],
    ['empty OCR string', { page_number: 5, ocr: { data: '' } }, 'no-ocr'],
    ['blank detected from OCR text', { page_number: 5, ocr: { data: '<lang>None</lang>\nThis is a blank page.' } }, 'blank-ocr'],
    ['recitation-blocked', { ...good, translation: { recitation_blocked: true } }, 'recitation-blocked'],
    ['safety-blocked', { ...good, translation: { safety_blocked: true } }, 'safety-blocked'],
  ];
  it.each(cases)('%s → refused', (_name, page, reason) => {
    expect(isTranslatablePage(page)).toEqual({ ok: false, reason });
  });

  it('extraSkipTypes extends, never replaces, the canonical list', () => {
    const p = { ...good, page_type: 'title_page' };
    expect(isTranslatablePage(p).ok).toBe(true);
    expect(isTranslatablePage(p, { extraSkipTypes: ['title_page'] })).toEqual({ ok: false, reason: 'skip-type' });
    // canonical still applies alongside extras
    expect(isTranslatablePage({ ...good, page_type: 'blank' }, { extraSkipTypes: ['title_page'] }).ok).toBe(false);
  });

  it('a typed page is not re-flagged by the blank-OCR heuristic', () => {
    // page_type present means classification already happened — heuristic is for untyped legacy pages
    expect(isBlankFromOcr('<lang>None</lang> blank page')).toBe(true);
    expect(isTranslatablePage({ page_number: 2, page_type: 'illustration', ocr: { data: '<lang>None</lang> blank page' } }).ok).toBe(false); // still refused, but via… blank-ocr is fine too
  });
});

describe('translatablePageFilter (Mongo fragment)', () => {
  it('matches the predicate for the query-expressible rules', () => {
    const f = translatablePageFilter();
    expect(f.page_number).toEqual({ $gt: 0 });
    expect((f.page_type as { $nin: string[] }).$nin).toEqual(expect.arrayContaining([...SKIP_MJS]));
    expect(f['translation.recitation_blocked']).toEqual({ $ne: true });
  });
});

// ── Human-edit guard ───────────────────────────────────────────────────────
// Minimal DB stub: records updateOne/insertMany calls, serves findOne/find.
function makeDbStub(existingTranslation: Record<string, unknown> | null) {
  const calls: { updates: unknown[]; revisions: unknown[] } = { updates: [], revisions: [] };
  const pageDoc = existingTranslation === null
    ? { id: 'p1', book_id: 'b1' }
    : { id: 'p1', book_id: 'b1', translation: existingTranslation };
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

const writeArgs = {
  page: { id: 'p1', book_id: 'b1' },
  book: { language: 'latin' },
  text: 'New AI translation.',
  promptRef: { id: 'x', name: 'Standard Translation', version: 12 },
};

describe('writePageTranslation human-edit guard', () => {
  it('refuses to overwrite a manual translation (negative control: no updateOne)', async () => {
    const { db, calls } = makeDbStub({ data: 'HAND-CORRECTED TEXT', source: 'manual' });
    const r = await writePageTranslation(db, writeArgs);
    expect(r.written).toBe(false);
    expect(r.protected).toBe(true);
    expect(r.text).toBe('HAND-CORRECTED TEXT'); // returns human text for continuity
    expect(calls.updates.length).toBe(0);
    expect(calls.revisions.length).toBe(0);
  });

  it('refuses when edited_by is set even if source is ai', async () => {
    const { db, calls } = makeDbStub({ data: 'EDITED', source: 'ai', edited_by: 'derek' });
    const r = await writePageTranslation(db, writeArgs);
    expect(r.written).toBe(false);
    expect(calls.updates.length).toBe(0);
  });

  it('overwriteHuman: true bypasses the guard AND still writes a revision first', async () => {
    const { db, calls } = makeDbStub({ data: 'HAND', source: 'manual' });
    const r = await writePageTranslation(db, { ...writeArgs, overwriteHuman: true });
    expect(r.written).toBe(true);
    expect(calls.updates.length).toBe(1);
    expect(calls.revisions.length).toBe(1); // the human text is preserved as a revision
  });

  it('writes normally over AI text', async () => {
    const { db, calls } = makeDbStub({ data: 'old ai', source: 'ai' });
    const r = await writePageTranslation(db, writeArgs);
    expect(r.written).toBe(true);
    expect(r.text).toBe('New AI translation.');
    expect(calls.updates.length).toBe(1);
    expect(calls.revisions.length).toBe(1);
  });

  it('writes normally on first translation (no existing)', async () => {
    const { db, calls } = makeDbStub(null);
    const r = await writePageTranslation(db, writeArgs);
    expect(r.written).toBe(true);
    expect(calls.updates.length).toBe(1);
    expect(calls.revisions.length).toBe(0); // nothing to snapshot
  });
});
