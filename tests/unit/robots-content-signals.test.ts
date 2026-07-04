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
});
