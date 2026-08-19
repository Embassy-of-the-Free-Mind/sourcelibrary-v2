import { describe, it, expect } from 'vitest';
// Mirrors the local helper in src/app/contribute/page.tsx.
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.floor(n / 100) / 10}k`;
  return n.toString();
}
describe('contribute stat formatting', () => {
  it('renders millions as M, not thousands-of-thousands', () => {
    expect(formatNumber(19_132_100)).toBe('19.1M');
  });
  it('still renders thousands as k', () => {
    expect(formatNumber(13_713)).toBe('13.7k');
  });
  it('leaves small numbers alone', () => {
    expect(formatNumber(184)).toBe('184');
  });
});
