import { describe, it, expect, vi, beforeEach } from 'vitest';

// The regression this guards: a failing RPC used to be reported as an empty
// result set, making a database fault indistinguishable from "nothing matched".
// That hid an undeployed match_semantic for months, and in Aug 2026 made a
// working language filter look broken. See SemanticSearchError's docblock.

const rpc = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

describe('semantic search: an RPC error is not an empty result', () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [{ values: Array(768).fill(0.01) }] }),
    }) as unknown as typeof fetch;
  });

  it('throws SemanticSearchError when the RPC errors', async () => {
    const { semanticPageSearchGlobal, SemanticSearchError } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: null, error: { message: 'function match_semantic does not exist' } });

    await expect(semanticPageSearchGlobal('anything', 5)).rejects.toBeInstanceOf(SemanticSearchError);
  });

  it('names the failing RPC in the message, so the log identifies the fault', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: null, error: { message: 'statement timeout' } });

    await expect(semanticPageSearchGlobal('anything', 5)).rejects.toThrow(/match_semantic failed: statement timeout/);
  });

  it('still returns [] for a genuinely empty result — an empty answer is an answer', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    rpc.mockResolvedValue({ data: [], error: null });

    await expect(semanticPageSearchGlobal('anything', 5)).resolves.toEqual([]);
  });
});
