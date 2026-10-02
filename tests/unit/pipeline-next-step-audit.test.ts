/**
 * The daily pipeline_next audit (#5478): the comparator, the named shapes, the fixed denominator and the
 * positive control. Rows are built through the real buildPipelineNext, so a stored stamp here is exactly
 * what sync-worker would have written.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { buildReport, classify, remaining, stampDisagrees, verdict, DISAGREE_FAIL_PCT } from '../../scripts/audit/pipeline-next-step-audit.mjs';
// @ts-expect-error — scripts-side module, no types
import { buildPipelineNext } from '../../scripts/lib/pipeline-next-step.mjs';
// @ts-expect-error — scripts-side module, no types
import { computeTranslationState } from '../../scripts/lib/page-counts.mjs';

const NOW = new Date('2026-10-02T08:00:00Z');
const STAMPED = new Date('2026-10-02T06:00:00Z');

type Counts = { pages_count: number; pages_ocr?: number; pages_translated?: number; pages_blank?: number };

function row(id: string, counts: Counts, extra: Record<string, unknown> = {}) {
  const b: Record<string, unknown> = {
    _id: id, id, visible: true, language: 'Latin', pages_count: counts.pages_count, pages_archived: counts.pages_count,
    pages_blank: counts.pages_blank ?? 0,
    translation_state: computeTranslationState(counts, { language: 'Latin' }),
    _has_summary: true, _chapters_n: 2,
    pipeline_auto: { status: 'complete', images_done_at: STAMPED },
    ...extra,
  };
  b.pipeline_next = buildPipelineNext(b, { now: STAMPED });
  return b;
}

const opts = { now: NOW, openJob: null, freshSince: STAMPED.getTime() - 45 * 60e3 };

describe('stampDisagrees', () => {
  it('compares step, reason and in_flight only', () => {
    const s = { step: 'ocr', reason: 'transcribing', in_flight: false, computed_at: STAMPED };
    expect(stampDisagrees(s, { ...s, computed_at: NOW, recheck_at: NOW })).toBe(false);
    expect(stampDisagrees(s, { ...s, step: 'translate' })).toBe(true);
    expect(stampDisagrees(s, { ...s, reason: 'no_text' })).toBe(true);
    expect(stampDisagrees(s, { ...s, in_flight: true })).toBe(true);
    expect(stampDisagrees(null, s)).toBe(true);
  });
});

describe('classify — the named shapes', () => {
  it('a preview-only book stamped complete is terminal_but_actionable (the #4661 shape)', () => {
    const b = row('p', { pages_count: 250, pages_ocr: 25, pages_translated: 25 });
    const c = classify(b, opts);
    expect(c.fresh.step).toBe('ocr');
    expect(c.shapes).toContain('terminal_but_actionable');
    expect(c.disagree).toBe(false);
  });
  it('a selector status on a finished book is selected_but_done', () => {
    const b = row('d', { pages_count: 100, pages_ocr: 100, pages_translated: 100 }, { pipeline_auto: { status: 'chapters_complete', images_done_at: STAMPED } });
    expect(classify(b, opts).shapes).toEqual(['selected_but_done']);
  });
  it('a stored in-flight stamp with no open job is in_flight_without_job', () => {
    const b = row('f', { pages_count: 100, pages_ocr: 10 });
    (b.pipeline_next as Record<string, unknown>).in_flight = true;
    expect(classify(b, opts).shapes).toContain('in_flight_without_job');
    expect(classify(b, { ...opts, openJob: { type: 'batch_ocr' } }).shapes).not.toContain('in_flight_without_job');
  });
  it('blocked without recheck_at, and an overdue recheck', () => {
    const b = row('h', { pages_count: 100, pages_ocr: 10 }, { pipeline_auto: { status: 'held', hold: { reason: 'x', issue: 1, held_at: STAMPED } } });
    expect(classify(b, opts).shapes).toEqual([]);
    (b.pipeline_next as Record<string, unknown>).recheck_at = null;
    expect(classify(b, opts).shapes).toContain('blocked_without_recheck');
    (b.pipeline_next as Record<string, unknown>).recheck_at = new Date('2026-10-01T00:00:00Z');
    expect(classify(b, opts).shapes).toContain('recheck_overdue');
  });
  it('translate with nothing left for the page selector is translate_selector_empty', () => {
    // 100 pages, 95 OCR'd of which 10 blank, 85 translated: the ladder wants more, the lane has none.
    const b = row('t', { pages_count: 100, pages_ocr: 95, pages_blank: 10, pages_translated: 72 });
    b.translation_state = { ...(b.translation_state as object), translated: 85 };
    const c = classify(b, opts);
    expect(c.fresh.step).toBe('translate');
    expect(c.shapes).toContain('translate_selector_empty');
  });
});

describe('remaining', () => {
  it('counts OCR and translation left by the ladder, none to translate for English', () => {
    const b = row('r', { pages_count: 200, pages_ocr: 50, pages_blank: 10, pages_translated: 20 });
    expect(remaining(b)).toMatchObject({ pages: 200, archive_pages: 0, ocr_pages: 140, translate_pages: 170 });
    const en = { ...b, translation_state: { ...(b.translation_state as object), english_original: true } };
    expect(remaining(en).translate_pages).toBe(0);
  });
});

describe('verdict', () => {
  it('fails above 1% stale disagreement, on blocked-without-recheck, on needs_human, and is probe_broken without a control', () => {
    const base = { denominator: 1000, staleDisagree: 0, noLaneLive: null, blockedNoRecheck: 0, needsHumanLive: 0, positiveOk: true };
    expect(verdict(base).status).toBe('PASS');
    expect(verdict({ ...base, staleDisagree: 10 }).status).toBe('PASS');
    expect(verdict({ ...base, staleDisagree: 10 + DISAGREE_FAIL_PCT }).status).toBe('FAIL');
    expect(verdict({ ...base, blockedNoRecheck: 1 }).status).toBe('FAIL');
    expect(verdict({ ...base, needsHumanLive: 101 }).status).toBe('FAIL');
    expect(verdict({ ...base, noLaneLive: 1 }).status).toBe('FAIL');
    expect(verdict({ ...base, staleDisagree: 500, positiveOk: false }).status).toBe('probe_broken');
  });
});

describe('buildReport', () => {
  const rows = [
    row('a', { pages_count: 100, pages_ocr: 100, pages_translated: 100 }),
    row('b', { pages_count: 300, pages_ocr: 25 }, { visible: false }),
    row('c', { pages_count: 80, pages_ocr: 80 }),
  ];
  it('keeps the fixed denominator and counts live separately', () => {
    const rep = buildReport(rows, { now: NOW, openJobs: new Map() });
    expect(rep.denominator).toMatchObject({ books: 3, live: 2, rule: 'books with pages_count > 0' });
    const ocr = rep.steps.find((s: { step: string }) => s.step === 'ocr');
    expect(ocr.all.books).toBe(1);
    expect(ocr.live.books).toBe(0);
    expect(rep.controls.positive.ok).toBe(true);
    expect(rep.verdict.status).toBe('PASS');
    expect(rep.shapes.step_with_no_lane.all).toBeNull();
  });
  it('a stale wrong stamp is counted against the 1%, a fresh one is not', () => {
    const wrong = { ...rows[2], pipeline_next: { ...(rows[2].pipeline_next as object), step: 'archive' } };
    const stale = buildReport([rows[0], rows[1], wrong], { now: NOW, openJobs: new Map() });
    expect(stale.agreement).toMatchObject({ disagree: 1, stale: 1, fresh: 0 });
    expect(stale.verdict.status).toBe('FAIL');
    const touched = { ...wrong, updated_at: NOW };
    const fresh = buildReport([rows[0], rows[1], touched], { now: NOW, openJobs: new Map() });
    expect(fresh.agreement).toMatchObject({ disagree: 1, stale: 0, fresh: 1 });
    expect(fresh.verdict.status).toBe('PASS');
  });
  it('reports probe_broken when no book agrees, so the control cannot run', () => {
    const allWrong = rows.map((r) => ({ ...r, pipeline_next: null }));
    expect(buildReport(allWrong, { now: NOW, openJobs: new Map() }).verdict.status).toBe('probe_broken');
  });
});
