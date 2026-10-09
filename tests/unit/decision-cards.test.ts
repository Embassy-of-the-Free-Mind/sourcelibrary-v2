/**
 * Decision cards (eval-design §10.2, #5873): the presets in routing-rules.mjs, and a replay of
 * this week's decisions through them from STORED result files (no model call, no database).
 *
 * Why the replays are pinned: the cards exist because three decisions were taken on evidence
 * nobody had sized beforehand. If a preset changes, these tests say which past decision it
 * re-reads: #5740 (Flash translation routing), #5700 A5 (re-OCR before retranslation),
 * #5678 (folio markers), #5795 (Persian hidden backlog), #5761 (the OCR-trust gate).
 */
import { describe, it, expect } from 'vitest';
import {
  DECISION_CARDS, GRADES, stakeTier, gradeOf, heterogeneity, effectBeyondFloor, cardVerdict,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/lib/routing-rules.mjs';
import {
  audit, flashTranslationEvidence, reocrBackfillEvidence, markersEvidence, vernacularPooling,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/decision-cards-audit.mjs';
import fs from 'node:fs';
import path from 'node:path';

const missing = (v: { missing: string[] }, re: RegExp) => v.missing.some((m) => re.test(m));
const JUDGE = { controls_pass: true, ties_allowed: true, blind_judges: 2, human_calibrated: true };

describe('decision cards: the presets', () => {
  it('there is one preset per card, and the grades are the dashboard thresholds', () => {
    expect(Object.keys(DECISION_CARDS)).toEqual(['routing', 'backfill', 'prompt', 'gate']);
    expect(GRADES).toEqual({ directional: 30, decision: 50 });
    expect([29, 30, 49, 50].map(gradeOf)).toEqual(['exploratory', 'directional', 'directional', 'decision']);
  });

  it('tiers by dollars and reversibility', () => {
    expect(stakeTier({ usd: 10, reversible: true })).toBe('small');
    expect(stakeTier({ usd: 11, reversible: true })).toBe('medium');
    expect(stakeTier({ usd: 501, reversible: true })).toBe('large');
    expect(stakeTier({ usd: 5, reversible: true, queues_downstream: true })).toBe('large');
    expect(stakeTier({ usd: 5, reversible: false })).toBe('large');
    // Served text changes: never small; large unless the undo is proven.
    expect(stakeTier({ usd: 5, reversible: true, changes_served_text: true })).toBe('large');
    expect(stakeTier({ usd: 5, reversible: true, changes_served_text: true, undo_proven: true })).toBe('medium');
  });

  it('an effect must exclude zero, sit outside the A-vs-A interval and reach the minimum effect', () => {
    const floor = { delta: -0.05, ci: [-0.2, 0.13] }; // T5, Lite twice
    expect(effectBeyondFloor({ delta: 0.4, ci: [0.22, 0.58] }, floor, { min_effect: 0.25 }).pass).toBe(true); // T5 Flash − Lite
    expect(effectBeyondFloor({ delta: 0.12, ci: [0.02, 0.22] }, floor, { min_effect: 0.25 })).toMatchObject({ pass: false, outside_floor: false }); // T5 check-and-fix
    expect(effectBeyondFloor({ delta: 0.22, ci: [0.06, 0.37] }, { delta: -0.02, ci: [-0.16, 0.13] }, { min_effect: 0.25 })).toMatchObject({ pass: false, excludes_zero: true, reaches_min_effect: false }); // T1 Latin
    expect(effectBeyondFloor({ delta: 0.4, ci: [0.22, 0.58] }, null, { min_effect: 0.25 }).pass).toBeNull(); // no A-vs-A arm: unanswered
  });

  it('NEGATIVE CONTROL: a pool never clears a language that is itself below directional', () => {
    const langs = [{ lang: 'big', n: 60, delta: 0.5, ci: [0.3, 0.7] }, { lang: 'thin', n: 12, delta: 0.6, ci: [0.3, 0.9] }];
    const v = cardVerdict('routing', {
      proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity', stake: { usd: 100, reversible: true }, preregistered: true,
      floor: { delta: 0, ci: [-0.1, 0.1] }, languages: langs, pool: { n: 72, delta: 0.52, ci: [0.35, 0.69], registered: true }, judge: JUDGE,
    });
    expect(v.pooling.usable).toBe(true);
    expect(v.languages.big.cleared).toBe(true);
    expect(v.languages.thin).toMatchObject({ cleared: false, short_by: 18 });
    expect(v.sufficient).toBe(false);
  });

  it('a pool lifts a directional language to decision grade, and only if it was registered', () => {
    const e = {
      proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity', stake: { usd: 2000, reversible: true }, preregistered: true,
      floor: { delta: 0, ci: [-0.1, 0.1] }, judge: JUDGE, replication: { fresh_books: 30, passed_alone: true },
      languages: [{ lang: 'a', n: 32, delta: 0.4, ci: [0.1, 0.7] }, { lang: 'b', n: 35, delta: 0.45, ci: [0.15, 0.75] }],
      pool: { n: 67, delta: 0.43, ci: [0.25, 0.6], registered: true },
    };
    expect(cardVerdict('routing', e)).toMatchObject({ tier: 'large', sufficient: true });
    const post = cardVerdict('routing', { ...e, pool: { ...e.pool, registered: false } });
    expect(post.sufficient).toBe(false);
    expect(missing(post, /pool was not named before the run/)).toBe(true);
  });

  it('a positive case passes: small stake, directional, registered, beyond the floor', () => {
    const v = cardVerdict('routing', {
      proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity', stake: { usd: 8, reversible: true }, preregistered: true,
      floor: { delta: 0, ci: [-0.15, 0.15] }, languages: [{ lang: 'x', n: 30, delta: 0.5, ci: [0.25, 0.75] }], pool: null,
      judge: { ...JUDGE, human_calibrated: false },
    });
    expect(v).toMatchObject({ tier: 'small', sufficient: true, missing: [] });
  });

  it('agreement, stability and preference cannot decide; "keep what we have" stands at any grade', () => {
    const base = { proposes_change: true, metric: 'fidelity', stake: { usd: 8, reversible: true }, preregistered: true, floor: { delta: 0, ci: [-0.1, 0.1] }, languages: [{ lang: 'x', n: 40, delta: 0.5, ci: [0.3, 0.7] }], pool: null };
    for (const measure of ['agreement', 'stability', 'preference']) expect(missing(cardVerdict('routing', { ...base, measure }), /cannot decide/)).toBe(true);
    expect(cardVerdict('prompt', { proposes_change: false })).toMatchObject({ sufficient: true, stands_as: 'no change' });
  });

  it('a judge decides an absolute threshold, or a candidate of its own family, only after readers have checked it', () => {
    const base = { proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity', stake: { usd: 8, reversible: true }, preregistered: true, floor: { delta: 0, ci: [-0.1, 0.1] }, languages: [{ lang: 'x', n: 40, delta: 0.5, ci: [0.3, 0.7] }], pool: null };
    expect(cardVerdict('routing', { ...base, judge: { ...JUDGE, human_calibrated: false } }).sufficient).toBe(true);
    expect(missing(cardVerdict('routing', { ...base, judge: { ...JUDGE, human_calibrated: false, same_family_as_candidate: true } }), /not calibrated against readers/)).toBe(true);
    expect(missing(cardVerdict('routing', { ...base, judge: { ...JUDGE, human_calibrated: false, absolute_threshold: true } }), /not calibrated against readers/)).toBe(true);
  });

  it('gate, flag kind: 5 of 5 is not precision 0.8; 40 of 40 by a human read is', () => {
    const five = cardVerdict('gate', { kind: 'flag', preregistered: true, precision: { hits: 4, flagged: 5 }, label_from: 'by_eye_human', recall: 0.24 }); // #5700 Greek dictionary miss
    expect(five.sufficient).toBe(false);
    expect(five.precision_wilson95[0]).toBeLessThan(0.65);
    expect(cardVerdict('gate', { kind: 'flag', preregistered: true, precision: { hits: 40, flagged: 40 }, label_from: 'by_eye_human', recall: 0.5 }).sufficient).toBe(true);
    expect(missing(cardVerdict('gate', { kind: 'flag', preregistered: true, precision: { hits: 40, flagged: 40 }, label_from: 'judged', recall: 0.5 }), /not a human read/)).toBe(true);
  });
});

describe('decision cards: this week, replayed from stored results', () => {
  const A = audit();

  it('#5740 Flash translation routing: Greek clears on its own; the other six languages are under 30 books', () => {
    const { T2, T4, T5 } = A['flash-translation-5740'];
    expect(T2.languages.Greek).toMatchObject({ n: 75, grade: 'decision', cleared: true });
    expect(T2.tier).toBe('large');
    expect(missing(T2, /replication/)).toBe(true);
    // Persian and Pali are exploratory alone, and the pool does not clear them.
    expect(T4.languages.Persian).toMatchObject({ n: 12, cleared: false, short_by: 18 });
    expect(T5.languages.Pali).toMatchObject({ n: 16, cleared: false, short_by: 14 });
    expect(T4.languages).toMatchObject({ Arabic: { short_by: 10 }, Hebrew: { short_by: 15 } });
    expect(T5.languages).toMatchObject({ Sanskrit: { short_by: 2 }, Chinese: { short_by: 6 } });
    // The pools themselves are sound: homogeneous, at decision grade, beyond the floor.
    expect(T4.pooling).toMatchObject({ usable: true, pass: true });
    expect(T5.pooling).toMatchObject({ usable: true, pass: true });
    for (const t of [T2, T4, T5]) { expect(t.sufficient).toBe(false); expect(missing(t, /preregistration/)).toBe(true); }
  });

  it('#5740: every routed language still shows an effect of the pooled sign (the audit asks for a top-up, not a revert)', () => {
    for (const t of ['T2', 'T4', 'T5']) for (const l of flashTranslationEvidence(t).languages) expect(l.delta).toBeGreaterThanOrEqual(DECISION_CARDS.routing.min_effect.fidelity);
  });

  it('#5700 A5 re-OCR backfill: not enough yet — 14 selected Greek pages, no random sample, no replication', () => {
    const v = A['reocr-backfill-a5-5700'];
    expect(v).toMatchObject({ card: 'backfill', tier: 'large', sufficient: false });
    expect(v.languages.Greek).toMatchObject({ n: 14, grade: 'exploratory', cleared: false });
    for (const re of [/sample: pages were selected/, /replication/, /undo/, /preregistration/]) expect(missing(v, re)).toBe(true);
    // The effect itself is real on these pages: the gap is n and sampling, not the direction.
    const e = reocrBackfillEvidence(), greek = e.languages.find((l: { lang: string }) => l.lang === 'Greek');
    expect(effectBeyondFloor(greek, e.floor, { min_effect: 0.25 }).pass).toBe(true);
  });

  it('#5678 folio markers: the card says do not flip, as the registered rule did', () => {
    const v = A['folio-markers-5678'], e = markersEvidence();
    expect(e.pool).toMatchObject({ n: 100, delta: -7 }); // 19 vs 26 per 100 breaks
    expect(e.floor.ci[1]).toBeGreaterThanOrEqual(8); // two Lite runs differ on 26 breaks: the floor is wider than the effect
    expect(effectBeyondFloor(e.pool, e.floor, { min_effect: 8, higher_is_better: false })).toMatchObject({ pass: false, excludes_zero: false, reaches_min_effect: false });
    expect(v.sufficient).toBe(false);
    expect(missing(v, /guard failed/)).toBe(true);
  });

  it('#5795 Persian hidden backlog: stands on an override; the margin was post hoc and no replication exists', () => {
    const v = A['persian-hidden-flash-5795'];
    expect(v).toMatchObject({ tier: 'medium', sufficient: false });
    expect(v.languages.Persian).toMatchObject({ n: 27, short_by: 3 });
    expect(missing(v, /preregistration/)).toBe(true);
  });

  it('#5761 OCR-trust gate: three strata hold provisionally; Latin incunabula is not supported at n 10', () => {
    const v = A['ocr-trust-gate-5761'];
    expect(v.strata['Greek manuscripts']).toMatchObject({ n: 12, status: 'provisional' });
    expect(v.strata.Persian).toMatchObject({ n: 12, status: 'provisional' });
    expect(v.strata['Greek print 1450–1599']).toMatchObject({ n: 15, status: 'provisional' });
    expect(v.strata['Latin incunabula']).toMatchObject({ n: 10, status: 'not supported', short_by: 20 });
    expect(v.strata['Latin incunabula'].ci[1]).toBeGreaterThan(4);
  });

  it('T3: the vernaculars may not be pooled — French points the other way', () => {
    expect(vernacularPooling()).toMatchObject({ pass: false, offenders: ['French'] });
    expect(heterogeneity([{ lang: 'tiny', n: 5, delta: -1, ci: [-2, -0.5] }], { delta: 0.3 })).toMatchObject({ pass: true, voters: 0 }); // under 10 books: no vote
  });

  it('the committed audit is what the tool writes', () => {
    const stored = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/eval/results/decision-cards-5873/audit.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(A))).toEqual(stored);
  });
});
