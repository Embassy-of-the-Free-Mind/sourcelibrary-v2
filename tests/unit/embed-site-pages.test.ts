import { describe, it, expect } from 'vitest';
import { extractMainText, extractHead, titleFromPath, robotsDisallow, manifestPaths, chunkText } from '../../scripts/workers/embed-site-pages.mjs';
import { navTokens, pathNames, distinctNames, nameTokens } from '../../scripts/lib/site-nav-names.mjs';

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

// #5945: the page list is derived from the route manifest and the sitemap, and
// a page is indexed only when it is public and indexable.
describe('page list sources', () => {
  it('lists static routes and no dynamic, api or private-folder ones', () => {
    const paths = manifestPaths();
    for (const p of ['/about', '/about/faq', '/research/quality', '/review', '/explore/timeline']) expect(paths).toContain(p);
    expect(paths.some((p: string) => p.includes('[') || p.startsWith('/api') || p.includes('('))).toBe(false);
  });

  it('reads the * group of robots.txt, and closes a section named with a trailing slash', () => {
    const disallowed = robotsDisallow(`User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /book/*/qa\nDisallow: /data?admin=true\n`);
    expect(disallowed('/admin/users')).toBe(true);
    expect(disallowed('/admin')).toBe(true);
    expect(disallowed('/book/abc/qa')).toBe(true);
    // Positive control: the GPTBot group's "Disallow: /" must not leak into *.
    expect(disallowed('/about')).toBe(false);
    expect(disallowed('/data')).toBe(false);
  });

  it('reads noindex, the description and the h1 from the head', () => {
    const html = `<head><meta name="robots" content="noindex, nofollow"/><meta name="description" content="Spot AI mistakes &amp; fix them."/></head><main><h1>Help <em>curate</em></h1></main>`;
    expect(extractHead(html)).toEqual({ description: 'Spot AI mistakes & fix them.', noindex: true, h1: 'Help curate' });
    expect(extractHead('<main><p>x</p></main>').noindex).toBe(false);
  });

  it('names a page with no title of its own after its path', () => {
    expect(titleFromPath('/browse/authors')).toBe('Browse Authors');
  });

  it('measures how much of a page is link text', () => {
    const listing = '<main><h1>Latin Texts</h1><a href="/book/a">De occulta philosophia libri tres</a><a href="/book/b">Monas hieroglyphica</a></main>';
    const prose = '<main><p>Every engine decision is made on a sealed sample and scored by hand. <a href="/x">More</a></p></main>';
    expect(extractMainText(listing).linkShare).toBeGreaterThan(0.5);
    expect(extractMainText(prose).linkShare).toBeLessThan(0.2);
  });
});

describe('site-nav-names', () => {
  it('folds case, accents, plurals and in-word marks; keeps every script', () => {
    expect(navTokens('The Libraries')).toEqual(['library']);
    expect(navTokens("Böhme's Works")).toEqual(['bohme', 'work']);
    expect(navTokens('Check pages')).toEqual(['check', 'page']);
    // -us / -ss / -is are not plurals.
    expect(navTokens('Census Paracelsus glass')).toEqual(['census', 'paracelsus', 'glass']);
    // A non-Latin name must not fold to nothing (non-latin-text-operations.md).
    expect(navTokens('張介賓')).toEqual(['張介賓']);
    // й loses its breve like any accent; both sides of the match fold the same way.
    expect(navTokens('Гюйгенс, Христиан')).toEqual(['гюигенс', 'христиан']);
  });

  it('reads names off a path', () => {
    expect(pathNames('/research/page-errors')).toEqual(['page errors', 'research page errors']);
    expect(pathNames('/review')).toEqual(['review']);
  });

  it('keeps one name per token set and drops empty ones', () => {
    expect(distinctNames(['Timeline', 'timeline', '—', 'Timeline — Explore'])).toEqual(['Timeline', 'Timeline — Explore']);
    expect(nameTokens(['Help curate', 'check pages'])).toEqual(['help', 'curate', 'check', 'page']);
  });
});
