import { describe, it, expect } from 'vitest';
import { buildFlowText, flowHtmlToText, pageToText } from '@/lib/export-flow-text';

/**
 * The plain-text download (#7118): the continuous reading text with no markup left in it. It used to print each
 * page's stored text — `**`, `####`, pipe tables, `<note>` tags — between rules.
 */
const db = {
  collection: () => ({
    find: () => ({ toArray: async () => [{ page_number: 2, description: 'A woodcut of a furnace & bellows.' }] }),
    countDocuments: async () => 1,
  }),
};

describe('pageToText', () => {
  it('leaves no markdown or tags, and puts each note after the paragraph that calls it', () => {
    const out = pageToText('## On Venus\n\nThe **star** of the morning<note>original: "Lucifer"</note> rises.\n\nNext paragraph.', { n: 0 });
    expect(out).not.toMatch(/[*#<>]/);
    expect(out).not.toContain('Notes');
    expect(out).toContain('On Venus\n========');
    expect(out).toContain('The star of the morning[1] rises.\n    [1] original: "Lucifer"\n\nNext paragraph.');
  });

  it('keeps a page\'s own printed "[1]" apart from a footnote call', () => {
    expect(pageToText('As shown above [1].', { n: 0 })).toBe('As shown above [1].');
  });

  it('turns a table into rows of cells and a list into bullets', () => {
    expect(pageToText('| Sign | Planet |\n|---|---|\n| Aries | Mars |', { n: 0 })).toBe('Sign | Planet\nAries | Mars');
    expect(flowHtmlToText('<ul><li>one</li><li>two &amp; three</li></ul>')).toBe('• one\n• two & three');
  });
});

describe('buildFlowText', () => {
  it('runs the pages together with a citable page mark, and marks each picture where it stands', async () => {
    const pages = [1, 2].map(n => ({ id: `p${n}`, page_number: n, translation: { data: n === 1 ? 'The stone was' : 'heated for days.\n\nThen cooled.' } }));
    const flow = await buildFlowText(db as never, { id: 'b' }, pages, { text: 'translation', baseUrl: 'https://x' });
    expect(flow.body).toContain('Pages 1–2\n---------');
    expect(flow.body).toContain('The stone was [p. 2] heated for days.');
    expect(flow.body).toContain('\n\n[Illustration, p. 2: A woodcut of a furnace & bellows. — https://x/book/b?page=2]\n\n');
    expect(flow.imagesTotal).toBe(1);
  });
});
