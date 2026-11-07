import { describe, it, expect } from 'vitest';
import { bookAssistantGuide, homeAssistantGuide } from '@/lib/assistant-guide';
import { GET as robots } from '@/app/robots.txt/route';

/**
 * The line names routes, so it is only worth having if an assistant that obeys robots.txt
 * may fetch them. The failure this guards: the guide pointing at a path its own robots
 * group disallows, which is what llms.txt did before #8199.
 */
const urlsIn = (text: string) => [...text.matchAll(/https:\/\/sourcelibrary\.org(\/[^\s?]*)/g)].map((m) => m[1].replace(/\.$/, ''));

async function claudeUserGroup() {
  const groups = (await (robots() as Response).text()).split(/\n\n/);
  return groups.find((g) => g.startsWith('User-agent: Claude-User\n'))!;
}

/** RFC 9309: the longest matching rule wins, and an equal-length tie goes to Allow. */
function mayFetch(group: string, path: string) {
  const matches = (rule: string) => new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`).test(path);
  let best = { len: -1, allow: true };
  for (const line of group.split('\n')) {
    const m = line.match(/^(Allow|Disallow): (.+)$/);
    if (!m || !matches(m[2])) continue;
    const allow = m[1] === 'Allow';
    if (m[2].length > best.len || (m[2].length === best.len && allow)) best = { len: m[2].length, allow };
  }
  return best.allow;
}

describe('assistant guide', () => {
  it('names the search and llms.txt on the homepage', () => {
    expect(homeAssistantGuide()).toContain('https://sourcelibrary.org/search/text?q=YOUR+WORDS');
    expect(homeAssistantGuide()).toContain('https://sourcelibrary.org/llms.txt');
  });

  it('names the full text, a passage search and a quote on a book page', () => {
    const line = bookAssistantGuide({ id: 'b1', slug: 'de-secretis', pages_count: 12 }, 'x')!;
    expect(line).toContain('https://sourcelibrary.org/book/de-secretis/read');
    expect(line).toContain('https://sourcelibrary.org/book/de-secretis/search/text?q=YOUR+WORDS');
    // The short passage page comes before the long document, which fetch tools truncate.
    expect(line.indexOf('/search/text')).toBeLessThan(line.indexOf('/read'));
    expect(line).toContain('check a quotation against the scan');
    expect(line).toContain('https://sourcelibrary.org/api/books/b1/quote?page=N');
  });

  it('falls back to the id when a book has no slug', () => {
    expect(bookAssistantGuide({ pages_count: 3 }, 'abc')).toContain('/book/abc/read');
  });

  it('says nothing about /read for a book with no pages, where it is a 404', () => {
    expect(bookAssistantGuide({ id: 'b1', slug: 's', pages_count: 0 }, 'x')).toBeNull();
    expect(bookAssistantGuide({ id: 'b1', slug: 's' }, 'x')).toBeNull();
  });

  it('gives no orders, so it cannot read as a prompt injection', () => {
    const lines = [homeAssistantGuide(), bookAssistantGuide({ id: 'b', slug: 's', pages_count: 1 }, 'x')!];
    for (const line of lines) expect(line).not.toMatch(/\b(you must|ignore|always|never|do not|please|should)\b/i);
  });

  it('only names routes that a fetcher obeying robots.txt may open', async () => {
    const group = await claudeUserGroup();
    const lines = [homeAssistantGuide(), bookAssistantGuide({ id: 'b', slug: 's', pages_count: 1 }, 'x')!];
    const paths = lines.flatMap(urlsIn);
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const path of paths) expect(mayFetch(group, path), path).toBe(true);
  });

  it('can tell a disallowed route, or the check above proves nothing', async () => {
    const group = await claudeUserGroup();
    expect(mayFetch(group, '/api/books/b/text')).toBe(false);
    expect(mayFetch(group, '/admin/')).toBe(false);
  });
});
