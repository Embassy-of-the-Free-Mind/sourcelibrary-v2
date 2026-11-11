import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { liveOcrPrompt, fileOcrPrompt, AUTO_DETECT_LANGUAGE_INSTRUCTION } from '../../scripts/lib/live-ocr-prompt.mjs';
import { promptContentHash } from '../../src/lib/prompts';

// #8567: cli-ocr.mjs read --prompt-file=F sends a candidate OCR prompt in place of the live default. The read must be
// cited the way a live read is: the same slot filling, and a hash a `prompts` row holding the same text would carry.
const TEMPLATE = 'Transcribe the page.\n\n{language_instruction}\n\n<margin type="printed">X</margin>{language}\n';
const fakeDb = (content: string) => ({ collection: () => ({ findOne: async () => ({ _id: { toString: () => 'abc' }, name: 'Standard OCR', version: 19.1, content, content_hash: promptContentHash(content) }) }) });

describe('fileOcrPrompt', () => {
  it('fills the slot exactly as the live prompt does', async () => {
    const live = await liveOcrPrompt(fakeDb(TEMPLATE));
    const file = fileOcrPrompt(TEMPLATE, '/tmp/x/candidate.txt');
    expect(file.base).toBe(live.base);
    expect(file.base).toContain(AUTO_DETECT_LANGUAGE_INSTRUCTION);
  });

  it("hashes the raw template as a prompts row's content_hash", async () => {
    const live = await liveOcrPrompt(fakeDb(TEMPLATE));
    const { ref } = fileOcrPrompt(TEMPLATE, '/tmp/x/candidate.txt');
    expect(ref.hash).toBe(promptContentHash(TEMPLATE));
    expect(ref.hash).toBe(live.ref.hash);
  });

  it('names the file and claims no prompt row', () => {
    const { ref } = fileOcrPrompt(TEMPLATE, '/tmp/x/candidate.txt');
    expect(ref).toMatchObject({ id: null, file: 'candidate.txt', name: 'prompt file candidate.txt' });
    expect(ref.version).toBe(`file:${promptContentHash(TEMPLATE).slice(0, 12)}`);
  });

  it('refuses an empty file and a file that is not an OCR template', () => {
    expect(() => fileOcrPrompt('  \n', 'empty.txt')).toThrow(/empty/);
    expect(() => fileOcrPrompt('Translate this.', 'tr.txt')).toThrow(/language_instruction/);
  });
});

describe('cli-ocr.mjs read --prompt-file refusals', () => {
  const script = path.resolve(__dirname, '../../scripts/batch/cli-ocr.mjs');
  const run = (...args: string[]) => spawnSync(process.execPath, [script, 'read', '--out=/tmp/never-8567', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });

  it('refuses --prompt-file with --correct-prompt', () => {
    const r = run('--prompt-file=a.txt', '--correct-prompt=b.txt', '--lane=x');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--prompt-file/);
  });

  it('refuses --prompt-file with --instruction-file', () => {
    const r = run('--prompt-file=a.txt', '--instruction-file=b.txt');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--prompt-file and --instruction-file/);
  });
});
