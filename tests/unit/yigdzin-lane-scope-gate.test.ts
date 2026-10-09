// PRIOR ART: none for these two helpers — the Yigdzin lane (#4523) had no tests; they were inline in
// scripts/eval/tibetan-lite-vs-yigdzin/{scope,build-todo}.mjs until this file pinned them.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs with no type declarations
import { isLiteModel, scriptGate } from '../../scripts/eval/tibetan-lite-vs-yigdzin/lane-lib.mjs';

/**
 * Two bugs found by tsongkhapa-4523 (2026-10-06) after yig527 had run:
 *  1. scope.mjs exact-matched `gemini-3.1-flash-lite`, so 37 held books whose pages say
 *     `gemini-3.1-flash-lite-preview` never got a Yigdzin read.
 *  2. build-todo.mjs's script gate ran /<[^>]*>/ before stripping lite's `->…<-` centred-heading
 *     markers; the regex ate from `<-` to a later tag's `>`, and Tibetan pages gated as Latin.
 * Each has a positive and a negative control, so a matcher that says yes (or no) to everything goes red.
 */
describe('isLiteModel', () => {
  it('accepts both stamps of the lite model', () => {
    expect(isLiteModel('gemini-3.1-flash-lite')).toBe(true);
    expect(isLiteModel('gemini-3.1-flash-lite-preview')).toBe(true);
  });
  it('rejects other models and near-misses', () => {
    for (const m of ['gemini-3-flash-preview', 'bdrc-yigdzin-v1', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview-x', undefined, null, ''])
      expect(isLiteModel(m)).toBe(false);
  });
});

// A Tibetan page body (well over 50 letters) between a centred heading and a later tag, the shape lite writes.
const TIB_BODY = 'དང་པོ་མདོ་སྡེ་དགོངས་འགྲེལ་ལ་བརྟེན་པའི་ཕྱོགས་ནི། ཇི་ལྟར་གསེར་ལ་བསྲེག་བཅད་བདར་བ་ལྟར། ཡོངས་སུ་གྲུབ་པའི་མཚན་ཉིད་ཀྱི་རྣམ་གཞག་བཤད་པ།';
const NOTE = 'Printed from the Zhol blocks, volume pha, folio fifteen recto, margin';
const ENG_BODY = 'This volume is reproduced from a print from the Zhol blocks, with an introduction in English by the editor.';

describe('scriptGate', () => {
  it('does not gate a Tibetan page that has a centred heading (the yig527 false positive)', () => {
    // The Latin in the trailing note is >= 50 letters but far fewer than the Tibetan body, so the page is
    // Tibetan-dominant. The old order deleted the body and left only the note: Latin-dominant.
    const page = `<page-number>30</page-number>\n->ལེགས་བཤད་སྙིང་པོ<-\n${TIB_BODY}\n<note>${NOTE}</note>`;
    expect(scriptGate(page)).toBeNull();
    const oldOrder = page.replace(/<[^>]*>/g, ' ');
    expect(oldOrder).not.toContain('དགོངས');  // documents the bug the fix removes
  });
  it('still gates a Latin-dominant page, with or without heading markers', () => {
    expect(scriptGate(`->Introduction<-\n${ENG_BODY}\n<note>x</note>`)).toBe('gemini-latin-dominant');
    expect(scriptGate(ENG_BODY)).toBe('gemini-latin-dominant');
  });
  it('gates a CJK-dominant page and leaves a plain Tibetan page alone', () => {
    expect(scriptGate('大正新脩大藏經'.repeat(10))).toBe('gemini-cjk-dominant');
    expect(scriptGate(TIB_BODY)).toBeNull();
    expect(scriptGate('')).toBeNull();
  });
});
