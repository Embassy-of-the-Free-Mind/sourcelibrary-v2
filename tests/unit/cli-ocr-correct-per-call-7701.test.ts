import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { correctBlockPrompt, CORRECT_ONE_PAGE_MARK, splitPageBlocks, pageBlockFile } from '../../scripts/lib/agy-cli.mjs';

// #7701 arm C: `cli-ocr.mjs read --correct-prompt --per-call=N` corrects N consecutive drafted pages in one agy call.
// The block prompt keeps the one-page template's format part byte for byte, carries every page's draft under its own
// number, and asks for each page's answer between the #7522 page markers, so the reply is attributed to pages only by
// those markers and `apply` runs the correct-mode guards on each page as if it had been read alone.
const FORMAT = 'Transcribe this historical page to Markdown.\n\n**Format:** ... <page-type>X</page-type> (REQUIRED)\n\n';
const TEMPLATE = `${FORMAT}${CORRECT_ONE_PAGE_MARK} The image, attached at the end of this message, is a page of one book.\n- \`UNCHANGED\` ...\nWrite your one answer between two marker lines, <<<BEGIN>>> and <<<END>>>.\n\nDRAFT START\n{draft}\nDRAFT END\n\nThe page image:`;

describe('correctBlockPrompt', () => {
  const drafts = ['<page-type>text</page-type>\nprima pagina', '<page-type>text</page-type>\nsecunda', '<page-type>index</page-type>\ntertia'];
  const p = correctBlockPrompt(TEMPLATE, drafts)!;

  it('keeps the template before its one-page correction paragraph byte for byte, and drops the rest', () => {
    expect(p.startsWith(FORMAT)).toBe(true);
    expect(p).not.toContain(CORRECT_ONE_PAGE_MARK);
    expect(p).not.toContain('{draft}');
    expect(p).not.toContain('<<<BEGIN>>>');
    expect(p).not.toMatch(/^DRAFT START$/m);
  });

  it('carries each draft once, in page order, under its own number', () => {
    drafts.forEach((d, i) => {
      expect(p).toContain(`DRAFT ${i + 1} START\n${d}\nDRAFT ${i + 1} END`);
      expect(p.split(d).length).toBe(2);
    });
    expect(p.indexOf('DRAFT 1 START')).toBeLessThan(p.indexOf('DRAFT 2 START'));
    expect(p.indexOf('DRAFT 2 START')).toBeLessThan(p.indexOf('DRAFT 3 START'));
  });

  it('names every page marker and attaches every image under its neutral name, after the drafts', () => {
    for (let i = 1; i <= 3; i++) expect(p).toContain(`<<<PAGE ${i} BEGIN>>> and <<<PAGE ${i} END>>> around page ${i}`);
    for (let i = 0; i < 3; i++) expect(p).toContain(`page ${i + 1}: @./${pageBlockFile(i)}`);
    expect(p.lastIndexOf('DRAFT 3 END')).toBeLessThan(p.indexOf(`@./${pageBlockFile(0)}`));
    // the three answers are asked per page
    expect(p).toContain('`UNCHANGED`');
    expect(p).toContain('`CONTAIN: <one sentence>`');
    expect(p).toMatch(/for each page separately/);
  });

  it('refuses a template it cannot rebuild and a block of one page', () => {
    expect(correctBlockPrompt('Transcribe.\n\nDRAFT START\n{draft}\nDRAFT END', drafts)).toBeNull();
    expect(correctBlockPrompt(TEMPLATE.replace('{draft}', 'x'), drafts)).toBeNull();
    expect(correctBlockPrompt(TEMPLATE, [drafts[0]])).toBeNull();
  });

  it('a reply mixing the three answers splits by the markers alone', () => {
    const reply = '<<<PAGE 1 BEGIN>>>\nUNCHANGED\n<<<PAGE 1 END>>>\n<<<PAGE 2 BEGIN>>>\nCONTAIN: this is the facing page.\n<<<PAGE 2 END>>>\n<<<PAGE 3 BEGIN>>>\n<page-type>index</page-type>\ntertia correcta\n<<<PAGE 3 END>>>';
    expect(splitPageBlocks(reply, 3)).toEqual(['UNCHANGED', 'CONTAIN: this is the facing page.', '<page-type>index</page-type>\ntertia correcta']);
    // a one-page answer marker in a block reply refuses the whole call
    expect(splitPageBlocks(reply.replace('UNCHANGED', '<<<BEGIN>>>UNCHANGED<<<END>>>'), 3)).toBeNull();
  });
});

describe('cli-ocr.mjs read --correct-prompt --per-call', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');

  it('no longer refuses --per-call with --correct-prompt, only a template it cannot rebuild', () => {
    expect(src).not.toContain('--correct-prompt carries one draft per call');
    expect(src).toMatch(/PER_CALL > 1 && CORRECT_PROMPT && !correctBlockPrompt\(/);
  });

  it('writes each block page a correct-mode meta pointing at the whole prompt sent, so apply guards it as a correction', () => {
    const block = src.slice(src.indexOf('const readBlock = async'), src.indexOf('const readGroup = async'));
    expect(block).toMatch(/\.\.\.\(CORRECT_PROMPT && \{ mode: 'correct', lane: LANE, draft: draftMeta\(p\) \}\)/);
    expect(block).toContain('prompt_sent_file: promptFile');
    expect(block).toContain('const sent = blockPrompt(n, group)');
    // the one-page read records the draft the same way
    expect(src).toMatch(/prompt_sent_file: `\$\{key\}\.prompt\.txt`, draft: draftMeta\(p\)/);
  });

  it('keys a block correction apart from a one-page correction and from a plain block read', () => {
    const v = src.match(/const variantOf = [^\n]+/)![0];
    expect(v).toContain('`correct:${lane}${callPages > 1 ? `:per_call=${callPages}` : \'\'}`');
  });
});
