/**
 * The metered Gemini client (#4599).
 *
 * Measured across August 2026, 117,090 of 417,936 successful GenerateContent
 * calls — 28% — wrote no usage row. Spend nobody can attribute to a workstream,
 * the daily dial cannot see, and #4581's runaway thinking budget could hide in,
 * because there is no row to check.
 *
 * The fix is structural rather than diligent: `getGeminiClient()` returns a
 * client whose models log every generation, so forgetting to log is no longer
 * possible — only forgetting to LABEL, which shows up as `unlabelled` in the
 * attribution table instead of vanishing. These tests pin the three properties
 * that make that true, plus the one that keeps it safe: a lane which writes its
 * own richer row can opt out, because two rows for one call would double the
 * measured spend and close the dial on money that was never spent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const generateContent = vi.fn();
const generateContentStream = vi.fn();
const getGenerativeModel = vi.fn(() => ({ generateContent, generateContentStream }));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = getGenerativeModel;
  },
}));
vi.mock('@/lib/gemini-logger', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gemini-logger')>('@/lib/gemini-logger');
  return { ...actual, logGeminiCall: vi.fn(async () => {}) };
});

import { logGeminiCall } from '@/lib/gemini-logger';
import { getGeminiClient, getUnmeteredGeminiClient } from '@/lib/gemini-client';

const usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 300 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-key';
  generateContent.mockResolvedValue({ response: { usageMetadata: usage } });
});

describe('getGeminiClient meters every generation', () => {
  it('writes one usage row per generateContent, with the caller label', async () => {
    const model = getGeminiClient({ endpoint: '/api/explain', type: 'other' })
      .getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    await model.generateContent('hello');

    expect(logGeminiCall).toHaveBeenCalledTimes(1);
    const row = vi.mocked(logGeminiCall).mock.calls[0][0];
    expect(row.endpoint).toBe('/api/explain');
    expect(row.model).toBe('gemini-3.1-flash-lite');
    expect(row.status).toBe('success');
    expect(row.input_tokens).toBe(100);
  });

  it('counts thinking tokens as output, because Google bills them there', () => {
    // 20 visible + 300 reasoning. Counting candidatesTokenCount alone is how
    // August metered $499.74 against $8,389.32 billed (#4581).
    const model = getGeminiClient({ endpoint: 'test' }).getGenerativeModel({ model: 'm' });
    return model.generateContent('x').then(() => {
      expect(vi.mocked(logGeminiCall).mock.calls[0][0].output_tokens).toBe(320);
    });
  });

  it('records a failed call and still throws it', async () => {
    generateContent.mockRejectedValueOnce(new Error('429 rate limited'));
    const model = getGeminiClient({ endpoint: '/api/explain' }).getGenerativeModel({ model: 'm' });

    await expect(model.generateContent('x')).rejects.toThrow('429');
    const row = vi.mocked(logGeminiCall).mock.calls[0][0];
    expect(row.status).toBe('failed');
    expect(row.error_message).toContain('429');
  });

  it('still logs when no label is given — as unlabelled, never as nothing', async () => {
    const model = getGeminiClient().getGenerativeModel({ model: 'm' });
    await model.generateContent('x');
    expect(vi.mocked(logGeminiCall).mock.calls[0][0].endpoint).toBe('unlabelled');
  });

  it('meters the streaming path once the aggregated response resolves', async () => {
    generateContentStream.mockResolvedValue({
      stream: (async function* () { yield { text: () => 'a' }; })(),
      response: Promise.resolve({ usageMetadata: usage }),
    });
    const model = getGeminiClient({ endpoint: '/api/books/[id]/chat' }).getGenerativeModel({ model: 'm' });
    const result = await model.generateContentStream('x');
    await result.response;
    // The log is attached to the response promise, not awaited inline — let the
    // microtask queue drain before asserting.
    await new Promise((r) => setTimeout(r, 0));

    expect(logGeminiCall).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logGeminiCall).mock.calls[0][0].endpoint).toBe('/api/books/[id]/chat');
  });
});

describe('opting out', () => {
  it('selfMetered lanes are NOT auto-logged — two rows would double the spend', async () => {
    const model = getGeminiClient({ selfMetered: true, reason: 'caller logs with page context' })
      .getGenerativeModel({ model: 'm' });
    await model.generateContent('x');
    expect(logGeminiCall).not.toHaveBeenCalled();
  });

  it('a client built on someone else’s key is never charged to us', async () => {
    const model = getUnmeteredGeminiClient('a-contributor-key').getGenerativeModel({ model: 'm' });
    await model.generateContent('x');
    expect(logGeminiCall).not.toHaveBeenCalled();
  });
});
