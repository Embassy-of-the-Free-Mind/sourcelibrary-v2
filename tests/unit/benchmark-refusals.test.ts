/**
 * A page the engine DECLINED is not a page it misread (#5581).
 *
 * benchmark-score.mjs and benchmark-dashboard-data.mjs decide "refused" through
 * scripts/eval/lib/refusals.mjs. These tests pin the two ways that decision has gone wrong in this
 * repo: treating every short output as a refusal (the Greek strata count Greek letters only, and
 * Gemini returns genuinely empty STOP outputs on some Japanese leaves), and reading the FIRST meter
 * row of a page a resumed run re-ran.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-expect-error — plain .mjs module without type declarations
import { readMeter, refusalOf } from '../../scripts/eval/lib/refusals.mjs';

describe('refusalOf', () => {
  it('a RECITATION finish with an empty output is a refusal, sourced to the meter', () => {
    expect(refusalOf({ engine: 'gemini-3-flash-preview', meterRow: { finishReason: 'RECITATION' }, rawText: '' }))
      .toEqual({ refused: true, source: 'finishReason', finish_reason: 'RECITATION' });
    expect(refusalOf({ engine: 'gemini-3.1-flash-lite', meterRow: { finishReason: 'PROHIBITED_CONTENT' }, rawText: '\n' }).refused).toBe(true);
  });

  it('an empty STOP output is a blank read, not a refusal — even with a long reference', () => {
    expect(refusalOf({ engine: 'gemini-3.1-flash-lite', meterRow: { finishReason: 'STOP' }, rawText: '', refChars: 5000 }).refused).toBe(false);
  });

  it('a refusal reason that still returned text is a partial read, not a declined page', () => {
    expect(refusalOf({ engine: 'gemini-3.1-flash-lite', meterRow: { finishReason: 'RECITATION' }, rawText: 'Arma virumque cano' }).refused).toBe(false);
  });

  it('without a meter, infers only for an API engine, a zero-byte output and a substantial reference', () => {
    expect(refusalOf({ engine: 'gemini-3-flash-preview', meterRow: undefined, rawText: '', refChars: 800 }))
      .toEqual({ refused: true, source: 'inferred', finish_reason: null });
    expect(refusalOf({ engine: 'gemini-3-flash-preview', meterRow: undefined, rawText: '', refChars: 0 }).refused).toBe(false);
    expect(refusalOf({ engine: 'gemini-3-flash-preview', meterRow: undefined, rawText: ' ', refChars: 800 }).refused).toBe(false);
    expect(refusalOf({ engine: 'tesseract-lat', meterRow: undefined, rawText: '', refChars: 800 }).refused).toBe(false);
  });

  it('an engine that never ran the page has refused nothing', () => {
    expect(refusalOf({ engine: 'gemini-3-flash-preview', meterRow: { finishReason: 'RECITATION' }, rawText: null }).refused).toBe(false);
  });
});

describe('readMeter', () => {
  it('keeps the LAST row per slug (a resumed run re-runs an empty page) and skips bad lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-'));
    fs.writeFileSync(path.join(dir, '_meter.jsonl'), [
      JSON.stringify({ slug: 'a', finishReason: 'RECITATION' }),
      'not json',
      JSON.stringify({ slug: 'b', finishReason: 'STOP' }),
      JSON.stringify({ slug: 'a', finishReason: 'STOP' }),
      '',
    ].join('\n'));
    const m = readMeter(dir);
    expect(m.get('a').finishReason).toBe('STOP');
    expect(m.get('b').finishReason).toBe('STOP');
    expect(m.size).toBe(2);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns null when the engine left no meter (a local engine)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-'));
    expect(readMeter(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });
});
