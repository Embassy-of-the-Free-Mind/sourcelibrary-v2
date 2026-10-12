import { describe, it, expect } from 'vitest';
import { normalizeErrorMessage, noiseClass, rollupRawGroups } from '@/lib/error-rollup';

const d = (s: string) => new Date(s);
const row = (m: string, n: number, over: Partial<{ s: string; ips: string[]; url: string; first: string; last: string }> = {}) => ({
  _id: { m, s: over.s ?? 'window.onerror' },
  n,
  ips: over.ips ?? ['1.1.1.1'],
  url: over.url ?? 'https://sourcelibrary.org/search?q=couple&mode=images',
  first: d(over.first ?? '2026-08-12T00:00:00Z'),
  last: d(over.last ?? '2026-08-18T00:00:00Z'),
});
const opts = { windowDays: 7, minCount: 10, limit: 25 };

describe('normalizeErrorMessage', () => {
  it('folds the forms one error arrives in', () => {
    const a = normalizeErrorMessage('Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message');
    const b = normalizeErrorMessage('Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message');
    expect(a).toBe(b);
  });

  it('drops digests, ids and quoted values', () => {
    expect(normalizeErrorMessage('operation exceeded time limit [digest:3580489259]')).toBe('operation exceeded time limit');
    expect(normalizeErrorMessage('Image with src "https://images.sourcelibrary.org/pages/6953b56577f38f6761bd979d/0010.jpg" has both "fill" and "style.width" properties'))
      .toBe(normalizeErrorMessage('Image with src "https://images.sourcelibrary.org/pages/69804b901fb2ba7cf1d43a18/0006.jpg" has both "fill" and "style.width" properties'));
  });

  it('keeps distinct errors distinct', () => {
    expect(normalizeErrorMessage('e.normalize is not a function')).toBe('e.normalize is not a function');
    expect(normalizeErrorMessage('Minified React error #418')).not.toBe(normalizeErrorMessage('Minified React error #441'));
  });
});

describe('rollupRawGroups', () => {
  it('surfaces the #4057 search crash as one group above threshold', () => {
    const out = rollupRawGroups([
      row('TypeError: e.normalize is not a function', 120, { ips: ['1.1.1.1', '2.2.2.2'], first: '2026-08-11T03:00:00Z' }),
      row('Uncaught TypeError: e.normalize is not a function', 74, { ips: ['2.2.2.2', '3.3.3.3'], s: 'app_error_boundary', last: '2026-08-18T09:00:00Z' }),
      row('Load failed', 3),
    ], opts);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toMatchObject({
      pattern: 'TypeError: e.normalize is not a function',
      count: 194,
      visitors: 3,
      sources: ['app_error_boundary', 'window.onerror'],
      first_seen: '2026-08-11T03:00:00.000Z',
      last_seen: '2026-08-18T09:00:00.000Z',
    });
    expect(out.total_rows).toBe(197);
    expect(out.below_threshold_rows).toBe(3);
  });

  it('counts denylisted and localhost rows as suppressed instead of dropping them', () => {
    const out = rollupRawGroups([
      row("Cannot assign to read only property 'srcdoc' of object '#<HTMLIFrameElement>'", 1269),
      row('Image with src "x" has both "fill" and "style.width" properties', 40, { url: 'http://localhost:3456/collections/kabbalah' }),
      row('operation exceeded time limit [digest:1]', 12, { s: 'server_render', ips: [] }),
    ], opts);
    expect(out.groups.map(g => g.pattern)).toEqual(['operation exceeded time limit']);
    expect(out.groups[0].visitors).toBe(0);
    expect(out.suppressed).toEqual([{ class: 'extension-srcdoc', count: 1269 }, { class: 'localhost', count: 40 }]);
    expect(out.total_rows).toBe(1321);
  });

  it('marks a pattern absent from the prior window as new', () => {
    const out = rollupRawGroups([row('TypeError: e.normalize is not a function', 30), row('Load failed', 20)], {
      ...opts, prior: [row('Uncaught Load failed', 15)],
    });
    expect(out.groups.map(g => [g.pattern, g.prior_count])).toEqual([
      ['TypeError: e.normalize is not a function', 0],
      ['Load failed', 15],
    ]);
  });

  it('never returns an IP', () => {
    const out = rollupRawGroups([row('boom', 50, { ips: ['203.0.113.7'] })], opts);
    expect(JSON.stringify(out)).not.toContain('203.0.113.7');
  });
});

describe('noiseClass', () => {
  it('leaves our own errors alone', () => {
    expect(noiseClass('e.normalize is not a function')).toBeNull();
    expect(noiseClass('failed to pipe response')).toBeNull();
  });
});
