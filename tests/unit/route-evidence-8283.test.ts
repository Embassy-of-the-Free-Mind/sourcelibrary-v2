/** #8283: what reaches the router's one rule, and what is kept out of it. Pure functions of scripts/eval/route-evidence.mjs. */
import { describe, it, expect } from 'vitest';
import { judgedHash, routerKey, excludedBecause, evidenceRow, qaVerdicts, methodsWithoutSeverity, routerIndex } from '../../scripts/eval/route-evidence.mjs';

const rules = {
  inputs: { pilot: 'pilot.json' },
  cells: [
    { id: 'latin-blank', routes: [{ id: 'agy-flash-low@4-written' }] },
    { id: 'zh-siku-tr', routes: [{ id: 'agy-flash-low@1' }, { id: 'stored', evidence: [{ score: 's.json', cell: 'siku', route: 'old' }] }] },
    { id: 'german-lite', routes: [{ id: 'lite>opus' }] },
  ],
  route_evidence: {
    cell_aliases: { 'de-lite': 'german-lite', 'la-blank': 'latin-blank' },
    aliases: { 'lite>opus-correct': 'lite>opus' },
    qa_lanes: { 'zh-retranslate-8169|Chinese': { cell: 'zh-siku-tr', route: 'agy-flash-low@1' } },
  },
};
const I = routerIndex(rules);
const item = (o = {}) => ({ kind: 'item', cell: 'zh-siku-tr', route: 'agy-flash-low@1', page_id: 'p', book_id: 'b', text_hash: 'abc', verdict: { accept: true, defects: [] }, ...o });

describe('judgedHash: only what commits to the text judged', () => {
  it('the store hash, a write stamp, and a judge id that hashes the text', () => {
    expect(judgedHash(item())).toEqual({ hash: 'abc', by: 'text_hash' });
    expect(judgedHash(item({ text_hash: null, write: { text_sha: 'w' } }))).toEqual({ hash: 'w', by: 'write' });
    expect(judgedHash(item({ text_hash: null, test: { verdict_id: 'j0123456789' } }))?.by).toBe('verdict_id');
    expect(judgedHash(item({ text_hash: null, test: { verdict_id: 'p1:0123456789abcdef#2' } }))?.hash).toBe('0123456789abcdef');
  });
  it('a verdict id that does not hash the text is no tie', () => {
    expect(judgedHash(item({ text_hash: null, test: { verdict_id: 'book_check_1:12' } }))).toBeNull();
    expect(excludedBecause(item({ text_hash: null }), I)).toBe('no text hash');
  });
});

describe('routerKey', () => {
  it('the row\'s own cell, then the old test labels', () => {
    expect(routerKey(item(), I)).toMatchObject({ cell: 'zh-siku-tr', route: 'agy-flash-low@1' });
    expect(routerKey(item({ cell: 'de-lite/print', route: 'lite>opus-correct' }), I)).toMatchObject({ cell: 'german-lite', route: 'lite>opus' });
  });
  it('a first-read arm counts as what the lane wrote', () => {
    expect(routerKey(item({ cell: 'la-blank', route: 'agy-flash-low@4' }), I)).toMatchObject({ cell: 'latin-blank', route: 'agy-flash-low@4-written' });
  });
  it('a QA draw goes where rules.json says its lane writes, and only for that language', () => {
    expect(routerKey(item({ cell: 'qa:zh-retranslate-8169', route: 'zh-retranslate-8169', lang: 'Chinese' }), I)).toMatchObject({ cell: 'zh-siku-tr', route: 'agy-flash-low@1' });
    expect(routerKey(item({ cell: 'qa:zh-retranslate-8169', route: 'zh-retranslate-8169', lang: 'Korean' }), I)).toBeNull();
  });
  it('a route rules.json does not list has no cell', () => {
    expect(excludedBecause(item({ route: 'paddle>sonnet' }), I)).toBe('no router cell');
  });
});

describe('excludedBecause', () => {
  it('counts a random judged item on the route judge scale, and nothing else', () => {
    expect(excludedBecause(item(), I)).toBeNull();
    expect(excludedBecause(item({ kind: 'wrong_page' }), I)).toBe('not an item');
    expect(excludedBecause(item({ verdict: { misleading: true } }), I)).toBe('not the route judge scale');
    expect(excludedBecause(item({ origin: 'test', selection: 'hand-picked' }), I)).toBe('not a random draw');
    expect(excludedBecause(item({ test: { rep: 1 } }), I)).toBe('a repeat');
    expect(excludedBecause(item({ draw: { stratum: 'flagged' } }), I)).toBe('flagged stratum');
    expect(excludedBecause(item({ verdict: { accept: false, defects: [{ class: 'O6' }] } }), I)).toBe('a defect with no severity');
  });
});

describe('evidenceRow', () => {
  it('counts severities and classes, and files the row by script type', () => {
    const r = item({ verdict: { accept: false, fidelity: 3, defects: [{ severity: 'wrong_text', class: 'O6 misread' }, { severity: 'misleads', class: 'O6' }, { severity: 'wrong_text', class: 'O1' }, { severity: 'cosmetic', class: 'O8' }] } });
    const e = evidenceRow(r, I, { words: 250, words_src: 'candidate', script: 'print' });
    expect(e).toMatchObject({ cell: 'zh-siku-tr/print', base: 'zh-siku-tr', route: 'agy-flash-low@1', n_wrong_text: 2, n_misleads: 1, n_cosmetic: 1, words: 250, text_hash: 'abc', hash_by: 'text_hash' });
    expect(e.classes).toEqual({ 'O6:wrong_text': 1, 'O6:misleads': 1, 'O1:wrong_text': 1, 'O8:cosmetic': 1 });
  });
});

describe('QA verdicts', () => {
  const check = (notes, frame = {}) => ({
    _id: 'k1', book_id: 'b', method_id: 'm', method_version: 1, run_id: 'r', evidence_path: 'e', checked_at: 't', frame: { lane: 'zh-retranslate-8169', selection: 'random', stages: ['translation'], ...frame },
    page_notes: notes, text_provenance: notes.map((n) => ({ page_number: n.page_number, page_id: `p${n.page_number}`, hash_of: 'judged text', translation_hash: `h${n.page_number}`, ocr_hash: `o${n.page_number}` })),
  });
  it('a method that stores no defects on a page it calls serious has no severities, clean pages included', () => {
    const k = { ...check([{ page_number: 1, outcome: 'serious', verdict: 'invented', defects: [] }, { page_number: 2, outcome: 'clean', verdict: 'fine', defects: [] }]), method_id: 'lane-spot-check' };
    const ok = { ...check([{ page_number: 1, outcome: 'serious', verdict: 'not accepted', defects: [{ severity: 'wrong_text' }] }, { page_number: 2, outcome: 'clean', verdict: 'clean', defects: [] }]), method_id: 'paired' };
    expect([...methodsWithoutSeverity([k, ok])]).toEqual(['lane-spot-check']);
  });
  it('carries the severity, the hash of the stage judged, and the accept', () => {
    const [v] = qaVerdicts(check([{ page_number: 1, outcome: 'serious', verdict: 'not accepted', defects: [{ severity: 'wrong_text', class: 'O6' }] }]), 'Chinese');
    expect(v).toMatchObject({ page_id: 'p1', text_hash: 'h1', task: 'translation', lang: 'Chinese', selection: 'random', cell: 'qa:zh-retranslate-8169', route: 'zh-retranslate-8169' });
    expect(v.verdict.accept).toBe(false);
    expect(v.outcome.wrong_text).toBe(true);
  });
  it('drops a page with no hash of the judged text, a defect with no severity, and verdicts that came from the store', () => {
    const notes = [{ page_number: 1, outcome: 'minor', verdict: 'minor', defects: [{ severity: 'cosmetic' }] }];
    const k = check(notes);
    expect(qaVerdicts({ ...k, text_provenance: [{ ...k.text_provenance[0], translation_hash: null }] })).toHaveLength(0);
    expect(qaVerdicts({ ...k, text_provenance: [{ ...k.text_provenance[0], hash_of: 'page now' }] })).toHaveLength(0);
    expect(qaVerdicts(check([{ ...notes[0], defects: [{ severity: 'bad' }] }]))).toHaveLength(0);
    expect(qaVerdicts({ ...k, method_id: 'judged-pages' })).toHaveLength(0);
  });
});
