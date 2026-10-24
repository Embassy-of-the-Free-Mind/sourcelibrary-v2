import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  matchesRead, reuseHash, translationReuseKey, wantsFresh, reuseInto, promptKey, candidateKey, keepRead, findRead,
  // @ts-expect-error — .mjs lib, no types
} from '../../scripts/lib/candidate-reads.mjs';
// @ts-expect-error — .mjs lib, no types
import { contentHash } from '../../scripts/lib/write-provenance.mjs';

/**
 * A read is paid for once (#7075; Derek, 2026-10-24: "we must not re-spend tokens"). A reader about to make a read
 * gets a kept one back when the page, field, model and reuse key all match; a different prompt, input or model calls
 * the model; a read its own reader marked failed is never handed back; --fresh always calls.
 */
const BOOK = '69dfeb9f090ad7d5c33b0a11';
const PAGE = '69dfebac090ad7d5c33b187a';
const TEXT = '<page-type>body</page-type>\nIn principio erat verbum';
const KEY = reuseHash({ field: 'ocr', prompt: 'p1', input: 'img1', variant: 'v' });
const body = (over: Record<string, unknown> = {}) => ({
  field: 'ocr', text: TEXT, book_id: BOOK, page_id: PAGE, reuse: { hash: KEY, model: 'gemini-3.8-flash-low' }, meta: { exit: 0, error_class: null }, ...over,
});
const ask = { field: 'ocr', model: 'gemini-3.8-flash-low', prompt_hash: KEY };

describe('candidate-reads reuse', () => {
  it('reuses a read with the same reuse key and model', () => {
    expect(matchesRead(body(), ask)).toBe(true);
  });
  it('does not reuse across a different prompt, input, variant or model', () => {
    expect(matchesRead(body(), { ...ask, prompt_hash: reuseHash({ field: 'ocr', prompt: 'p2', input: 'img1', variant: 'v' }) })).toBe(false);
    expect(matchesRead(body(), { ...ask, prompt_hash: reuseHash({ field: 'ocr', prompt: 'p1', input: 'img2', variant: 'v' }) })).toBe(false);
    expect(matchesRead(body(), { ...ask, prompt_hash: reuseHash({ field: 'ocr', prompt: 'p1', input: 'img1', variant: 'w' }) })).toBe(false);
    expect(matchesRead(body(), { ...ask, model: 'gemini-4-argon-low' })).toBe(false);
    expect(matchesRead(body(), { ...ask, field: 'translation' })).toBe(false);
  });
  it('never hands back a failed, wrapped or chatter read', () => {
    expect(matchesRead(body({ meta: { exit: 1 } }), ask)).toBe(false);
    expect(matchesRead(body({ meta: { exit: 0, error_class: 'quota' } }), ask)).toBe(false);
    expect(matchesRead(body({ meta: { exit: 0, wrapper: 'text outside the markers' } }), ask)).toBe(false);
    expect(matchesRead(body({ text: 'I cannot transcribe this image.' }), ask)).toBe(false);
    expect(matchesRead(body({ text: '' }), ask)).toBe(false);
  });
  it('rebuilds the key from the meta of a read the sweep kept (no reuse block), model checked', () => {
    const meta = { cli: 'agy', model: 'gemini-3.8-flash-low', prompt_ref: { content_hash: 'abc' }, ocr_hash: 'ocr1', prompt_variant: 'sentinels-6523', exit: 0 };
    const kept = { field: 'translation', text: 'In the beginning was the Word.', reuse: null, meta };
    const k = translationReuseKey(meta);
    const derive = (m: { cli?: string }) => (m.cli === 'agy' ? translationReuseKey(m) : null);
    expect(matchesRead(kept, { field: 'translation', model: 'gemini-3.8-flash-low', prompt_hash: k, derive })).toBe(true);
    expect(matchesRead(kept, { field: 'translation', model: 'gemini-3.8-flash-low', prompt_hash: translationReuseKey({ ...meta, ocr_hash: 'ocr2' }), derive })).toBe(false);
    expect(matchesRead(kept, { field: 'translation', model: 'opus', prompt_hash: k, derive })).toBe(false);
    expect(matchesRead(kept, { field: 'translation', model: 'gemini-3.8-flash-low', prompt_hash: k })).toBe(false);   // no derive: not matched
  });
  it('--fresh bypasses reuse', () => {
    expect(wantsFresh(['node', 'cli-ocr.mjs', 'read', '--fresh'])).toBe(true);
    expect(wantsFresh(['node', 'cli-ocr.mjs', 'read'])).toBe(false);
  });
  it('keys are book-scoped, prompts included', () => {
    const h = contentHash('x');
    expect(promptKey(BOOK, h)).toBe(`candidate-reads/${BOOK}/_prompts/${h}.txt`);
    expect(() => promptKey(undefined, h)).toThrow();
    expect(candidateKey(BOOK, PAGE, 'ocr', h)).toContain(`/${BOOK}/${PAGE}/ocr/`);
  });
  it('reuseInto writes the read and its meta with reused_from; a named prompt already present is kept', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
    const sent = 'the prompt that was sent';
    fs.mkdirSync(path.join(dir, 'prompts'));
    fs.writeFileSync(path.join(dir, 'prompts', `${contentHash(sent)}.txt`), sent);
    const hit = { key: 'candidate-reads/x.json', text: TEXT, meta: { exit: 0, prompt_sent_file: `prompts/${contentHash(sent)}.txt`, prompt_sent_hash: contentHash(sent) }, body: { book_id: BOOK, job: 'j', read_at: '2026-10-22' } };
    expect(await reuseInto(dir, PAGE, hit)).toBe(true);
    expect(fs.readFileSync(path.join(dir, `${PAGE}.txt`), 'utf8')).toBe(TEXT);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${PAGE}.meta.json`), 'utf8'));
    expect(meta.reused_from).toMatchObject({ key: 'candidate-reads/x.json', job: 'j' });
    expect(await reuseInto(dir, 'other', { ...hit, meta: { ...hit.meta, prompt_sent_file: '../escape.txt' } })).toBe(false);
  });
  it('is off, without throwing, when CANDIDATE_READS=off', async () => {
    process.env.CANDIDATE_READS = 'off';
    try {
      expect((await keepRead({ page_id: PAGE, book_id: BOOK, field: 'ocr', text: TEXT, model: 'm', prompt_hash: KEY })).kept).toBe(false);
      expect(await findRead({ page_id: PAGE, book_id: BOOK, field: 'ocr', model: 'm', prompt_hash: KEY })).toBeNull();
    } finally { delete process.env.CANDIDATE_READS; }
  });
});
