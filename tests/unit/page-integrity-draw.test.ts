import { describe, it, expect } from 'vitest';
// @ts-expect-error untyped script
import { flagsOf, computeReport, plantControl, parseStream, parseVerdict, languageGroup, CAUGHT } from '../../scripts/audit/page-integrity-draw.mjs';

const clean = { text_leaf: { label: 'this_leaf' }, english: { label: 'this_text' }, number: { label: 'disagrees', label_agrees: 'agrees' }, order: { label: 'forward' }, split: { label: 'single_leaf' }, repeat: 'none' };
const page = (slot: number, over = {}) => ({ slot, book_id: `b${slot}`, frame: 5, group: 'Latin', has_text: true, has_english: true, stored_printed_label: '3', coverage: {}, ...over });

describe('page-integrity-draw', () => {
  it('a frame differing from the print is not a flag; a stored number differing is', () => {
    expect(flagsOf(clean)).toEqual([]);
    expect(flagsOf({ ...clean, number: { label: 'disagrees', label_agrees: 'disagrees' } })).toEqual(['number:label_disagrees']);
  });

  it('keeps each defect on its own denominator', () => {
    const pages = [page(0), page(1, { has_english: false }), page(2, { has_text: false, has_english: false })];
    const verdicts = [
      { slot: 0, verdict: { ...clean, text_leaf: { label: 'other' } } },
      { slot: 1, verdict: { ...clean, english: { label: 'none' } } },
      { slot: 2, verdict: { ...clean, text_leaf: { label: 'empty' }, english: { label: 'none' } } },
    ];
    const rep = computeReport(pages, verdicts, [], []);
    expect(rep.defects['text: other book or elsewhere']).toMatchObject({ k: 1, n: 2 });
    expect(rep.defects['text: empty where the leaf has text']).toMatchObject({ k: 1, n: 3 });
    expect(rep.defects['english: invents'].n).toBe(1);
    expect(rep.positives.map((p: { slot: number }) => p.slot)).toEqual([0]);
  });

  it('counts a control only by its own label, and marks a class under the bar', () => {
    const miss = { kind: 'neighbour_text' };
    const controls = [0, 1, 2, 3, 4].map((i) => ({ item: `x${i}`, control: miss, verdict: { ...clean, text_leaf: { label: i < 3 ? 'next_leaf' : 'other' } } }));
    const rep = computeReport([], [], controls, []);
    expect(rep.judge.controls.neighbour_text).toMatchObject({ planted: 5, caught: 3 });
    expect(rep.judge.not_settled).toEqual(['neighbour_text']);
    expect(CAUGHT.order_backward({ ...clean, order: { label: 'jumbled' } })).toBe(true);
  });

  it('plants the defect in the frame the judge reviews and leaves the source pages alone', () => {
    const p = (n: number) => ({ page_number: n, ocr: { data: `ocr${n}` }, translation: { data: `en${n}` } });
    const base = { prev: p(1), cur: p(2), next: p(3), next2: p(4) };
    const shift = plantControl('shift_run', base, null).frames;
    expect(shift.map((f: { ocr: string }) => f.ocr)).toEqual(['ocr2', 'ocr3', 'ocr4']);
    expect(shift[1].tr).toBe('en3');
    const back = plantControl('order_backward', base, null).frames;
    expect(back.map((f: { frame: number; source: { page_number: number } }) => [f.frame, f.source.page_number])).toEqual([[1, 3], [2, 2], [3, 1]]);
    expect(base.cur.ocr.data).toBe('ocr2');
  });

  it('reads the images opened from the stream transcript, and refuses a verdict off the label list', () => {
    const stream = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/frame-2.jpg' } }] } }),
      JSON.stringify({ type: 'result', result: '{}' }),
    ].join('\n');
    expect(parseStream(stream).reads).toEqual(['frame-2.jpg']);
    expect(parseVerdict(JSON.stringify({ ...clean, text_leaf: { label: 'maybe' } }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ ...clean, number: { label: 'agrees' } }))).not.toBeNull();
  });

  it('groups languages', () => {
    expect(languageGroup('Latin')).toBe('Latin');
    expect(languageGroup('Chinese')).toBe('CJK');
    expect(languageGroup('Tibetan')).toBe('other script');
  });
});
