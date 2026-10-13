import { describe, it, expect } from 'vitest';
import { splitBlockReply, CALL_SUFFIX } from '../../scripts/batch/claude-translate.mjs';

// #6559: one Opus call translates up to 10 consecutive pages; a reply is attributed to pages ONLY by its
// <translation page="N"> tags, so any reply whose tags are not exactly the pages asked for, in order, is refused whole
// rather than putting one page's English on another (translate-batch-seam's parse falls back by position; this does not).
describe('claude-translate splitBlockReply', () => {
  const reply = (nums: number[]) => nums.map((n) => `<translation page="${n}">English of page ${n}.</translation>`).join('\n\n');

  it('splits a well-formed reply in order', () => {
    const out = splitBlockReply(reply([12, 13, 14]), [12, 13, 14]);
    expect(out && [...out.entries()]).toEqual([[12, 'English of page 12.'], [13, 'English of page 13.'], [14, 'English of page 14.']]);
  });

  it('accepts a reply wrapped in a code fence', () => {
    expect(splitBlockReply('```xml\n' + reply([3, 4]) + '\n```', [3, 4])?.get(4)).toBe('English of page 4.');
  });

  it.each([
    ['a dropped page', [12, 14], [12, 13, 14]],
    ['a merged page (one tag short)', [12, 13], [12, 13, 14]],
    ['a repeated page', [12, 12, 13], [12, 13, 14]],
    ['reordered pages', [13, 12], [12, 13]],
    ['renumbered pages', [1, 2], [12, 13]],
    ['an extra page', [12, 13, 14], [12, 13]],
  ])('refuses %s', (_label, got, asked) => {
    expect(splitBlockReply(reply(got as number[]), asked as number[])).toBeNull();
  });

  it('refuses prose before, between or after the tags', () => {
    expect(splitBlockReply(`Here are the translations.\n${reply([1])}`, [1])).toBeNull();
    expect(splitBlockReply(`${reply([1])}\nNow page two:\n${reply([2])}`, [1, 2])).toBeNull();
    expect(splitBlockReply(`${reply([1])}\nLet me know if you need more.`, [1])).toBeNull();
  });

  it('refuses an empty page', () => {
    expect(splitBlockReply('<translation page="1">  </translation>', [1])).toBeNull();
  });

  it('keeps the summary and keywords a page carries inside its tag', () => {
    const t = '<translation page="5">Text.\n<summary>S.</summary>\n<keywords>k</keywords></translation>';
    expect(splitBlockReply(t, [5])?.get(5)).toBe('Text.\n<summary>S.</summary>\n<keywords>k</keywords>');
  });

  it('the suffix forbids tools and text outside the tags', () => {
    expect(CALL_SUFFIX).toMatch(/Do not use any tool/);
    expect(CALL_SUFFIX).toMatch(/nothing before, between or after/);
  });
});
