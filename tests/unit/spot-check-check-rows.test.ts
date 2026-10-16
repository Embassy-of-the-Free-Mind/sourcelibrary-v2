/**
 * check-rows (#6174, scripts/eval/spot-check/check-rows.mjs): how a spot-check run becomes book_checks rows.
 *
 * What these pin: the fortnightly verdict rule (a serious page or a wrong leaf → fix; an on-sight defect → caveat);
 * a page whose text changed after the draw is changed_since_check even when its timestamp predates the review
 * (the reviewer read the packet's frozen text, so TEXT is compared); and a row's cost is the sum over the packet's
 * run-reviewers.sh calls, retry included, with the Opus model id taken from modelUsage. For the curation check: the
 * pages read are the packet's (the note's only without a packet), a reviewer who says it could not read the image is
 * never recorded as an image read, rights_note never travels, and the row passes recordBookCheck()'s own validation
 * against the real registry.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { derivedFortnightly, packetProvenance, runCost, pageFindings, curationCheck, curationReader, notePages } from '../../scripts/eval/spot-check/check-rows.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { provenanceFromPage, buildBookCheck } from '../../scripts/lib/book-checks.mjs';

const page = (over = {}) => ({ page_number: 1, right_page: 'yes', ocr_errors: [], tr_errors: [], other: [], ...over });

describe('derivedFortnightly', () => {
  it('fix on a serious error or a wrong leaf, caveat on an on-sight defect, show otherwise', () => {
    expect(derivedFortnightly({ on_sight_defect: false, pages: [page({ tr_errors: [{ severity: 'serious' }] })] })).toBe('fix');
    expect(derivedFortnightly({ on_sight_defect: false, pages: [page({ right_page: 'no' })] })).toBe('fix');
    expect(derivedFortnightly({ on_sight_defect: true, pages: [page()] })).toBe('caveat');
    expect(derivedFortnightly({ on_sight_defect: false, pages: [page()] })).toBe('show');
  });
});

describe('packetProvenance', () => {
  const pk = [{ page_number: 1, page_id: 'p1', ocr: 'old text', translation: 'old en', ocr_model: 'm-ocr', translation_model: 'm-tr' }];
  const checkedAt = new Date('2026-10-07T12:00:00Z');

  it('marks a page whose text differs from the packet as changed, even with an older timestamp', () => {
    const now = new Map([[1, { page_number: 1, ocr: { data: 'new text', updated_at: new Date('2026-10-07T09:00:00Z') }, translation: { data: 'old en' } }]]);
    const [e] = packetProvenance({ pagesRead: [1], packetPages: pk, now, checkedAt, provenanceFromPage });
    expect(e).toMatchObject({ ocr_model: 'm-ocr', text_compared: true, changed_since_check: true });
    expect(e.ocr_updated_at).toBeUndefined();
  });

  it('stamps an unchanged page with its current *_updated_at', () => {
    const at = new Date('2026-05-01T00:00:00Z');
    const now = new Map([[1, { page_number: 1, ocr: { data: 'old text', updated_at: at }, translation: { data: 'old en', updated_at: at } }]]);
    const [e] = packetProvenance({ pagesRead: [1], packetPages: pk, now, checkedAt, provenanceFromPage });
    expect(e).toMatchObject({ changed_since_check: false, ocr_updated_at: at, translation_updated_at: at });
  });
});

describe('runCost', () => {
  it('sums the call and its retry, and takes the Opus model id', () => {
    const meta = join(mkdtempSync(join(tmpdir(), 'bc-')), 'meta');
    mkdirSync(meta);
    writeFileSync(join(meta, 'korean.json'), JSON.stringify({ total_cost_usd: 2.25, modelUsage: { 'claude-opus-x': { outputTokens: 10 }, 'claude-haiku-y': { outputTokens: 99 } } }));
    writeFileSync(join(meta, 'korean.retry.json'), JSON.stringify({ total_cost_usd: 1.5 }));
    writeFileSync(join(meta, 'korean-2.json'), JSON.stringify({ total_cost_usd: 100 }));
    expect(runCost(meta, 'korean')).toEqual({ usd: 3.75, model: 'claude-opus-x' });
    expect(runCost(join(meta, 'nope'), 'korean')).toBeNull();
  });
});

// pageFindings (#6199): only serious errors and wrong leaves become page findings; a private run keeps its sentences.
describe('pageFindings', () => {
  const pages = [
    page({ page_number: 3 }),
    page({ page_number: 4, ocr_errors: [{ severity: 'minor', problem: 'long s' }], tr_errors: [{ severity: 'serious', class: 'T8', problem: ' sense inverted ' }] }),
    page({ page_number: 5, right_page: 'no' }),
  ];

  it('lists a page only when it has a serious error or is the wrong leaf', () => {
    expect(pageFindings(pages)).toEqual([
      { page_number: 4, errors: [{ stage: 'translation', class: 'T8', kind: 'mistranslation', problem: 'sense inverted' }] },
      { page_number: 5, wrong_page: true, errors: [] },
    ]);
    expect(pageFindings([page()])).toEqual([]);
  });

  it('carries the class but not the reviewer sentence when the evidence is private', () => {
    expect(pageFindings(pages, { withProblem: false })[0]).toEqual({ page_number: 4, errors: [{ stage: 'translation', class: 'T8', kind: 'mistranslation' }] });
  });
});

describe('curation check', () => {
  const checkedAt = new Date('2026-10-13T12:00:00Z');
  const v = { book_id: 'b1', tier: 3, title: 'T', note: 'FIX FIRST. Checked p.41 (a preface): the English is not on the leaf. ?page=41', interest: 'x', rights_note: 'private' };
  const packet = { book_id: 'b1', stratum: 'Latin', pages: [{ page_number: 40, ocr: 'a', translation: 'b', ocr_model: 'm-ocr', translation_model: 'm-tr' }, { page_number: 41, ocr: 'c', translation: 'd', ocr_model: 'm-ocr', translation_model: 'm-tr' }] };
  const base = { file: 'scripts/eval/results/spot-check/curation-x/verdicts/Latin.json', runId: 'curation-x', checkedAt };

  it('reads the pages a note names', () => {
    expect(notePages('Checked p.12 and pp. 7; open ?page=12')).toEqual([7, 12]);
    expect(notePages('SHOW. Sound.')).toEqual([]);
  });

  it('records both packet pages, not only the one the note cites, and splits the packet cost', () => {
    const { input } = curationCheck({ ...base, verdict: v, packet, cost: { usd: 3, model: 'claude-opus-x' }, booksInFile: 4 });
    expect(input).toMatchObject({ book_id: 'b1', method_id: 'curation-check', run_id: 'curation-x', pages_read: [40, 41], verdict: 'fix', verdict_source: 'reader',
      reader: { kind: 'model', model: 'claude-opus-x', image_opened: true }, subscription_usd_eq: 0.75, frame: { pages_read_source: 'packet' } });
    expect(JSON.stringify(input)).not.toContain('private');
  });

  it('falls back to the note without a packet, and skips a verdict that names no page', () => {
    expect(curationCheck({ ...base, verdict: v }).input).toMatchObject({ pages_read: [41], frame: { pages_read_source: 'note' } });
    expect(curationCheck({ ...base, verdict: { ...v, note: 'SHOW. Sound.' } }).skip).toMatch(/no page/);
    expect(curationCheck({ ...base, verdict: { ...v, tier: 4 }, packet }).skip).toMatch(/tier/);
  });

  it('never records an image read the reviewer said it did not make', () => {
    expect(curationReader({ note: 'SHOW WITH CARE. Could not read the image (fetch failed); judged from the text. ?page=3' }).image_opened).toBe('unrecorded');
    expect(curationReader({ note: 'SHOW WITH CARE. The image was unreadable at this size. ?page=3' }).image_opened).toBe('unrecorded');
    expect(curationReader({ note: 'SHOW. Checked p.3 against the image: sound. ?page=3' }).image_opened).toBe(true);
    expect(curationReader({ read_by: 'earlier session', note: 'SHOW. Sound on the checked run.' })).toEqual({ kind: 'model', role: 'earlier session', image_opened: 'unrecorded' });
    expect(curationReader({ read_by: 'earlier session', note: 'SHOW. Checked against the image.' }).image_opened).toBe(true);
    expect(curationReader({ read_by: 'a person', note: 'x' })).toBeNull();
  });

  it('builds a row the registry accepts', () => {
    const { input } = curationCheck({ ...base, verdict: v, packet });
    const now = new Map(packet.pages.map((p) => [p.page_number, { page_number: p.page_number, ocr: { data: p.ocr }, translation: { data: p.translation } }]));
    const row = buildBookCheck({ ...input, method_version: '1', exposure: input.pages_read.map((n: number) => ({ page_number: n, exposure: 'served' })),
      text_provenance: packetProvenance({ pagesRead: input.pages_read, packetPages: packet.pages, now, checkedAt, provenanceFromPage }) });
    expect(row).toMatchObject({ method_id: 'curation-check', verdict: 'fix', pages_read: [40, 41] });
    expect(row.text_provenance.every((e: { changed_since_check: boolean }) => e.changed_since_check === false)).toBe(true);
    expect(row.page_findings).toBeUndefined();
  });
});
