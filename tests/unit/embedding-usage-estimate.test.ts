import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs without types
import { estimateTextTokens, newEmbedUsage, addEmbedUsage, usdForTokens, estimateUsd } from '../../scripts/lib/embedding-usage.mjs';

// #5729: countTokens measured ~1.1 chars/token on the Chinese chunks; the flat
// 4.29 ratio read those pages at a quarter of their cost.
describe('embedding usage estimate', () => {
  it('counts each CJK character as a token', () => {
    expect(estimateTextTokens('天地玄黃宇宙洪荒')).toBe(8);
  });

  it('keeps the flat ratio for Latin script', () => {
    const t = 'x'.repeat(429);
    expect(estimateTextTokens(t)).toBe(100);
  });

  it('accumulates script-aware tokens alongside chars', () => {
    const u = newEmbedUsage();
    addEmbedUsage(u, ['天地玄黃', 'x'.repeat(429)]);
    expect(u).toEqual({ texts: 2, chars: 433, tokens: 104 });
  });

  it('prices the Batch API at half', () => {
    expect(usdForTokens(1e6, { batch: true })).toBeCloseTo(usdForTokens(1e6) / 2);
    expect(estimateUsd(4.29e6, { batch: true })).toBeCloseTo(0.1);
  });
});
