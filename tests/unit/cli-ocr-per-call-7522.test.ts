import { describe, it, expect } from 'vitest';
import { splitPageBlocks, ocrBlockInstruction, pageBlockFile } from '../../scripts/lib/agy-cli.mjs';

// #7522: cli-ocr.mjs read --per-call=N sends N page images in one agy call. A reply is attributed to pages ONLY by its
// <<<PAGE n BEGIN>>> / <<<PAGE n END>>> markers, so anything but exactly pages 1..n in order, with nothing outside them,
// refuses the whole call (its pages are then read one per call) rather than putting one page's text on another.
describe('splitPageBlocks', () => {
  const page = (n: number, body = `<page-type>text</page-type>\ntext of ${n}`) => `<<<PAGE ${n} BEGIN>>>\n${body}\n<<<PAGE ${n} END>>>`;
  const reply = (ns: number[]) => ns.map((n) => page(n)).join('\n\n');

  it('splits a well-formed reply in page order', () => {
    expect(splitPageBlocks(reply([1, 2, 3]), 3)).toEqual([1, 2, 3].map((n) => `<page-type>text</page-type>\ntext of ${n}`));
  });

  it('accepts surrounding whitespace and loose spacing inside a marker', () => {
    expect(splitPageBlocks(`\n  <<< PAGE 1 BEGIN >>>\na\n<<<PAGE 1 END>>>\n\n${page(2, 'b')}\n`, 2)).toEqual(['a', 'b']);
  });

  it.each([
    ['a dropped page', [1, 3], 3],
    ['one page short', [1, 2], 3],
    ['a repeated page', [1, 1, 2], 3],
    ['reordered pages', [2, 1], 2],
    ['an extra page', [1, 2, 3], 2],
    ['pages numbered from 0', [0, 1], 2],
  ])('refuses %s', (_label, ns, n) => {
    expect(splitPageBlocks(reply(ns as number[]), n as number)).toBeNull();
  });

  it('refuses text before, between or after the page blocks', () => {
    expect(splitPageBlocks(`Here are the pages.\n${reply([1, 2])}`, 2)).toBeNull();
    expect(splitPageBlocks(`${page(1)}\nand now page two:\n${page(2)}`, 2)).toBeNull();
    expect(splitPageBlocks(`${reply([1, 2])}\nLet me know if you need more.`, 2)).toBeNull();
  });

  it('refuses a page whose END never came, an END before its BEGIN, and an empty page', () => {
    expect(splitPageBlocks(`${page(1)}\n<<<PAGE 2 BEGIN>>>\ncut off here`, 2)).toBeNull();
    expect(splitPageBlocks(`<<<PAGE 1 END>>>\na\n<<<PAGE 1 BEGIN>>>`, 1)).toBeNull();
    expect(splitPageBlocks(`${page(1)}\n<<<PAGE 2 BEGIN>>>\n  \n<<<PAGE 2 END>>>`, 2)).toBeNull();
  });

  it('refuses a page block that holds the one-page markers too', () => {
    expect(splitPageBlocks(page(1, '<<<BEGIN>>>\nx\n<<<END>>>'), 1)).toBeNull();
  });

  it('refuses an empty reply and a nonsense page count', () => {
    expect(splitPageBlocks('', 2)).toBeNull();
    expect(splitPageBlocks(reply([1]), 0)).toBeNull();
  });
});

describe('ocrBlockInstruction', () => {
  it('attaches every image under its neutral name and names every page marker', () => {
    const t = ocrBlockInstruction(3);
    for (let i = 0; i < 3; i++) expect(t).toContain(`@./${pageBlockFile(i)}`);
    expect(pageBlockFile(0)).toBe('p01.jpg');
    expect(t).toContain('<<<PAGE 1 BEGIN>>>');
    expect(t).toContain('up to page 3');
    expect(t).not.toContain('p04.jpg');
  });
});
