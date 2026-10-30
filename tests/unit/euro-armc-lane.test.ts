/**
 * #7567 arm c (cli-ocr-lane.mjs armc): the GPU draft is cleaned exactly as E5's arm c sent it (e2-correct.mjs
 * draftText), the language decides the engine and the router cell, the filler counts only planned pages with no draft
 * file, and the lane-judge sampler routes each written page by its book's language. The put-back rule the writer
 * applies (every diff-guard flag given to the stored reading) is applyDiffVerdicts with every winner 'draft'.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { armcDraftText, armcLang, armcUndrafted, armcPaths, ARMC_ENGINES, ARMC_LANE, ARMC_REASON } from '../../scripts/batch/cli-ocr-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { LANES } from '../../scripts/eval/lane-judge-sampler.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { correctionDiffs, applyDiffVerdicts } from '../../scripts/lib/correction-diff-guard.mjs';

describe('armcDraftText (E2 draftText)', () => {
  it('drops markdown fences and keeps plain text', () => {
    expect(armcDraftText('```markdown\nIn principio erat verbum\n```')).toBe('In principio erat verbum');
  });
  it('flattens CHURRO-style XML to lines', () => {
    expect(armcDraftText('<HistoricalDocument><Metadata>x</Metadata><Line>Prima</Line><Line>Seconda &amp; terza</Line></HistoricalDocument>')).toBe('Prima\nSeconda & terza');
  });
});

describe('armcLang and the engines', () => {
  it('maps Latin to PERO and Italian to LightOnOCR, nothing else', () => {
    expect(armcLang('Latin')).toBe('la');
    expect(armcLang('Latin; Greek')).toBe('la');
    expect(armcLang('Italian')).toBe('it');
    expect(armcLang('German')).toBeNull();
    expect(ARMC_ENGINES.la.engine).toBe('pero');
    expect(ARMC_ENGINES.it.engine).toBe('lightonocr');
  });
});

describe('armcUndrafted (the filler\'s pages left)', () => {
  it('counts planned pages with no draft file', () => {
    const L = fs.mkdtempSync(path.join(os.tmpdir(), 'armc-'));
    const P = armcPaths(L);
    fs.mkdirSync(P.plan, { recursive: true });
    fs.mkdirSync(path.join(P.drafts, 'b1'), { recursive: true });
    fs.writeFileSync(path.join(P.plan, 'b1.json'), JSON.stringify({ bid: 'b1', lang: 'la', pages: [{ id: 'p1', pn: 10 }, { id: 'p2', pn: 11 }, { id: 'p3', pn: 12 }] }));
    fs.writeFileSync(path.join(P.drafts, 'b1', 'p2.json'), JSON.stringify({ text: 'x' }));
    expect(armcUndrafted(L).map((p: { id: string }) => p.id)).toEqual(['p1', 'p3']);
    fs.rmSync(L, { recursive: true, force: true });
  });
});

describe('lane-judge sampler registration', () => {
  it('routes the arm-c lane by the book\'s language and judges the stored lite draft beside it', () => {
    const L = LANES.find((l: { lane: string }) => l.lane === ARMC_LANE);
    expect(L.enabled).toBe(true);
    expect(L.stamp).toEqual({ 'ocr.pipeline': ARMC_LANE });
    expect(L.reason.test(`${ARMC_REASON}: PERO draft`)).toBe(true);
    expect(L.route('Latin')).toBe('pero>agy-flash-low');
    expect(L.route('Italian')).toBe('lighton>agy-flash-low');
    expect(L.cell('Latin')).toBe('latin-lite');
    expect(L.cell('Italian')).toBe('italian-lite');
    expect(L.cell('German')).toBeNull();
    expect(L.draft_route).toBe('lite');
  });
});

describe('put-back to the stored reading', () => {
  it('gives every flagged change back to the stored text and keeps the rest of the correction', () => {
    const stored = 'Et dixit quod non sunt xij libri in domo eius, et fuit anno 1550 in vrbe.';
    const next = 'Et dixit quod sunt xiij libri in domo eius, et fuit anno 1550 in urbe Roma.';
    const { flags } = correctionDiffs(stored, next, { lang: 'la' });
    expect(flags.map((f: { kind: string }) => f.kind).sort()).toEqual(['negation', 'number']);
    const back = applyDiffVerdicts(stored, next, flags, flags.map((f: { i: number }) => ({ i: f.i, winner: 'draft' })));
    expect(back.text).toBe('Et dixit quod non sunt xij libri in domo eius, et fuit anno 1550 in urbe Roma.');
    expect(back.reverted).toBe(2);
  });
});
