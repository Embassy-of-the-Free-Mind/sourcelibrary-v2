import { describe, it, expect } from 'vitest';
import { ocrFirstGate, ocrEngineMix } from '../../scripts/lib/ocr-first-gate.mjs';

// #6865: two premium translation passes ran on a flash-lite Florentine transcription nobody had opened.
const page = (model?: string) => ({ ocr: model ? { model } : {} });

describe('ocrFirstGate', () => {
  it('refuses a run that rests mostly on flash-lite OCR and names no check', () => {
    const pages = [...Array(8)].map(() => page('gemini-3.1-flash-lite-preview')).concat([page('gemini-4-argon-high'), page()]);
    const r = ocrFirstGate(pages, undefined);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/80% of these pages rest on a flash-lite transcription/);
    expect(r.message).toMatch(/--ocr-checked/);
  });

  it('lets the same run through once the check is named, and echoes it', () => {
    const pages = [page('gemini-3.1-flash-lite'), page('gemini-3.1-flash-lite')];
    const r = ocrFirstGate(pages, 'opened pp. 120, 401, 701 against the images: transcription good');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/OCR checked: opened pp\. 120/);
  });

  it('does not accept a token check', () => {
    expect(ocrFirstGate([page('gemini-3.1-flash-lite')], 'ok').ok).toBe(false);
  });

  it('never blocks a run whose transcription came from another engine', () => {
    const pages = [page('gemini-4-argon-high'), page('claude-opus-5-5'), page('gemini-3.8-flash-low'), page('gemini-3.1-flash-lite'), page()];
    expect(ocrFirstGate(pages, undefined).ok).toBe(true);
  });

  it('reports the engine mix, counting pages with no model recorded', () => {
    const m = ocrEngineMix([page('a'), page('a'), page()]);
    expect(m.total).toBe(3);
    expect(m.mix).toEqual([['a', 2], ['(no model recorded)', 1]]);
  });
});
