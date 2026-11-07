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
import { armcDraftText, armcLang, armcUndrafted, armcPaths, armcTranslateBookOk, ARMC_TRANSLATE_LANGS, ARMC_ENGINES, ARMC_LANE, ARMC_REASON, armcEuroSkip, ARMC_EURO_CELLS, ARMC_EURO_LANE, dropBookImagesIfDone, armcEuroLane } from '../../scripts/batch/cli-ocr-lane.mjs';
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

describe('translate-held frame (#7263): the books the CLI translation lane waits on', () => {
  const book = (o: Record<string, unknown> = {}) => ({ id: 'b1', title: 'De umbris idearum', language: 'Latin', visible: true, pipeline_auto: { status: 'ocr_complete' }, ...o });
  it('takes Latin only', () => {
    expect(ARMC_TRANSLATE_LANGS).toEqual(['la']);
  });
  it('takes an idle unheld book routed to a cli translation row', () => {
    expect(armcTranslateBookOk(book())).toBe(true);
    expect(armcTranslateBookOk(book({ pipeline_auto: { status: 'archive_complete' } }))).toBe(true);
  });
  it('takes a book held for the CLI translation lane, and no other hold', () => {
    expect(armcTranslateBookOk(book({ pipeline_auto: { status: 'held', hold: { reason: 'translate-cli-7075' } } }))).toBe(true);
    expect(armcTranslateBookOk(book({ pipeline_auto: { status: 'held', hold: { reason: 'scans-only-publish-7270' } } }))).toBe(false);
    expect(armcTranslateBookOk(book({ pipeline_auto: { status: 'ocr_complete', hold: { reason: 'invented-ocr-6056' } } }))).toBe(false);
  });
  it('refuses a busy, hidden, spread or pipeline_auto.held book', () => {
    expect(armcTranslateBookOk(book({ pipeline_auto: { status: 'translating' } }))).toBe(false);
    expect(armcTranslateBookOk(book({ visible: false }))).toBe(false);
    expect(armcTranslateBookOk(book({ needs_splitting: true }))).toBe(false);
    expect(armcTranslateBookOk(book({ pipeline_auto: { status: 'ocr_complete', held: true } }))).toBe(false);
  });
  it('takes BPH books too: everything translates on agy (Derek 2026-11-06, #8283)', () => {
    expect(armcTranslateBookOk(book({ image_source: { provider: 'bph' } }))).toBe(true);
  });
});

describe('euro frame (#6871): 1800-1929 Spanish and French print with page records', () => {
  const book = (o: Record<string, unknown> = {}) => ({ id: 'b1', title: 'Historia de las Indias', language: 'Spanish', year: 1875, visible: true, pages_count: 500, pages_ocr: 26, pipeline_auto: { status: 'held', hold: { reason: 'scans-only-publish-7270' } }, ...o });
  it('has the two cells that passed, on LightOnOCR > agy, stamped as the cell test', () => {
    expect(Object.keys(ARMC_EURO_CELLS).filter((c) => ['es19', 'fr19'].includes(c))).toEqual(['es19', 'fr19']);
    expect(ARMC_EURO_CELLS.es19.route).toBe('lighton>agy-flash-low');
    expect(ARMC_EURO_LANE).toBe('gpu-agy-first-read-euro-6871');
  });
  it('takes an unheld book and a scans-only one, and keeps every other hold out', () => {
    expect(armcEuroSkip(book(), 'es19')).toBeNull();
    expect(armcEuroSkip(book({ pipeline_auto: { status: 'needs_attention' } }), 'es19')).toBeNull();
    expect(armcEuroSkip(book({ pipeline_auto: { status: 'held', hold: { reason: 'wrong-leaf-text-7517' } } }), 'es19')).toMatch(/other hold/);
    expect(armcEuroSkip(book({ pipeline_auto: { status: 'held', hold: { reason: 'title-leaf-recitation-6297' } } }), 'es19')).toMatch(/other hold/);
    expect(armcEuroSkip(book({ pipeline_auto: { status: 'complete', held: true } }), 'es19')).toBe('pipeline_auto.held');
  });
  it('needs the cell language first, a parsed year inside the cell, and page records', () => {
    expect(armcEuroSkip(book({ language: 'Latin; Spanish' }), 'es19')).toBe('other first language');
    expect(armcEuroSkip(book({ year: 1799 }), 'es19')).toBe('year outside the cell');
    expect(armcEuroSkip(book({ year: undefined }), 'es19')).toBe('year outside the cell');
    expect(armcEuroSkip(book({ year: 1930 }), 'es19')).toBe('year outside the cell');
    expect(armcEuroSkip(book({ pages_state: { state: 'manifest_only' } }), 'es19')).toMatch(/manifest only/);
  });
  it('keeps unsplit spreads and manuscripts out', () => {
    expect(armcEuroSkip(book({ needs_splitting: true }), 'es19')).toMatch(/unsplit/);
    expect(armcEuroSkip(book({ needs_splitting: true, split_completed: true }), 'es19')).toBeNull();
    expect(armcEuroSkip(book({ image_source: { provider: 'vatican' } }), 'es19')).toBe('manuscript');
  });
  it('French leaves the books the visible-unread first-read lane reads to that lane', () => {
    const fr = (o: Record<string, unknown> = {}) => book({ language: 'French', ...o });
    // visible and held scans-only: the deu,fra visible-unread cron reads it
    expect(armcEuroSkip(fr(), 'fr19')).toBe('read by the visible-unread first-read lane');
    expect(armcEuroSkip(fr({ visible: false }), 'fr19')).toBeNull();
    expect(armcEuroSkip(fr({ pipeline_auto: { status: 'needs_attention' } }), 'fr19')).toBeNull();
    // Spanish has no such lane: a visible scans-only Spanish book stays in
    expect(armcEuroSkip(book(), 'es19')).toBeNull();
  });
});

describe('dropBookImagesIfDone (#6871 disk guard)', () => {
  it('drops a book\'s img/ only once every planned page is ledgered, and keeps the drafts', () => {
    const L = fs.mkdtempSync(path.join(os.tmpdir(), 'armc-euro-'));
    const P = armcPaths(L);
    fs.mkdirSync(path.join(P.drafts, 'b1', 'img'), { recursive: true });
    fs.writeFileSync(path.join(P.drafts, 'b1', 'img', 'p2.jpg'), 'x');
    fs.writeFileSync(path.join(P.drafts, 'b1', 'p1.json'), '{}');
    const pl = { bid: 'b1', pages: [{ id: 'p1', pn: 1 }, { id: 'p2', pn: 2 }] };
    expect(dropBookImagesIfDone(P, pl, new Set(['p1']))).toBe(false);
    expect(fs.existsSync(path.join(P.drafts, 'b1', 'img', 'p2.jpg'))).toBe(true);
    expect(dropBookImagesIfDone(P, pl, new Set(['p1', 'p2']))).toBe(true);
    expect(fs.existsSync(path.join(P.drafts, 'b1', 'img'))).toBe(false);
    expect(fs.existsSync(path.join(P.drafts, 'b1', 'p1.json'))).toBe(true);
    fs.rmSync(L, { recursive: true, force: true });
  });
});

describe('euro frame cells en19 and fr19r (#6871 widening)', () => {
  const en = (o: Record<string, unknown> = {}) => ({ id: 'e1', title: 'A Treatise on Magnetism', language: 'English', year: 1851, visible: false, pages_count: 300, pages_ocr: 0, pipeline_auto: { status: 'needs_attention' }, ...o });
  it('stamps each new cell with its own lane, and es19/fr19 with the euro stamp', () => {
    expect(armcEuroLane('en19')).toBe('gpu-agy-first-read-en-6871');
    expect(armcEuroLane('fr19r')).toBe('gpu-agy-first-read-fr-refusal-6871');
    expect(armcEuroLane('es19')).toBe(ARMC_EURO_LANE);
    expect(ARMC_EURO_CELLS.en19.route).toBe('lighton>agy-flash-low');
    expect(ARMC_EURO_CELLS.fr19r.importOnly).toBe(true);
  });
  it('en19 takes English 1800-1929 books the pipeline has finished with, or held scans-only', () => {
    const none = path.join(os.tmpdir(), 'no-such-plan-dir-6871');
    expect(armcEuroSkip(en(), 'en19', { skipPlannedIn: none })).toBeNull();
    expect(armcEuroSkip(en({ pipeline_auto: { status: 'held', hold: { reason: 'scans-only-publish-7270' } } }), 'en19', { skipPlannedIn: none })).toBeNull();
    expect(armcEuroSkip(en({ pipeline_auto: { status: 'archive_complete' } }), 'en19', { skipPlannedIn: none })).toMatch(/pipeline status archive_complete/);
    expect(armcEuroSkip(en({ pipeline_auto: { status: 'archiving' } }), 'en19', { skipPlannedIn: none })).toMatch(/pipeline status/);
    expect(armcEuroSkip(en({ year: 1930 }), 'en19', { skipPlannedIn: none })).toBe('year outside the cell');
    expect(armcEuroSkip(en({ year: undefined }), 'en19', { skipPlannedIn: none })).toBe('year outside the cell');
    expect(armcEuroSkip(en({ pipeline_auto: { status: 'held', hold: { reason: 'ia-free-text-first-4966' } } }), 'en19', { skipPlannedIn: none })).toMatch(/other hold/);
    expect(armcEuroSkip(en({ pages_state: { state: 'manifest_only' } }), 'en19', { skipPlannedIn: none })).toMatch(/manifest only/);
  });
  it('en19 leaves out a book gpu-print-en planned', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-print-plan-'));
    fs.writeFileSync(path.join(dir, 'e1.json'), '{}');
    expect(armcEuroSkip(en(), 'en19', { skipPlannedIn: dir })).toBe('planned by gpu-print-en');
    expect(armcEuroSkip(en({ id: 'e2' }), 'en19', { skipPlannedIn: dir })).toBeNull();
  });
  it('fr19r keeps the hold rule and does not skip the visible-unread books', () => {
    const fr = { id: 'f1', title: 'Dogme et rituel', language: 'French', year: 1861, visible: true, pages_count: 400, pages_ocr: 380, pipeline_auto: { status: 'complete' } };
    expect(armcEuroSkip(fr, 'fr19r')).toBeNull();
    expect(armcEuroSkip({ ...fr, pipeline_auto: { status: 'held', hold: { reason: 'preview-stub-first-read-8181' } } }, 'fr19r')).toMatch(/other hold/);
  });
});
