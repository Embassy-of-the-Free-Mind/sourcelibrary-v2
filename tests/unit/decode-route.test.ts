/**
 * POST /api/decode (#8150 slice 1): marks made by markForExport verify through
 * the route, the shared limiter is the one consulted, and oversized or empty
 * pastes are refused.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const limiter = vi.fn(async () => ({ allowed: true as const }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitShared: (...a: unknown[]) => limiter(...(a as [])),
  getClientIp: () => '203.0.113.9',
}));
vi.mock('@/lib/mongodb', () => ({
  getReadDb: async () => ({
    collection: () => ({
      findOne: async () => ({ id: '69779625b58638948b30281e', slug: 'the-cabinet-of-minerals-vreeswyk', display_title: 'The Cabinet of Minerals' }),
      find: () => ({ limit: () => ({ toArray: async () => [{ id: '69779625b58638948b30281e', slug: 'the-cabinet-of-minerals-vreeswyk', title: 'Het cabinet' }] }) }),
    }),
  }),
}));

type Handler = (r: Request) => Promise<Response>;
let POST: Handler;
let markForExport: (t: string, id: string) => string;

beforeAll(async () => {
  process.env.PROVENANCE_SECRET_KEY = 'route-test-key';
  ({ POST } = (await import('@/app/api/decode/route')) as unknown as { POST: Handler });
  ({ markForExport } = await import('@/lib/provenance'));
});

const SAMPLE =
  'The salts are drawn from the ashes. Then they are dissolved in rain water. ' +
  'The water is filtered and boiled away! What is left is white. Keep it dry.';
const post = (body: unknown) =>
  POST(new Request('https://sourcelibrary.org/api/decode', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

describe('POST /api/decode', () => {
  it('verifies a mark made by the export path and names the book', async () => {
    const res = await post({ text: markForExport(SAMPLE, '69779625b58638948b30281e') });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body.status).toBe('authentic');
    expect(body.edition).toBe('69779625');
    expect(body.books).toEqual([{ title: expect.any(String), url: '/book/the-cabinet-of-minerals-vreeswyk' }]);
    expect(limiter).toHaveBeenCalled();
  });

  it('says none for clean text', async () => {
    expect((await (await post({ text: SAMPLE })).json()).status).toBe('none');
  });

  it('refuses empty and oversized pastes', async () => {
    expect((await post({ text: '' })).status).toBe(400);
    expect((await post({ text: 'x'.repeat(200_001) })).status).toBe(413);
  });

  it('answers 429 when the shared limiter refuses', async () => {
    limiter.mockResolvedValueOnce({ allowed: false, retryAfter: 30 } as never);
    const res = await post({ text: SAMPLE });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});
