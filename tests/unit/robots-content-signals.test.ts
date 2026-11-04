import { describe, it, expect } from 'vitest';
import { GET } from '@/app/robots.txt/route';

/**
 * Pins the robots.txt route output after the move from the Next metadata
 * convention (src/app/robots.ts) to a custom route emitting Content-Signal
 * directives (contentsignals.org). Guards:
 *  - the CC0 policy preamble + EU Art. 4 reservation stay present
 *  - every UA group carries the search=yes, ai-input=yes, ai-train=no signal
 *  - the search-vs-training crawler split from the old robots.ts is unchanged
 */
describe('robots.txt content signals', () => {
  const body = () => (GET() as Response).text();

  it('serves the CC0 Content Signals Policy preamble with the Art. 4 reservation', async () => {
    const text = await body();
    expect(text).toContain('# As a condition of accessing this website');
    expect(text).toContain('ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790');
    expect(text).toContain('https://sourcelibrary.org/licensing');
  });

  it('names the Embassy collection terms in a block of its own, after the preamble', async () => {
    const blocks = (await body()).split('\n\n');
    const note = blocks.findIndex(b => b.includes('https://sourcelibrary.org/terms#embassy-collection'));
    expect(note).toBeGreaterThan(0);
    expect(blocks[0]).toContain('# As a condition of accessing this website');
    expect(blocks[0]).not.toContain('Embassy');
  });

  it('declares search=yes, ai-input=yes, ai-train=no on every group', async () => {
    const text = await body();
    const groups = text.split(/\n\n/).filter((b) => b.startsWith('User-agent:'));
    expect(groups.length).toBeGreaterThanOrEqual(19);
    for (const g of groups) {
      expect(g).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=no');
    }
  });

  it('keeps the search/training crawler split', async () => {
    const text = await body();
    // Search crawlers stay open on content
    expect(text).toMatch(/User-agent: Claude-SearchBot\nContent-Signal: [^\n]+\nAllow: \/\n/);
    expect(text).toMatch(/User-agent: OAI-SearchBot\nContent-Signal: [^\n]+\nAllow: \/\n/);
    // Training crawlers stay reserved (docs/API only, content disallowed) —
    // but every one of them can read the licensing terms.
    for (const ua of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'PerplexityBot', 'Bytespider']) {
      const group = text.split(/\n\n/).find((b) => b.startsWith(`User-agent: ${ua}\n`));
      expect(group, ua).toBeTruthy();
      expect(group).toContain('Disallow: /');
      expect(group).toContain('Allow: /licensing');
      expect(group).toContain('Allow: /llms.txt');
    }
    expect(text).toContain('Sitemap: https://sourcelibrary.org/sitemap.xml');
  });

  it('keeps the crawl-budget disallows for the default group', async () => {
    const text = await body();
    const star = text.split(/\n\n/).find((b) => b.startsWith('User-agent: *\n'))!;
    for (const path of ['/encyclopedia/', '/api/', '/admin/', '/book/*/page-number/']) {
      expect(star).toContain(`Disallow: ${path}`);
    }
  });

  it('keeps Sogou on book landing pages, off the noindex reader pages', async () => {
    const text = await body();
    const sogou = text.split(/\n\n/).find((b) => b.startsWith('User-agent: Sogou web spider\n'))!;
    expect(sogou).toBeTruthy();
    expect(sogou).toMatch(/^Disallow: \/book\/\*\/page\/$/m);
    expect(sogou).toMatch(/^Disallow: \/api\/$/m);
    expect(sogou).not.toMatch(/^Disallow: \/book\/$/m);
  });

  // /llms.txt tells a person's assistant to search and quote through these
  // routes. If a group disallows them, an assistant that obeys robots.txt
  // cannot do what the page it just read told it to do (#8161).
  it('lets assistants fetching for a person search and quote, but not take whole books', async () => {
    const text = await body();
    for (const ua of ['Claude-User', 'ChatGPT-User', 'Perplexity-User']) {
      const group = text.split(/\n\n/).find((b) => b.startsWith(`User-agent: ${ua}\n`));
      expect(group, ua).toBeTruthy();
      for (const path of ['/api/search', '/api/books/*/quote', '/api/books/*/search']) {
        expect(group).toContain(`Allow: ${path}\n`);
      }
      expect(group).toMatch(/^Disallow: \/api\/$/m);
      expect(group).toMatch(/^Disallow: \/admin\/$/m);
      expect(group).not.toMatch(/^Allow: \/api\/books\/$/m);
      expect(group).not.toMatch(/^Allow: .*\/text$/m);
    }
    // The default group does not get the same door: unnamed crawlers stay off the API.
    const star = text.split(/\n\n/).find((b) => b.startsWith('User-agent: *\n'))!;
    expect(star).not.toContain('Allow: /api/');
  });

  // The tripwire (#5995) is only evidence if EVERY crawler was told to stay
  // out: a group that may fetch it turns a polite crawler into a "scraper".
  it('disallows the tripwire for every user-agent group', async () => {
    const { TRIPWIRE_PATH } = await import('@/lib/tripwire');
    const text = await body();
    const groups = text.split(/\n\n/).filter((b) => b.startsWith('User-agent:'));
    for (const g of groups) {
      const allows = [...g.matchAll(/^Allow: (.+)$/gm)].map((m) => m[1]);
      const explicit = g.includes(`Disallow: ${TRIPWIRE_PATH}\n`) || g.endsWith(`Disallow: ${TRIPWIRE_PATH}`);
      const blanket = /^Disallow: \/$/m.test(g) && !allows.some((a) => a !== '/' && TRIPWIRE_PATH.startsWith(a));
      expect(explicit || blanket, g.split('\n')[0]).toBe(true);
    }
  });
});
