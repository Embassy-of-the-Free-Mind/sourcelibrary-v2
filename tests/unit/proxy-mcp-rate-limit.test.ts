import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// #8154: readers in Claude Code were told "You're crawling Source Library" and
// shown a sales pitch. Every MCP client lacks Accept-Language and Sec-Fetch-Mode,
// so all of them fell under the 10-a-minute crawler limit.

function post(pathname: string, ip: string, ua = 'claude-code/2.1.318 (sdk-cli)') {
  return new NextRequest(`https://sourcelibrary.org${pathname}`, {
    method: 'POST',
    headers: { 'user-agent': ua, 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: '{}',
  });
}

async function statuses(pathname: string, ip: string, n: number) {
  const out: Array<{ status: number; body: string }> = [];
  for (let i = 0; i < n; i++) {
    const res = await proxy(post(pathname, ip));
    out.push({ status: res.status, body: res.status === 429 ? await res.text() : '' });
  }
  return out;
}

describe('the proxy rate limit on /api/mcp', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  });

  it('lets an agent turn fan out well past the crawler limit', async () => {
    const results = await statuses('/api/mcp', '203.0.113.10', 40);
    expect(results.filter((r) => r.status === 429)).toEqual([]);
  });

  it('still has a limit, and answers it plainly instead of calling the reader a crawler', async () => {
    const results = await statuses('/api/mcp', '203.0.113.11', 125);
    const refused = results.filter((r) => r.status === 429);
    expect(refused.length).toBe(5);
    expect(refused[0].body).not.toMatch(/crawling/i);
    expect(JSON.parse(refused[0].body).error.message).toMatch(/try again/i);
  });

  it('control: other API paths keep the crawler limit and its reply', async () => {
    const results = await statuses('/api/search', '203.0.113.12', 12);
    const refused = results.filter((r) => r.status === 429);
    expect(refused.length).toBe(2);
    expect(refused[0].body).toMatch(/crawling/i);
  });
});
