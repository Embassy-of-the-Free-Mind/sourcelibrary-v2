/**
 * Reader warnings from stored checks (#6199, src/lib/book-warnings.ts).
 *
 * What these pin: a warning exists only where a check found something serious on text that is still on the page; a
 * later clean read clears it; a detector flag never outranks a review; counts stay inside one check; and a row that
 * only restates another row never produces a second warning. Each of these, broken, either hides a real error from a
 * reader or keeps warning about an error that has been fixed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BookCheck, PageTextStamp } from '@/lib/book-checks';
import { deriveWarnings, kindsOfFinding, ownChecks, pageAnchor, checkAnchor, WARNING_KINDS } from '@/lib/book-warnings';
import { CHECK_METHODS } from '@/lib/check-methods';
import { READER_UI_STRINGS } from '@/lib/reader-strings';

const row = (over: Partial<BookCheck> = {}): BookCheck => ({
  book_id: 'b1', checked_at: new Date('2026-10-06T10:00:00Z'), method_id: 'shelf-overview', method_version: '1', run_id: 'r1',
  pages_read: [7, 8, 9, 10], reader: { kind: 'model', model: 'opus', image_opened: true }, verdict: 'fix',
  evidence_path: 'x.json',
  text_provenance: [7, 8, 9, 10].map((n) => ({ page_number: n, ocr_model: 'm', translation_model: 'm' })),
  page_findings: [
    { page_number: 7, errors: [{ stage: 'ocr', class: 'O1', problem: 'invented remedies' }] },
    { page_number: 9, wrong_page: true, errors: [{ stage: 'translation', class: 'T8' }, { stage: 'translation', class: 'T99' }] },
  ],
  ...over,
});
const untouched = (nums: number[]) => new Map<number, PageTextStamp>(nums.map((n) => [n, { page_number: n, ocr: { updated_at: '2026-01-01T00:00:00Z' }, translation: { updated_at: '2026-01-01T00:00:00Z' } }]));

describe('kindsOfFinding', () => {
  it('maps classes to reader wording, most consequential first, and falls back to the stage', () => {
    expect(kindsOfFinding(row().page_findings![1])).toEqual(['wrong_page', 'meaning_reversed', 'serious_english']);
    expect(kindsOfFinding({ page_number: 1, errors: [{ stage: 'other', class: 'other:canonical-text-substitution (cf. O3)' }] })).toEqual(['serious_other']);
  });
});

describe('deriveWarnings', () => {
  it('warns on the pages with a serious finding and counts them within the check', () => {
    const w = deriveWarnings([row()], untouched([7, 8, 9, 10]));
    expect(Object.keys(w.pages).map(Number)).toEqual([7, 9]);
    expect(w.pages[7]).toMatchObject({ level: 'review', kinds: ['invented_transcription'], reader: 'model', imageOpened: true, anchor: pageAnchor(row(), 7) });
    expect(w.book).toMatchObject({ pagesRead: 4, pagesSerious: 2, anchor: checkAnchor(row()) });
  });

  it('drops a page whose text was rewritten after the check, from the warning and from both counts', () => {
    const stamps = untouched([7, 8, 9, 10]);
    stamps.set(7, { page_number: 7, translation: { updated_at: '2026-10-07T00:00:00Z' } });
    const w = deriveWarnings([row()], stamps);
    expect(w.pages[7]).toBeUndefined();
    expect(w.book).toMatchObject({ pagesRead: 3, pagesSerious: 1 });
  });

  it('shows nothing once every finding is stale', () => {
    const stamps = untouched([8, 10]);
    stamps.set(7, { page_number: 7, ocr: { updated_at: '2026-10-07T00:00:00Z' } });
    // page 9 has no record any more
    expect(deriveWarnings([row()], stamps)).toEqual({ book: null, pages: {} });
  });

  it('lets a later clean read of the same page clear an earlier finding', () => {
    const later = row({ run_id: 'r2', method_id: 'fortnightly-spot-check', checked_at: new Date('2026-10-07T10:00:00Z'), pages_read: [7], verdict: 'show',
      text_provenance: [{ page_number: 7, ocr_model: 'm', translation_model: 'm' }], page_findings: [] });
    const w = deriveWarnings([row(), later], untouched([7, 8, 9, 10]));
    expect(w.pages[7]).toBeUndefined();
    expect(w.pages[9]).toBeDefined();
    expect(w.book).toMatchObject({ runId: 'r1', pagesSerious: 1 });
  });

  it('never counts or warns about a soft-hidden page (page_number ≤ 0)', () => {
    const r = row({ pages_read: [-3, 8], text_provenance: [-3, 8].map((n) => ({ page_number: n, ocr_model: 'm', translation_model: 'm' })),
      page_findings: [{ page_number: -3, errors: [{ stage: 'ocr', class: 'O1' }] }] });
    expect(deriveWarnings([r], untouched([-3, 8]))).toEqual({ book: null, pages: {} });
  });

  it('gives a book warning without a count when a fix verdict kept no per-page record', () => {
    const r = row({ method_id: 'curation-check', page_findings: undefined, pages_read: [40, 41], text_provenance: [40, 41].map((n) => ({ page_number: n, ocr_model: 'm', translation_model: 'm' })) });
    const w = deriveWarnings([r], untouched([40, 41]));
    expect(w.pages).toEqual({});
    expect(w.book).toMatchObject({ pagesRead: 2, pagesSerious: null });
  });

  it('gives no book warning for a caveat or show verdict without serious pages', () => {
    expect(deriveWarnings([row({ verdict: 'caveat', page_findings: [] })], untouched([7, 8, 9, 10])).book).toBeNull();
    expect(deriveWarnings([row({ verdict: 'caveat', page_findings: undefined })], untouched([7, 8, 9, 10])).book).toBeNull();
  });

  it('shows a detector flag only where no review has read the page', () => {
    const det = row({ method_id: 'reasoning-leak', run_id: 'd1', reader: { kind: 'detector', role: 'translation-reasoning-leak', image_opened: false },
      pages_read: [8, 20], text_provenance: [8, 20].map((n) => ({ page_number: n, ocr_model: 'm', translation_model: 'm' })), page_findings: undefined });
    const w = deriveWarnings([row(), det], untouched([7, 8, 9, 10, 20]));
    expect(w.pages[8]).toBeUndefined(); // a review read page 8 and found it clean
    expect(w.pages[20]).toMatchObject({ level: 'detector', kinds: [], issue: CHECK_METHODS['reasoning-leak'].issue });
    expect(w.book?.runId).toBe('r1'); // a detector never makes the book-level line
  });

  it('ignores a row that only restates another check of the book', () => {
    const hide = row({ method_id: 'hide-broken-text', run_id: 'broken_text_6056', checked_at: new Date('2026-10-07T00:00:00Z'), frame: { source_run_id: 'r1' } });
    expect(ownChecks([row(), hide]).map((r) => r.run_id)).toEqual(['r1']);
    expect(deriveWarnings([row(), hide], untouched([7, 8, 9, 10])).book?.runId).toBe('r1');
    // …but stands on its own when the check it cites has no row
    expect(deriveWarnings([hide], untouched([7, 8, 9, 10])).book?.runId).toBe('broken_text_6056');
  });
});

describe('copy and registry stay in step', () => {
  it('has wording for every warning kind in every reader language', () => {
    for (const lang of Object.keys(READER_UI_STRINGS) as (keyof typeof READER_UI_STRINGS)[]) {
      for (const k of WARNING_KINDS) expect(READER_UI_STRINGS[lang].info.qualityKinds[k], `${lang}.${k}`).toBeTruthy();
    }
  });

  it('names every registered method, and gives each detector the issue its registry header cites', () => {
    const dir = join(process.cwd(), 'scripts/eval/methods');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md')) {
      const head = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/)![1];
      const id = head.match(/^id:\s*(.+)$/m)![1].trim();
      const info = CHECK_METHODS[id];
      expect(info, `CHECK_METHODS has no entry for ${id}`).toBeDefined();
      if (/^reader:\s*detector/m.test(head)) {
        const issues = head.match(/^issue:\s*\[(.*)\]/m)![1].split(',').map((x) => Number(x.trim()));
        expect(issues, `${id}: detector issue ${info.issue} is not in the registry header`).toContain(info.issue);
      }
    }
  });
});
