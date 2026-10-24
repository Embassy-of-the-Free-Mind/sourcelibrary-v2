/**
 * The refusal lane (#7170) chooses a reader by the book's first language and skips hidden and contained books. A page in
 * a contained book is withheld on purpose (containment-on-finding.md); filling it would put text back on a shelf a
 * person took it off.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { chartForBook, eligibleBook } from '../../scripts/batch/refused-pages.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { ocrRefusalFallback } from '../../scripts/lib/ocr-routing.mjs';

describe('refused-pages: chart and eligibility', () => {
  it('maps a book to the estimator chart by its first language', () => {
    expect(chartForBook({ language: 'Greek, Latin' })).toBe('greek');
    expect(chartForBook({ language: 'Latin' })).toBe('latin');
    expect(chartForBook({ language: 'English' })).toBe('english');
    expect(chartForBook({ language: 'German' })).toBe('latin-script-other');
    expect(chartForBook({ language: 'Chinese' })).toBe('chinese-print');
    expect(chartForBook({ language: 'Syriac' })).toBe('syriac');
    expect(chartForBook({ language: null })).toBe(null);
  });

  it('never sends a refused page back to Gemini, whatever the chart', () => {
    for (const language of ['Greek', 'Latin', 'English', 'German', 'Chinese', 'Syriac', 'Hebrew', 'Japanese', null]) {
      const chart = chartForBook({ language }) ?? 'none';
      expect([language, /^gemini/.test(ocrRefusalFallback(chart).engine)]).toEqual([language, false]);
    }
  });

  it('takes visible books and held ones, never hidden or contained books', () => {
    expect(eligibleBook({ visible: true })).toBe(true);
    expect(eligibleBook({ visible: false })).toBe(false);
    expect(eligibleBook({ visible: false, pipeline_auto: { hold: { reason: 'ocr-flash-cli-7075' } } })).toBe(true);
    expect(eligibleBook({ visible: false, pipeline_auto: { hold: { reason: 'contained-6420' } } })).toBe(false);
    expect(eligibleBook({ visible: false, labels: ['contained'], pipeline_auto: { hold: { reason: 'x' } } })).toBe(false);
  });
});
