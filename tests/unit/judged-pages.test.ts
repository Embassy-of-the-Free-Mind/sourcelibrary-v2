/**
 * judged-pages (#7896): route-judge verdicts onto the book a reader opens, in the judge's own words.
 *
 * What these pin: a verdict is used only when the text it judged is the page's text now; "serious" is fidelity ≤ 3,
 * never the judge's strict accept; every page read keeps its note and defects (the qualitative record), clean pages
 * included; page_notes are refused when they name a page the check did not read; and the book line can say "checked,
 * nothing serious" only when the newest review's every live page is clean.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import type { BookCheck, PageTextStamp } from '@/lib/book-checks';
import { deriveWarnings } from '@/lib/book-warnings';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { judgedTextIsLive, checkFields } from '../../scripts/maintenance/judge-verdicts-to-book-checks.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildBookCheck, readMethod, pageNoteProblems } from '../../scripts/lib/book-checks.mjs';

const sha16 = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const v = (page_number: number, fidelity: number, accept: boolean, defects: object[] = [], reader_note = `note ${page_number}`) =>
  ({ page_number, verdict: { fidelity, accept, defects, reader_note } });

describe('judgedTextIsLive', () => {
  it('matches either hash convention and refuses rewritten or empty text', () => {
    expect(judgedTextIsLive({ text_sha: sha16('abc') }, '  abc\n')).toBe(true);
    expect(judgedTextIsLive({ text_hash: sha16('abc\n') }, 'abc\n')).toBe(true);
    expect(judgedTextIsLive({ text_sha: sha16('abc') }, 'abd')).toBe(false);
    expect(judgedTextIsLive({}, 'abc')).toBe(false);
    expect(judgedTextIsLive({ text_sha: sha16('') }, '')).toBe(false);
  });
});

describe('checkFields', () => {
  const pages = [
    v(3, 5, true),
    v(1, 4, false, [{ class: 'O6', severity: 'misleads', quote: 'Defen', what: 'Oefen read as Defen' }]),
    v(2, 3, false, [{ class: 'O6', severity: 'wrong_text', quote: 'x', what: 'a different word' }, { class: 'E2', severity: 'cosmetic', what: 'a stray mark' }]),
  ];
  it('serious is fidelity ≤ 3, not the strict accept: one slip at fidelity 4 is a note, not a finding', () => {
    const f = checkFields(pages);
    expect(f.pages_read).toEqual([1, 2, 3]);
    expect(f.page_findings).toEqual([{ page_number: 2, errors: [{ stage: 'ocr', class: 'O6', problem: 'a different word' }] }]);
    expect(f.verdict).toBe('caveat');
    expect(f.classes).toEqual(['O6']);
  });
  it('keeps every page in page_notes, clean pages and minor defects included', () => {
    const f = checkFields(pages);
    expect(f.page_notes.map((n: { page_number: number }) => n.page_number)).toEqual([1, 2, 3]);
    expect(f.page_notes[0]).toEqual({ page_number: 1, note: 'note 1', fidelity: 4, accepted: false, defects: [{ severity: 'misleads', what: 'Oefen read as Defen', class: 'O6', quote: 'Defen' }] });
    expect(f.page_notes[1].defects).toHaveLength(2);
    expect(f.page_notes[2]).toEqual({ page_number: 3, note: 'note 3', fidelity: 5, accepted: true, defects: [] });
  });
  it('fix at fidelity ≤ 2; an I1 defect is a wrong page; a low score with only cosmetic defects still says why', () => {
    const f = checkFields([v(5, 1, false, [{ class: 'I1', severity: 'wrong_text', what: 'text of another leaf' }]), v(6, 3, false, [], 'Several small misreads.')]);
    expect(f.verdict).toBe('fix');
    expect(f.page_findings[0]).toEqual({ page_number: 5, wrong_page: true, errors: [] });
    expect(f.page_findings[1]).toEqual({ page_number: 6, errors: [{ stage: 'ocr', problem: 'Several small misreads.' }] });
    expect(checkFields([v(1, 5, true), v(2, 4, true)]).verdict).toBe('show');
  });
  it('writes a row recordBookCheck accepts', () => {
    const f = checkFields(pages);
    const row = buildBookCheck({
      book_id: 'b1', checked_at: '2026-11-01T00:00:00Z', method_id: 'judged-pages', method_version: readMethod('judged-pages').version,
      run_id: 'r1', reader: { kind: 'model', model: 'claude-opus-5-5', image_opened: true }, evidence_path: 'scripts/eval/results/judged-pages/r1.json',
      exposure: f.pages_read.map((n: number) => ({ page_number: n, exposure: 'served' })),
      text_provenance: f.pages_read.map((n: number) => ({ page_number: n, ocr_model: 'm', translation_model: 'm' })),
      ...f,
    });
    expect(row.page_notes).toEqual(f.page_notes);
  });
});

describe('pageNoteProblems', () => {
  it('refuses a note on a page not read, a missing severity or what, and a bad fidelity', () => {
    expect(pageNoteProblems([{ page_number: 1, defects: [] }], [1])).toEqual([]);
    expect(pageNoteProblems([{ page_number: 2, defects: [] }], [1])).toEqual(['page_notes p.2: not in pages_read']);
    expect(pageNoteProblems([{ page_number: 1, defects: [{ severity: 'bad', what: '' }] }], [1]).length).toBe(2);
    expect(pageNoteProblems([{ page_number: 1, fidelity: 9, defects: [] }], [1])).toEqual(['page_notes p.1: fidelity is 1–5']);
    expect(pageNoteProblems([{ page_number: 1 }], [1])).toEqual(['page_notes p.1: defects must be a list ([] for none)']);
  });
});

describe('the book line (deriveWarnings.checked)', () => {
  const base = (over: Partial<BookCheck> = {}): BookCheck => ({
    book_id: 'b1', checked_at: new Date('2026-11-01T10:00:00Z'), method_id: 'judged-pages', method_version: '1', run_id: 'r1',
    pages_read: [1, 2], reader: { kind: 'model', model: 'opus', image_opened: true }, verdict: 'show', evidence_path: 'x.json',
    text_provenance: [1, 2].map((n) => ({ page_number: n, ocr_model: 'm', translation_model: 'm' })), page_findings: [], ...over,
  });
  const stamps = new Map<number, PageTextStamp>([1, 2].map((n) => [n, { page_number: n, ocr: { updated_at: '2026-01-01T00:00:00Z' } }]));

  it('reports a clean newest review', () => {
    expect(deriveWarnings([base()], stamps)).toMatchObject({ book: null, checked: { pagesRead: 2, reader: 'model', imageOpened: true } });
  });
  it('never reports clean when a finding stands, or when the review kept no per-page record', () => {
    const bad = base({ page_findings: [{ page_number: 2, errors: [{ stage: 'ocr', class: 'O6' }] }], verdict: 'caveat' });
    expect(deriveWarnings([bad], stamps).checked).toBeNull();
    expect(deriveWarnings([base({ page_findings: undefined })], stamps).checked).toBeNull();
  });
  it('has a sentence in every locale', () => {
    for (const [lang, s] of Object.entries(READER_UI_STRINGS)) {
      expect(s.info.qualityChecked({ ai: true, image: true, read: 5, date: '1 Nov 2026' }), lang).toContain('5');
      expect(s.info.qualityNotChecked.length, lang).toBeGreaterThan(10);
    }
  });
});
