/**
 * #7089: the runner that drains the ocr-flash-cli-7075 hold (scripts/batch/cli-ocr-lane.mjs) — which books it must not
 * read with the plain prompt, the queue order, the routed → CLI model map, and the reader's quota stop.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { spreadReason, byQueueOrder, CLI_MODEL_FOR, LITE_AGY, LITE_AGY_OCR_HOLD, LITE_CLAIM_FILTER, liteLaneRefusal, geminiWeeklyRemaining } from '../../scripts/batch/cli-ocr-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { isApiOcrModel } from '../../scripts/lib/ocr-routing.mjs';

describe('spreadReason', () => {
  const cropped = [{ crop: { x: 0 } }, { cropped_photo: 'https://x/1.jpg' }];
  const bare = [{}, {}];
  it('holds back a needs_splitting book whatever its pages carry', () => {
    expect(spreadReason({ needs_splitting: true, pipeline_auto: { split_checked: true } }, cropped)).toMatch(/needs_splitting/);
  });
  it('holds back a book with no crop data that Phase 1.25 has not checked (#523)', () => {
    expect(spreadReason({}, bare)).toMatch(/#523/);
  });
  it('reads a split-checked single-page book and a cropped one', () => {
    expect(spreadReason({ pipeline_auto: { split_checked: true } }, bare)).toBeNull();
    expect(spreadReason({}, cropped)).toBeNull();
  });
});

describe('byQueueOrder', () => {
  it('priority first, then visible, then the oldest hold', () => {
    const books = [
      { id: 'old-hidden', processing_priority: 27, pipeline_auto: { hold: { held_at: '2026-10-21' } } },
      { id: 'new-hidden', processing_priority: 27, pipeline_auto: { hold: { held_at: '2026-10-25' } } },
      { id: 'visible', processing_priority: 27, visible: true, pipeline_auto: { hold: { held_at: '2026-10-26' } } },
      { id: 'urgent', processing_priority: 90, pipeline_auto: { hold: { held_at: '2026-10-26' } } },
      { id: 'none', pipeline_auto: { hold: { held_at: '2026-10-01' } } },
    ];
    expect(books.sort(byQueueOrder).map((b) => b.id)).toEqual(['urgent', 'visible', 'old-hidden', 'new-hidden', 'none']);
  });
});

describe('CLI_MODEL_FOR', () => {
  it('maps only CLI-channel models, and never to an API model', () => {
    for (const [routed, cli] of Object.entries(CLI_MODEL_FOR as Record<string, string>)) {
      expect(isApiOcrModel(routed)).toBe(false);
      expect(isApiOcrModel(cli)).toBe(false);
    }
  });
});

describe('the lane stops on quota instead of sleeping', () => {
  const lane = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr-lane.mjs'), 'utf8');
  const reader = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
  it('passes --stop-on-quota and stops the run on exit 3', () => {
    expect(lane).toContain("'--stop-on-quota'");
    expect(lane).toMatch(/read === 3\) \{[^}]*break/);
  });
  it('cli-ocr.mjs read exits 3 on a quota reply or a locked model before any sleep', () => {
    expect(reader).toMatch(/process\.exit\(3\)/);
    expect(reader.indexOf("r.not_called && STOP_ON_QUOTA")).toBeLessThan(reader.indexOf('if (r.not_called) { quotaUntil'));
    expect(reader.indexOf("r.cls === 'quota' && STOP_ON_QUOTA")).toBeLessThan(reader.indexOf("if (r.cls === 'quota') { quotaUntil"));
  });
});

describe('--lane=lite (#7517): Flash-Lite Batch books read on the second agy account', () => {
  const lane = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr-lane.mjs'), 'utf8');
  const visible = { visible: true, created_at: '2026-01-01' };

  it('takes only books routed to lite on the API, in a family that passed', () => {
    expect(liteLaneRefusal({ ...visible, language: 'German' })).toBeNull();
    expect(liteLaneRefusal({ ...visible, language: 'Latin, Greek' })).toBeNull();
    expect(liteLaneRefusal({ ...visible, language: 'Greek' })).toMatch(/not Flash-Lite Batch/);
    expect(liteLaneRefusal({ ...visible, language: 'English' })).toMatch(/not a cell that passed/);
    expect(liteLaneRefusal({ ...visible, language: 'Latin' }, { families: ['deu'] })).toMatch(/not a cell that passed/);
  });

  it('reads Flash-low, never an API model', () => {
    expect(isApiOcrModel(LITE_AGY.model)).toBe(false);
    expect(LITE_AGY.model).toBe('gemini-3.8-flash-low');
  });

  it("claims only Phase 2's unsubmitted, unheld, split-checked, deduped candidates, past the IA gate", () => {
    expect(LITE_CLAIM_FILTER['pipeline_auto.status']).toBe('archive_complete');
    expect(LITE_CLAIM_FILTER['pipeline_auto.hold']).toEqual({ $exists: false });
    expect(LITE_CLAIM_FILTER['pipeline_auto.split_checked']).toBe(true);
    expect(LITE_CLAIM_FILTER['pipeline_auto.dedup_complete']).toBe(true);
    expect(LITE_CLAIM_FILTER.needs_splitting).toEqual({ $ne: true });
    expect(JSON.stringify(LITE_CLAIM_FILTER.$or)).toContain('ia_reference_at');
    expect(LITE_AGY_OCR_HOLD.reason).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('claims under the Batch submit lease and checks for pages already in a Batch job', () => {
    expect(lane).toMatch(/claimBookForOcrSubmit\(db, book\.id/);
    expect(lane).toMatch(/loadOcrPagesInFlight\(db, \[book\.id\]\)/);
    expect(lane.indexOf('claimBookForOcrSubmit(db, book.id')).toBeLessThan(lane.indexOf('holdBook(db, book.id'));
  });

  it('refuses to run without AGY_HOME, and reads the quota before any book', () => {
    expect(lane).toMatch(/if \(!process\.env\.AGY_HOME\)[^\n]*return 2/);
    const fn = lane.slice(lane.indexOf('async function runLite'));
    expect(fn.indexOf('readQuota()')).toBeLessThan(fn.indexOf('readBook(book'));
    expect(fn).toMatch(/q\.remaining < LITE_AGY\.quotaFloor/);
  });

  it('parses the Gemini weekly bucket of agy /quota, and returns null when it cannot', () => {
    const out = JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [
      { name: 'Gemini Models', buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.0812, reset_time: '2026-11-03T09:24:51Z' }] },
      { name: 'Claude and GPT models', buckets: [{ window: 'weekly', remaining_fraction: 1 }] },
    ] } } });
    expect(geminiWeeklyRemaining(out)).toEqual({ remaining: 0.0812, reset: '2026-11-03T09:24:51Z' });
    expect(geminiWeeklyRemaining('quota reached')).toBeNull();
    expect(geminiWeeklyRemaining(JSON.stringify({ command: { data: { groups: [] } } }))).toBeNull();
  });
});
