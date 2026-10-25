/**
 * A usage row survives a Supabase 4xx/5xx (#7185).
 *
 * `logUsage` used to fall back to MongoDB only when `fetch` THREW. A non-OK
 * answer printed "Write failed" and the row was gone, so during a Supabase
 * incident every metered script spent money and left no record of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    db: { collection: () => ({ insertOne: async (doc: Record<string, unknown>) => { inserted.push(doc); } }) },
  };
}

describe('logUsage falls back to MongoDB when Supabase refuses the row', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes the row to MongoDB on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const { logUsage } = await import('../../scripts/workers/lib/supabase-usage-logger.mjs');
    const { db, inserted } = fakeDb();
    await logUsage({ model: 'gemini-3.1-flash-lite', input_tokens: 10, output_tokens: 5, type: 'test' }, db);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].input_tokens).toBe(10);
  });

  it('does not double-write when Supabase accepts the row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));
    const { logUsage } = await import('../../scripts/workers/lib/supabase-usage-logger.mjs');
    const { db, inserted } = fakeDb();
    await logUsage({ model: 'gemini-3.1-flash-lite', input_tokens: 10, output_tokens: 5, type: 'test' }, db);
    expect(inserted).toHaveLength(0);
  });
});
