import { describe, it, expect } from 'vitest';
import { cutReplyPages, refusedBlockPlan, splitPageBlocks, GEMINI_CUT_NOTICE } from '../../scripts/lib/agy-cli.mjs';

// #68: a block reply Gemini's output filter cut. The notice below is the text agy prints, copied from a refused reply
// of the first-read lane (gex45, 2026-11-01).
const NOTICE = `${GEMINI_CUT_NOTICE}. They can occasionally trigger by mistake on safe coding, security, or biology-related queries. Please try rephrasing your prompt. You can [send feedback](https://ai.google.dev/gemini-api/docs/troubleshooting#file-bug) or read more about [our policies here](https://policies.google.com/terms/generative-ai/use-policy).`;
const page = (n: number, text = `<page-type>text</page-type>\ntext of ${n}`) => `<<<PAGE ${n} BEGIN>>>\n${text}\n<<<PAGE ${n} END>>>`;
const whole = (ns: number[]) => ns.map((n) => page(n)).join('\n\n');
const text = (n: number) => `<page-type>text</page-type>\ntext of ${n}`;

describe('cutReplyPages', () => {
  it('keeps the whole pages before the page the filter cut', () => {
    const reply = `${whole([1, 2, 3])}\n\n<<<PAGE 4 BEGIN>>>\n<page-type>text</page-type>\nben, und mit weniger ${NOTICE}`;
    expect(splitPageBlocks(reply, 8)).toBeNull();
    expect(cutReplyPages(reply, 8)).toEqual([1, 2, 3].map(text));
  });

  it('keeps nothing when the cut falls inside page 1, and still says the reply was cut', () => {
    expect(cutReplyPages(`<<<PAGE 1 BEGIN>>>\n<page-type>text</page-type>\nschickt; Welchem ${NOTICE}`, 8)).toEqual([]);
    expect(cutReplyPages(NOTICE, 8)).toEqual([]);
  });

  it('keeps every page when the notice follows a complete reply', () => {
    expect(cutReplyPages(`${whole([1, 2])}\n${NOTICE}`, 2)).toEqual([1, 2].map(text));
  });

  it('accepts a cut between two pages', () => {
    expect(cutReplyPages(`${whole([1, 2])}\n\n${NOTICE}`, 4)).toEqual([1, 2].map(text));
  });

  it('is null for a reply that was not cut: a plain mismatch keeps nothing', () => {
    expect(cutReplyPages(`${whole([1, 2])}\n<<<PAGE 3 BEGIN>>>\ncut off here`, 4)).toBeNull();
    expect(cutReplyPages(`${whole([1, 2])}\n\nWould you like a summary of these pages instead?`, 4)).toBeNull();
    expect(cutReplyPages('', 4)).toBeNull();
  });

  it('is null when the notice is quoted inside a page and not the end of the reply', () => {
    const long = 'x'.repeat(700);
    expect(cutReplyPages(`${page(1)}\n<<<PAGE 2 BEGIN>>>\n${NOTICE}\n${long}`, 4)).toBeNull();
  });

  it.each([
    ['text before page 1', `Here are the pages.\n${whole([1, 2])}\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`],
    ['text between two pages', `${page(1)}\nand now page two:\n${page(2)}\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`],
    ['text between the last whole page and the cut page', `${whole([1, 2])}\nnext:\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`],
    ['text after the last whole page with no page begun', `${whole([1, 2])}\nI cannot continue. ${NOTICE}`],
    ['an empty page', `${page(1)}\n<<<PAGE 2 BEGIN>>>\n  \n<<<PAGE 2 END>>>\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`],
    ['a one-page marker inside a page', `${page(1, '<<<BEGIN>>>\nx\n<<<END>>>')}\n<<<PAGE 2 BEGIN>>>\nab ${NOTICE}`],
    ['a renumbered cut page', `${whole([1, 2])}\n<<<PAGE 4 BEGIN>>>\nab ${NOTICE}`],
    ['a repeated page after the whole ones', `${whole([1, 2])}\n${page(2)}\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`],
    ['pages out of order', `${page(2)}\n${page(1)}\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`],
    ['more pages than the call sent', `${whole([1, 2])}\n<<<PAGE 3 BEGIN>>>\nab ${NOTICE}`, 2],
  ])('keeps nothing from a cut reply with %s', (_name, reply, n = 4) => {
    expect(cutReplyPages(reply as string, n as number)).toBeNull();
  });

  it('is for blocks only', () => {
    expect(cutReplyPages(`<<<PAGE 1 BEGIN>>>\nab ${NOTICE}`, 1)).toBeNull();
  });
});

describe('refusedBlockPlan', () => {
  it('a cut inside page 4 of 8: page 4 alone, pages 5-8 as one block of 4', () => {
    expect(refusedBlockPlan(8, 3, { cut: true })).toEqual({ cap: 4, alone: [3], blocks: [[4, 5, 6, 7]] });
  });

  it('a cut inside page 1 of 8: page 1 alone, then 4 and 3', () => {
    expect(refusedBlockPlan(8, 0, { cut: true })).toEqual({ cap: 4, alone: [0], blocks: [[1, 2, 3, 4], [5, 6, 7]] });
  });

  it('a block refused with nothing kept and no cut goes out again in halves', () => {
    expect(refusedBlockPlan(8, 0)).toEqual({ cap: 4, alone: [], blocks: [[0, 1, 2, 3], [4, 5, 6, 7]] });
    expect(refusedBlockPlan(4, 0)).toEqual({ cap: 2, alone: [], blocks: [[0, 1], [2, 3]] });
  });

  it('ends at one page per call', () => {
    expect(refusedBlockPlan(2, 0)).toEqual({ cap: 1, alone: [], blocks: [[0], [1]] });
    expect(refusedBlockPlan(3, 1, { cut: true })).toEqual({ cap: 1, alone: [1], blocks: [[2]] });
  });

  it('never sends a block of the refused size again', () => {
    for (let n = 2; n <= 8; n++) for (let kept = 0; kept < n; kept++) for (const cut of [true, false]) {
      const plan = refusedBlockPlan(n, kept, { cut });
      expect(Math.max(0, ...plan.blocks.map((b) => b.length))).toBeLessThan(n);
      expect([...plan.alone, ...plan.blocks.flat()]).toEqual(Array.from({ length: n - kept }, (_, i) => kept + i));
    }
  });

  it('plans nothing when every page was kept', () => {
    expect(refusedBlockPlan(8, 8, { cut: true })).toEqual({ cap: 4, alone: [], blocks: [] });
  });
});
