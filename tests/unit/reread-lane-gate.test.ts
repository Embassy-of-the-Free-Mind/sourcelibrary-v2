/**
 * #6769: the per-book gate that stands in for cli-ocr.mjs's 40% shared-words floor on a re-read lane, the fitted-text
 * skip, and the foreign-script guard (scripts/lib/reread-lane-gate.mjs).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { fittedTextReason, foreignScriptReason, expectedScripts, gateVerdict, gateUsable, gateProvenance, GATE_SCHEMA, sha256 } from '../../scripts/lib/reread-lane-gate.mjs';

type Row = { uid: string; verdict: { verdict: 'A' | 'B' | 'same' } | null };
// A key of `n` sample pages (A = g4l, B = served) and `c` controls (A = clean, B = planted), as draw.mjs writes it.
function keyFile(n: number, c: number, frame = n + c) {
  const key: Record<string, object> = {};
  for (let i = 0; i < n; i++) key[`s${i}`] = { kind: 'sample', page_id: `p${i}`, page_number: i + 1, A: 'g4l', B: 'served', read_hash: `h${i}` };
  for (let i = 0; i < c; i++) key[`c${i}`] = { kind: 'control', page_id: `q${i}`, page_number: 100 + i, A: 'clean', B: 'planted' };
  return { book: 'b1', frame, key };
}
const rowsFor = (k: ReturnType<typeof keyFile>, pick: (uid: string) => 'A' | 'B' | 'same' | null): Row[] =>
  Object.keys(k.key).map((uid) => ({ uid, verdict: pick(uid) ? { verdict: pick(uid)! } : null }));

describe('gateVerdict', () => {
  it('passes with 0 worse and every control caught', () => {
    const k = keyFile(30, 5);
    const v = gateVerdict(k, rowsFor(k, (u) => (u === 's3' ? 'same' : 'A')));
    expect(v.pass).toBe(true);
    expect(v.sample).toMatchObject({ n: 30, better: 29, same: 1, worse: 0 });
    expect(v.controls).toMatchObject({ n: 5, pass: 5 });
  });
  it('fails on one page where the re-read is worse', () => {
    const k = keyFile(30, 5);
    const v = gateVerdict(k, rowsFor(k, (u) => (u === 's7' ? 'B' : 'A')));
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/worse/);
  });
  it('fails when the judge misses a planted control, or calls it the same', () => {
    const k = keyFile(30, 5);
    expect(gateVerdict(k, rowsFor(k, (u) => (u === 'c2' ? 'B' : 'A'))).reason).toMatch(/controls 4\/5/);
    expect(gateVerdict(k, rowsFor(k, (u) => (u === 'c2' ? 'same' : 'A'))).pass).toBe(false);
  });
  it('fails while any page is unjudged, and a later verdict for the same uid counts', () => {
    const k = keyFile(30, 5);
    const rows = rowsFor(k, (u) => (u === 's0' ? null : 'A'));
    expect(gateVerdict(k, rows).reason).toMatch(/unjudged/);
    expect(gateVerdict(k, [...rows, { uid: 's0', verdict: { verdict: 'A' } }]).pass).toBe(true);
  });
  it('fails with fewer than 5 controls or too small a frame', () => {
    const k4 = keyFile(30, 4);
    expect(gateVerdict(k4, rowsFor(k4, () => 'A')).pass).toBe(false);
    const tiny = keyFile(6, 5);
    expect(gateVerdict(tiny, rowsFor(tiny, () => 'A')).reason).toMatch(/too few/);
  });
  it('a 20-page frame is judged on all 20', () => {
    const k = keyFile(20, 5, 20);
    expect(gateVerdict(k, rowsFor(k, () => 'A')).pass).toBe(true);
  });
});

describe('gateUsable', () => {
  const k = keyFile(30, 5);
  const v = gateVerdict(k, rowsFor(k, () => 'A'));
  const gate = { schema: GATE_SCHEMA, lane: 'g4-reread-6769', book_id: 'b1', model: 'gemini-4-argon-low', ...v };
  const ctx = { lane: 'g4-reread-6769', bookId: 'b1', model: 'gemini-4-argon-low', readHash: (id: string) => `h${id.slice(1)}` };
  it('accepts the gate made from these reads', () => expect(gateUsable(gate, ctx)).toBeNull());
  it('refuses another lane, book or model', () => {
    expect(gateUsable(gate, { ...ctx, lane: 'other' })).toMatch(/lane/);
    expect(gateUsable(gate, { ...ctx, bookId: 'b2' })).toMatch(/book/);
    expect(gateUsable(gate, { ...ctx, model: 'gemini-3.8-flash-low' })).toMatch(/judged/);
  });
  it('refuses a failed gate', () => expect(gateUsable({ ...gate, pass: false, reason: 'x' }, ctx)).toMatch(/failed/));
  it('refuses when a judged page was re-read after the gate', () => {
    expect(gateUsable(gate, { ...ctx, readHash: (id: string) => (id === 'p4' ? 'changed' : `h${id.slice(1)}`) })).toMatch(/changed/);
  });
  it('records the verdict, the sample and the judge in provenance', () => {
    const p = gateProvenance({ ...gate, at: 'now', judge: { model: 'claude-opus-5-5' }, key_sha256: 'k', verdicts_sha256: 'v' });
    expect(p).toMatchObject({ lane: 'g4-reread-6769', pass: true, sample: { n: 30, worse: 0 }, controls: { n: 5, caught: 5 }, judge: { model: 'claude-opus-5-5' } });
    expect(p.sample.pages).toHaveLength(30);
  });
});

describe('fitted open-edition text is never overwritten', () => {
  it('names Sefaria, Esukhia and CBETA pages, and pages carrying a text_source', () => {
    for (const source of ['sefaria', 'esukhia-derge-tengyur', 'cbeta-xml-p5']) expect(fittedTextReason({ source, data: 'x' })).toMatch(/fitted/);
    expect(fittedTextReason({ source: 'ai', text_source: { name: 'Sefaria', license: 'CC0' } })).toMatch(/fitted/);
    expect(fittedTextReason({ source: 'ai', text_edition: { name: 'CBETA' } })).toMatch(/fitted/);
  });
  it('lets a model read through', () => {
    expect(fittedTextReason({ source: 'batch_api', data: 'x' })).toBeNull();
    expect(fittedTextReason(undefined)).toBeNull();
  });
});

describe('foreign-script guard', () => {
  it('refuses Kannada letters in a Tibetan read (#6560)', () => {
    expect(foreignScriptReason('བཀྲ་ཤིས་བདེ་ལེགས་ ಕನ್ನಡ', { languages: ['Tibetan'] })).toMatch(/Kannada/);
  });
  it('accepts the book script, Latin, digits and marks', () => {
    expect(foreignScriptReason('<page-type>text</page-type>\nבְּרֵאשִׁית בָּרָא 12 fol. 3r', { languages: ['Hebrew'] })).toBeNull();
    expect(foreignScriptReason('Ἐν ἀρχῇ ἦν ὁ λόγος — Lat. In principio', { languages: ['Greek'] })).toBeNull();
  });
  it('accepts a script that is a real share of the stored text, not a stray letter of it', () => {
    const served = 'שלום '.repeat(40) + 'λόγος λόγος';
    expect(expectedScripts({ languages: ['Hebrew'], served }).has('Greek')).toBe(true);
    expect(expectedScripts({ languages: ['Hebrew'], served: 'שלום '.repeat(400) + 'λ' }).has('Greek')).toBe(false);
  });
  it('lets one or two stray letters through', () => {
    expect(foreignScriptReason('שלום עולם ب', { languages: ['Hebrew'] })).toBeNull();
    expect(foreignScriptReason('שלום עולם بسم', { languages: ['Hebrew'] })).toMatch(/Arabic 3/);
  });
});

describe('cli-ocr.mjs apply wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
  it('skips fitted text and foreign script before any write, in every mode', () => {
    const write = src.indexOf('saveRevisionBeforeOverwrite(db, page.id');
    expect(src.indexOf('fittedTextReason(page.ocr)')).toBeGreaterThan(0);
    expect(src.indexOf('fittedTextReason(page.ocr)')).toBeLessThan(write);
    expect(src.indexOf('foreignScriptReason(text')).toBeLessThan(write);
  });
  it('lifts the 40% floor only under a lane gate, and keeps the other guards', () => {
    expect(src).toMatch(/page\.ocr\?\.data && !LANE_GATE\)/);
    for (const g of ['human-edited page', 'OCR was rewritten after this read', 'repetition loop', 'refusal or summary', 'over 25k chars', 'reply wrapper']) expect(src).toContain(g);
  });
  it('checks the gate before the page loop and stamps it into provenance', () => {
    expect(src.indexOf('gateUsable(LANE_GATE')).toBeLessThan(src.indexOf('for (const m of metas.sort('));
    expect(src).toContain('lane_gate: gateProvenance(LANE_GATE)');
  });
  it('sha256 is hex', () => expect(sha256('a')).toMatch(/^[0-9a-f]{64}$/));
});
