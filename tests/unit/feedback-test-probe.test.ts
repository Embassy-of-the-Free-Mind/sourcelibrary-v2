import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper shared with scripts/analytics/feedback-triage.mjs
import { isTestProbe } from '../../scripts/lib/feedback-test-probe.mjs';

/**
 * The triage report groups canary, probe and blank submissions apart from reader
 * feedback. The positive cases are the shapes of the 29 rows cleared by hand
 * on 2026-11-16; the negative cases are real reader messages that mention
 * tests, probes or URLs and must stay in the queue.
 */
describe('isTestProbe', () => {
  it.each([
    [{ message: 'probe-eydbke' }],
    [{ message: 'attacker-controlled' }],
    [{ message: 'audit-fixture' }],
    [{ message: '' }],
    [{ message: '   ' }],
    [{ message: 'test', name: 'test', page: 'test' }],
    [{ message: 'http://oob:9100/mcpfc280a542ad' }],
    [{ message: '//oob:9100/mcpf5c74bd75cc' }],
    [{ message: 'https://trusted.example.com@oob:9100/mcpfce4b5f6619' }],
    [{ message: '?url=http://oob:9100/mcpf47a4349d98' }],
  ])('flags %j', (row) => {
    expect(isTestProbe(row)).toBe(true);
  });

  it.each([
    [{ message: 'I want book.' }],
    [{ message: 'Yes' }],
    [{ message: 'A test of patience: the page will not load', page: '/book/x' }],
    [{ message: 'The probe in the Ripley Scroll image is too small to read' }],
    [{ message: 'see https://www.e-manuscripta.ch/zuz/content/zoom/127732 for the 1556 edition' }],
    [{ message: 'Reading guide requested for "The Anthill (Formicarius)" (book 699052328d19cbc90d9d55f6)' }],
  ])('keeps %j', (row) => {
    expect(isTestProbe(row)).toBe(false);
  });
});
