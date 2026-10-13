import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper
import { ocrReadProblem } from '../../scripts/lib/cli-chatter.mjs';
// @ts-expect-error plain .mjs helper
import { pairCer, normaliseForCer, diffSpans, translationLaneReason, groupOf, sideOf } from '../../scripts/batch/ocr-convergence/lib.mjs';

const page = (body: string) => `<scan-quality>good</scan-quality>\n<language>Latin</language>\n<page-type>text</page-type>\n${body}`;
const latin = Array.from({ length: 14 }, (_, i) => `Capitulum ${i + 1}: de natura elementorum ${['ignis', 'aeris', 'aquae', 'terrae', 'quintae essentiae', 'lucis', 'umbrae'][i % 7]} multa disputata sunt a philosophis ${i % 2 ? 'antiquis' : 'recentioribus'}.`).join(' ');

describe('ocrReadProblem (#6420)', () => {
  it('passes a transcription in the prompt format', () => {
    expect(ocrReadProblem(page(latin))).toBeNull();
  });
  it('flags plan notes, refusals, restarts, openers, duplicates and empties', () => {
    expect(ocrReadProblem('')).toBe('empty');
    expect(ocrReadProblem(page('Please review the implementation plan in [ocr_plan.md](file:///root/.gemini/antigravity-cli/brain/x/ocr_plan.md).'))).toBe('plan-mode reply');
    expect(ocrReadProblem(page('I cannot provide a verbatim transcription of this page.'))).toBe('refusal or summary');
    expect(ocrReadProblem('Quoniam de natura')).toBe('no <page-type> tag');
    expect(ocrReadProblem(page('Quoniam') + '\n' + page('Quoniam'))).toBe('restarted read');
    expect(ocrReadProblem('Here is the transcription:\n' + page(latin))).toBe('conversational opener');
    expect(ocrReadProblem(page(latin + '\n\n' + latin))).toBe('duplicated reply');
  });
});

describe('pairCer', () => {
  it('ignores tags, the long s, ligatures and line-break hyphens', () => {
    expect(normaliseForCer(page('Quoniam ſic eſt de cæ-\nlo'))).toBe('Quoniam sic est de caelo');
    expect(pairCer(page('Quoniam ſic eſt'), page('Quoniam sic est')).cer).toBe(0);
  });
  it('measures a dropped line as disagreement', () => {
    const full = latin + ' Finis huius capituli et initium sequentis.';
    expect(pairCer(page(full), page(latin)).cer).toBeGreaterThan(0.03);
  });
});

describe('diffSpans', () => {
  it('lists the differing words', () => {
    const d = diffSpans('in principio erat verbum', 'in principio erat uerbum');
    expect(d.spans).toEqual(['A: verbum | B: uerbum']);
  });
  it('compares CJK by character', () => {
    expect(diffSpans('天地玄黄', '天地元黄').spans).toEqual(['A: 玄 | B: 元']);
  });
});

describe('translationLaneReason', () => {
  it('defers books a translate lane would pick up', () => {
    expect(translationLaneReason({ pipeline_auto: { status: 'translate_partial' } })).toMatch(/translate_partial/);
    expect(translationLaneReason({ pipeline_auto: { status: 'complete' }, pages_ocr: 100, pages_blank: 0, pages_translated: 80 })).toMatch(/gap-fill/);
    expect(translationLaneReason({ pipeline_auto: { status: 'complete', hold: { reason: 'x' } } })).toBe('book is held');
  });
  it('lets a finished, translated book through', () => {
    expect(translationLaneReason({ pipeline_auto: { status: 'complete' }, pages_ocr: 100, pages_blank: 4, pages_translated: 96 })).toBeNull();
  });
});

describe('groups and blinding', () => {
  it('groups by the first word of language', () => {
    expect(groupOf('Latin')).toBe('latin');
    expect(groupOf('Ancient Greek')).toBe('greek');
    expect(groupOf('Classical Chinese')).toBe('chinese');
    expect(groupOf('French')).toBeNull();
  });
  it('draws the A/B side per page, reproducibly', () => {
    expect(sideOf('p1', 6420)).toBe(sideOf('p1', 6420));
    const sides = new Set(Array.from({ length: 20 }, (_, i) => sideOf(`p${i}`, 6420)));
    expect(sides.size).toBe(2);
  });
});
