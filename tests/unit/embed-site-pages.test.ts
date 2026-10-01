import { describe, it, expect } from 'vitest';
import { extractMainText, chunkText } from '../../scripts/workers/embed-site-pages.mjs';

// #1180: the site indexer embeds what a reader sees in <main> — never the
// navigation, the RSC payload in <script>, or the footer.
describe('extractMainText', () => {
  const html = `<html><head><title>How We Measure OCR Quality - Research Notes</title></head><body>
    <header><nav>Browse Collections Search</nav></header>
    <main class="x"><h1>How We Measure OCR Quality</h1>
      <p>Every engine decision is made on a sealed sample &amp; scored.</p>
      <svg><text>chart label</text></svg>
      <script>self.__next_f.push([1,"payload"])</script>
      <p>Second&nbsp;paragraph &#8212; with entities.</p>
    </main>
    <footer>Source Library is a project of the EFM</footer></body></html>`;

  it('keeps main text, drops nav/script/svg/footer, decodes entities', () => {
    const { title, text } = extractMainText(html);
    expect(title).toBe('How We Measure OCR Quality');
    expect(text).toContain('sealed sample & scored.');
    expect(text).toContain('Second paragraph — with entities.');
    expect(text).not.toMatch(/Browse Collections|__next_f|chart label|project of the EFM/);
  });

  it('strips stacked site suffixes from the title', () => {
    const stacked = '<title>How We Measure OCR Quality - Research Notes | Source Library</title><main><p>x</p></main>';
    expect(extractMainText(stacked).title).toBe('How We Measure OCR Quality');
  });

  it('separates block elements into paragraphs', () => {
    const { text } = extractMainText(html);
    expect(text.split('\n\n')[0]).toBe('How We Measure OCR Quality');
  });
});

describe('chunkText', () => {
  it('packs paragraphs up to the size and never exceeds it', () => {
    const paras = Array.from({ length: 10 }, (_, i) => `p${i} ` + 'x'.repeat(300));
    const chunks = chunkText(paras.join('\n\n'), 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    expect(chunks.join('\n\n')).toBe(paras.join('\n\n'));
  });

  it('hard-cuts a single paragraph longer than the size', () => {
    const chunks = chunkText('y'.repeat(2500), 1000);
    expect(chunks.map(c => c.length)).toEqual([1000, 1000, 500]);
  });
});
