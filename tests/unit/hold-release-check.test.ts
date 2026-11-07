/**
 * The weekly hold-release check's rules (#7860), exercised on group facts rather than Mongo/GitHub.
 * The ops decision files are private, so the markdown below is written for the test; it keeps the two
 * shapes the parser depends on: DECIDED.md is read whole, DECISIONS-PENDING.md only under "## Done …".
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { classify, decidedLines, findDecision, fold } from '../../scripts/audit/hold-release-check.mjs';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const OLD = new Date('2026-09-24T00:00:00Z'), NEW = new Date('2026-10-29T00:00:00Z');
const DECIDED = '# Decided\n\n- 2026-09-30 · Go on the Syriac re-translation at batch rates · default (derived)\n';
const PENDING = [
  '# Decisions pending',
  '## Open',
  '- **Tibetan retranslation awaits a lane (recommended: Opus).** not decided yet',
  '## Done 2026-10-31',
  '- 2026-10-24 · Tibetan + Sanskrit translation goes to Opus via claude -p. Job `opus-tib-sa-6948` (l7a) → #6948.',
].join('\n');
const lines = decidedLines(DECIDED, PENDING);
const open = (recent = false, decided_comment = null) => ({ state: 'open', closed_at: null, recent_comment: recent, decided_comment });
const ctx = (issues: Record<number, unknown> = {}, extra = {}) => ({ now: NOW, issues: new Map(Object.entries(issues).map(([k, v]) => [Number(k), v])), decided: lines, decidedReadable: true, ...extra });
const flags = (g: object, c = ctx()) => classify({ n: 1, visible: 1, issue: null, oldest: NEW, ...g }, c).map((f: { flag: string }) => f.flag);

describe('hold-release-check: decided text', () => {
  it('reads DECIDED.md whole and only the Done sections of DECISIONS-PENDING.md', () => {
    expect(findDecision(lines, ['opus-tib-sa-6948'])?.file).toBe('DECISIONS-PENDING.md Done');
    expect(findDecision(lines, ['tibetan retranslation awaits'])).toBeNull(); // an Open row is not a decision
    expect(findDecision(lines, ['syriac re-translation'])?.file).toBe('DECIDED.md');
  });
  it('folds case and punctuation, and refuses terms too short to mean anything', () => {
    expect(fold('Syriac re-translation')).toBe(fold('SYRIAC RETRANSLATION'));
    expect(findDecision(lines, ['Go'])).toBeNull();
  });
});

describe('hold-release-check: flags', () => {
  it('DECIDED: an awaits hold whose decision is in the ops log', () => {
    const g = { reason: 'tibetan-retranslation-awaits-derek', issue: 4523, oldest: OLD, release_when: { kind: 'decision', ref: 'opus-tib-sa-6948' } };
    expect(flags(g, ctx({ 4523: open(true) }))).toEqual(['DECIDED']);
  });
  it('DECIDED falls back to a "default taken" comment on the issue when the ops log cannot be read', () => {
    const g = { reason: 'peiresc-awaits-derek-5811', issue: 5811, release_when: { kind: 'decision', ref: 'peiresc letters ocr' } };
    expect(flags(g, ctx({ 5811: open(true) }, { decidedReadable: false }))).toEqual([]);
    expect(flags(g, ctx({ 5811: open(true, { at: '2026-10-20T00:00:00Z', text: 'default taken: OCR vol I' }) }, { decidedReadable: false }))).toEqual(['DECIDED']);
  });
  it('an undecided decision with a live issue is not flagged', () => {
    expect(flags({ reason: 'scans-only-publish-7176', issue: 7176, oldest: OLD, release_when: { kind: 'decision', ref: 'scans-only-publish-7176' } }, ctx({ 7176: open(true) }))).toEqual([]);
  });
  it('QUIET: over 14 days with a silent issue, a closed issue, or no issue; not when young', () => {
    const g = { reason: 'ocr-unsettled-6420', issue: 6420, oldest: OLD, release_when: { kind: 'test', ref: 'x' } };
    expect(flags(g, ctx({ 6420: open(false) }))).toEqual(['QUIET']);
    expect(flags(g, ctx({ 6420: open(true) }))).toEqual([]);
    expect(flags({ ...g, oldest: NEW }, ctx({ 6420: open(false) }))).toEqual([]);
    expect(flags(g, ctx({ 6420: { state: 'closed', closed_at: '2026-10-20' } }))).toEqual(['QUIET']);
    expect(flags({ reason: 'harmony-byz-ranges', oldest: OLD, release_when: { kind: 'decision', ref: 'harmony-byz-ranges' } })).toEqual(['QUIET']);
  });
  it('DUE: a past date, or a release_when issue that closed (and then not also QUIET)', () => {
    expect(flags({ reason: 'zh-flash-agy-7037', issue: 7037, release_when: { kind: 'date', ref: '2026-10-24' } }, ctx({ 7037: open(true) }))).toEqual(['DUE']);
    expect(flags({ reason: 'bw-reread-7274', issue: 7274, release_when: { kind: 'date', ref: '2026-11-02' } }, ctx({ 7274: open(true) }))).toEqual([]);
    expect(flags({ reason: 'x-5595', issue: 5566, oldest: OLD, release_when: { kind: 'issue', ref: 5595 } }, ctx({ 5595: { state: 'closed', closed_at: '2026-10-01' } }))).toEqual(['DUE']);
  });
  it('BAD_CONDITION: a release_when in another shape is not read as a condition', () => {
    expect(flags({ reason: 'tibetan-translation-lane-6948', issue: 6948, release_when: { kind: 'issue_state' } }, ctx({ 6948: open(true) }))).toEqual(['BAD_CONDITION']);
  });
  it('NO_CONDITION: a hold without release_when', () => {
    expect(flags({ reason: 'some-hold-7000', issue: 7000, release_when: null }, ctx({ 7000: open(true) }))).toEqual(['NO_CONDITION']);
  });
});
