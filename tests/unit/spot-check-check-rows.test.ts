/**
 * check-rows (#6174, scripts/eval/spot-check/check-rows.mjs): how a spot-check run becomes book_checks rows.
 *
 * What these pin: the fortnightly verdict rule (a serious page or a wrong leaf → fix; an on-sight defect → caveat);
 * a page whose text changed after the draw is changed_since_check even when its timestamp predates the review
 * (the reviewer read the packet's frozen text, so TEXT is compared); and a row's cost is the sum over the packet's
 * run-reviewers.sh calls, retry included, with the Opus model id taken from modelUsage.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { derivedFortnightly, packetProvenance, runCost } from '../../scripts/eval/spot-check/check-rows.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { provenanceFromPage } from '../../scripts/lib/book-checks.mjs';

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
