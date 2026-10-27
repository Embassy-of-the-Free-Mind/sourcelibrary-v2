/**
 * #7558: the read-file-7558 OCR prompt variant. `@./file` attaches nothing in `agy -p`, so the model sees a page only
 * through its own read_file turn; the variant names the files and the one working tool up front so no turn is spent on
 * a denied shell. The default (sentinels-6523) must stay byte-identical: kept reads and apply's prompt hash rebuild
 * depend on it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ocrBlockInstruction, OCR_READ_FILE_INSTRUCTION } from '../../scripts/lib/agy-cli.mjs';

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

describe('ocrBlockInstruction', () => {
  it('the default block wrapper is unchanged from #7551', () => {
    // sha of the #7551 text for n = 4 (computed before this PR, from origin/main 816850537).
    expect(ocrBlockInstruction(4)).toBe(ocrBlockInstruction(4, { variant: 'sentinels-6523' }));
    expect(ocrBlockInstruction(4)).toContain('page 1: @./p01.jpg, page 2: @./p02.jpg, page 3: @./p03.jpg, page 4: @./p04.jpg. Transcribe each page separately');
    expect(sha(ocrBlockInstruction(4))).toBe('e3225015b15b4ee3');
  });
  it('read-file-7558 names each file and the one tool, with no @ mention', () => {
    const t = ocrBlockInstruction(3, { variant: 'read-file-7558' });
    expect(t).not.toContain('@./');
    expect(t).toContain('page 1: ./p01.jpg, page 2: ./p02.jpg, page 3: ./p03.jpg');
    expect(t).toContain('Open each with read_file');
    expect(t).toContain('and so on up to page 3.');
  });
});

describe('cli-ocr.mjs prompt variant', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
  it('defaults to sentinels-6523 and accepts read-file-7558', () => {
    expect(src).toContain("const PROMPT_VARIANT = arg('prompt-variant') || 'sentinels-6523'");
    expect(src).toContain("const PROMPT_VARIANTS = ['sentinels-6523', 'read-file-7558']");
  });
  it('the read-file sentence carries the tool instruction and no @ mention', () => {
    const line = src.split('\n').find((l) => l.includes("variant === 'read-file-7558'") && l.includes('imageInstruction'));
    expect(line).toBeTruthy();
    const next = src.split('\n')[src.split('\n').indexOf(line!) + 1];
    expect(next).toContain('${OCR_READ_FILE_INSTRUCTION}');
    expect(next).not.toContain('@./');
    expect(OCR_READ_FILE_INSTRUCTION).toMatch(/read_file/);
  });
});

describe('correctionHeaderProblem (cli-ocr apply, correct mode)', async () => {
  const { correctionHeaderProblem } = await import('../../scripts/lib/write-text-guard.mjs');
  const draft = '<language>German</language>\n<page-type>text</page-type>\nWeil aber die Vernunfft';
  it('a headed draft may gain the <scan-quality> line the template asks for', () => {
    expect(correctionHeaderProblem(draft, `<scan-quality>good</scan-quality>\n${draft}`)).toBe(false);
  });
  it('a doubled header is still refused', () => {
    expect(correctionHeaderProblem(draft, `${draft}\n<page-type>text</page-type>`)).toBe(true);
    expect(correctionHeaderProblem(draft, `<scan-quality>good</scan-quality>\n<scan-quality>good</scan-quality>\n${draft}`)).toBe(true);
  });
  it('an unheaded (Tibetan) draft may gain no header, as before', () => {
    expect(correctionHeaderProblem('བཀྲ་ཤིས་', 'བཀྲ་ཤིས་')).toBe(false);
    expect(correctionHeaderProblem('བཀྲ་ཤིས་', '<page-type>text</page-type>\nབཀྲ་ཤིས་')).toBe(true);
  });
});
