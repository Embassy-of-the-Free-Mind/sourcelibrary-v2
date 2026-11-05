import { describe, it, expect } from 'vitest';
import { ocrFirstGate, ocrEngineMix, uncheckedLite } from '../../scripts/lib/ocr-first-gate.mjs';

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

  it('does not count a flash-lite page a person edited, or one whose read says it has no text (#7263)', () => {
    const lite = 'gemini-3.1-flash-lite';
    expect(uncheckedLite({ ocr: { model: lite, data: 'In principio erat verbum' } })).toBe(true);
    expect(uncheckedLite({ ocr: { model: lite, data: 'x', edited_by: 'u1' } })).toBe(false);
    expect(uncheckedLite({ ocr: { model: lite, data: 'x', source: 'manual' } })).toBe(false);
    expect(uncheckedLite({ ocr: { model: lite, data: '<page-type>blank</page-type>' } })).toBe(false);
    expect(uncheckedLite({ ocr: { model: lite, data: '<page-type> illustration</page-type>\n[figure]' } })).toBe(false);
    expect(uncheckedLite({ ocr: { model: 'gemini-3.8-flash-low', data: 'x' } })).toBe(false);
    // 3 of 5 pages are flash-lite, but one was edited and one is a plate: 1 of 5 unchecked passes the 20% bar
    const pages = [
      { ocr: { model: lite, data: 'text' } },
      { ocr: { model: lite, data: 'text', edited_by: 'u1' } },
      { ocr: { model: lite, data: '<page-type>plate</page-type>' } },
      { ocr: { model: 'gemini-3.8-flash-low', data: 'text' } },
      { ocr: { model: 'gemini-3.8-flash-low', data: 'text' } },
    ];
    const r = ocrFirstGate(pages, undefined);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/2 flash-lite page\(s\) edited by a person or with no text: not counted/);
  });
});
