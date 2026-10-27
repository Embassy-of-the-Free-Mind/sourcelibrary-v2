/**
 * #7089: the runner that drains the ocr-flash-cli-7075 hold (scripts/batch/cli-ocr-lane.mjs) — which books it must not
 * read with the plain prompt, the queue order, the routed → CLI model map, and the reader's quota stop.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { spreadReason, byQueueOrder, CLI_MODEL_FOR, perCallFor } from '../../scripts/batch/cli-ocr-lane.mjs';
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
    // #7558: books read in parallel; exit 3 sets the shared stop that every worker checks before its next book.
    expect(lane).toMatch(/read === 3\) \{ stop \?\?= 'quota'/);
    expect(lane).toMatch(/while \(queue\.length && !stop\)/);
  });
  it('cli-ocr.mjs read exits 3 on a quota reply or a locked model before any sleep', () => {
    expect(reader).toMatch(/process\.exit\(3\)/);
    expect(reader.indexOf("r.not_called && STOP_ON_QUOTA")).toBeLessThan(reader.indexOf('if (r.not_called) { quotaUntil'));
    expect(reader.indexOf("r.cls === 'quota' && STOP_ON_QUOTA")).toBeLessThan(reader.indexOf("if (r.cls === 'quota') { quotaUntil"));
  });
});

describe('pages a call by script (#7558)', () => {
  const opts = { perCall: 4, perCallArabic: 2 };
  it('Latin-script books take --per-call, Arabic-script books --per-call-arabic', () => {
    expect(perCallFor({ language: 'German' }, opts)).toBe(4);
    expect(perCallFor({ language: 'Latin' }, opts)).toBe(4);
    expect(perCallFor({ language: 'Arabic' }, opts)).toBe(2);
    expect(perCallFor({ language: 'Persian' }, opts)).toBe(2);
  });
  it('every other script reads one page a call: no block test covered it', () => {
    for (const language of ['Sanskrit', 'Chinese', 'Greek', 'Tibetan', 'Judeo-Arabic', 'Hebrew']) expect(perCallFor({ language }, opts)).toBe(1);
  });
  it('defaults to one page a call', () => {
    expect(perCallFor({ language: 'German' })).toBe(1);
  });
});
