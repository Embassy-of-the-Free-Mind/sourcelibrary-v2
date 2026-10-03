/**
 * translation-vs-reference (#5695) scores served English against published translations, some of them in copyright
 * (#5488: store scores and ≤ 15-word quotes only). Judges quote the reference in their reasons and the gallery shows
 * it, so clipPrivate is the guard between a private reference and this public repo. These tests pin that a long run
 * of reference words is cut to 15, that a short quote survives untouched, and that the packet builder refuses to
 * write a private reference inside a git tree.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clipPrivate, validateRecord, PRIVATE_QUOTE_WORDS,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/translation-vs-reference/common.mjs';

const REF = 'In the beginning was the Word, and the Word was with God, and the Word was God. The same was in the beginning with God. All things were made by him.';

describe('clipPrivate', () => {
  it('cuts a run of more than 15 reference words to 15', () => {
    const out = clipPrivate(`The judge wrote: ${REF} End.`, REF);
    const kept = out.replace(/^The judge wrote: /, '').split(' […]')[0].split(/\s+/);
    expect(kept.length).toBe(PRIVATE_QUOTE_WORDS);
    expect(out).toContain('[…]');
    expect(out).not.toContain('All things were made');
  });
  it('leaves a short quote and non-reference text unchanged', () => {
    const s = 'T2 says "the Word was with God" where the source has the opposite.';
    expect(clipPrivate(s, REF)).toBe(s);
  });
  it('matches across case, punctuation and diacritics', () => {
    const out = clipPrivate(REF.toUpperCase().replace(/,/g, ''), REF.normalize('NFD'));
    expect(out.split(/\s+/).filter((w: string) => w !== '[…]').length).toBe(PRIVATE_QUOTE_WORDS);
  });
});

describe('validateRecord', () => {
  const ok = { track: 'T1', lang: 'Latin', book_id: 'b', page_number: 1, source_text: 's', reference_text: 'r',
    reference_meta: { title: 't', translator: 'x', licence: 'public domain', private: false, style: 'early-modern' }, candidates: [{ arm: 'served', text: 'e' }] };
  it('accepts a complete record', () => { expect(validateRecord(ok)).toEqual([]); });
  it('requires a licence and a style', () => {
    expect(() => validateRecord({ ...ok, reference_meta: { ...ok.reference_meta, licence: '' } })).toThrow(/licence/);
    expect(() => validateRecord({ ...ok, reference_meta: { ...ok.reference_meta, style: 'modern' } })).toThrow(/style/);
  });
});

describe('build-packet with a private reference', () => {
  it('refuses to write the packet inside a git tree', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlref-'));
    const rec = (i: number) => JSON.stringify({ track: 'T1', lang: 'Latin', book_id: `b${i}`, page_number: i, source_text: 'Lorem ipsum dolor sit amet.', reference_text: REF,
      reference_meta: { title: 't', translator: 'x', licence: 'in-copyright', private: true, style: 'literal' },
      candidates: [{ arm: 'served', text: 'He is not here. There are three of them, and they are faithful to the end of the matter, and five more besides, which is enough for the test of a planted change in the English text of this page.' }] });
    const input = path.join(tmp, 'in.jsonl');
    fs.writeFileSync(input, [1, 2, 3, 4].map(rec).join('\n') + '\n');
    const insideRepo = path.join(process.cwd(), 'scripts/eval/results/.xlref-private-test');
    let err = '';
    try { execFileSync('node', ['scripts/eval/translation-vs-reference/build-packet.mjs', '--input', input, '--out', insideRepo, '--controls-per-type', '1'], { stdio: 'pipe' }); }
    catch (e: unknown) { err = String((e as { stderr?: Buffer }).stderr || ''); }
    expect(err).toMatch(/refusing/);
    expect(fs.existsSync(insideRepo)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
