/**
 * scripts/lib/ocr-targeting.mjs (#5244) — the page/book list shapes the batch and realtime OCR
 * scripts share, and the byte-bounded chunking that replaced the page-count bound (#3974).
 */
import { describe, it, expect } from 'vitest';
import { parsePageIds, parseBookIds, chunkByBytes } from '../../scripts/lib/ocr-targeting.mjs';

describe('parsePageIds', () => {
  it('takes a bare array of ids', () => {
    expect(parsePageIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
  it('takes page_id objects under confirmed / suspected / pages, dropping duplicates in order', () => {
    const raw = { confirmed: [{ page_id: 'p1' }, 'p2'], suspected: [{ page_id: 'p2' }, { page_id: 'p3' }], pages: [{ nope: 1 }, 'p4'] };
    expect(parsePageIds(raw)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
  it('returns nothing for an object with none of the known keys', () => {
    expect(parsePageIds({ other: ['x'] })).toEqual([]);
  });
});

describe('parseBookIds', () => {
  it('reads one id per line, ignoring blanks and # comments', () => {
    expect(parseBookIds('b1\n\n  b2  # keely\n# whole-line comment\nb1\n')).toEqual(['b1', 'b2']);
  });
});

describe('chunkByBytes', () => {
  const size = (n: number) => n;
  it('bounds a chunk by bytes before item count', () => {
    const chunks = chunkByBytes([40, 40, 40, 40], size, { maxBytes: 100, maxItems: 10 });
    expect(chunks.map((c) => c.items)).toEqual([[40, 40], [40, 40]]);
    expect(chunks.map((c) => c.bytes)).toEqual([80, 80]);
  });
  it('bounds by item count when bytes allow more', () => {
    const chunks = chunkByBytes([1, 1, 1, 1, 1], size, { maxBytes: 1000, maxItems: 2 });
    expect(chunks.map((c) => c.items.length)).toEqual([2, 2, 1]);
  });
  it('never drops an item larger than the cap: it gets a chunk of its own', () => {
    const chunks = chunkByBytes([10, 500, 10], size, { maxBytes: 100, maxItems: 10 });
    expect(chunks.map((c) => c.items)).toEqual([[10], [500], [10]]);
    expect(chunks.flatMap((c) => c.items)).toHaveLength(3);
  });
  it('rejects a non-positive cap', () => {
    expect(() => chunkByBytes([1], size, { maxBytes: 0, maxItems: 1 })).toThrow();
  });
});

/**
 * #7499: realtime-ocr.mjs / realtime-reocr-efm.mjs now stamp the prompt they SENT instead of the constant
 * 'v5.2026-02'. Four selectors keyed on that constant. Making the label true must not move selection: a page
 * those writers write after the fix is selected exactly as the same page carrying 'v5.2026-02' was before.
 */
import { ocrLabelIn, ocrLabelNotIn, LEGACY_V5_LABEL, FORMER_V5_STAMPERS } from '../../scripts/lib/ocr-targeting.mjs';

// The operators these clauses use, with Mongo's semantics for a missing field ($in matches it only via null).
const get = (doc: any, path: string) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
function matches(doc: any, q: any): boolean {
  return Object.entries(q).every(([k, c]: [string, any]) => {
    if (k === '$or') return c.some((s: any) => matches(doc, s));
    if (k === '$nor') return !c.some((s: any) => matches(doc, s));
    const v = get(doc, k) ?? null;
    if (c && typeof c === 'object' && '$in' in c) return c.$in.includes(v);
    if (c && typeof c === 'object' && '$nin' in c) return !c.$nin.includes(v);
    return v === c;
  });
}

describe('ocrLabelIn / ocrLabelNotIn (#7499)', () => {
  const ACCEPTABLE = ['v5.2026-02', 'v4.2026-02', 'v3.2026-02'];
  const ocr = (prompt_version: any, call_site?: string) => ({ ocr: { ...(prompt_version !== undefined && { prompt_version }), ...(call_site && { engine: { call_site } }) } });
  // [the page as written before #7499, the same write after it]
  const twins: [string, any, any][] = [
    ...FORMER_V5_STAMPERS.flatMap((cs) => [
      [`${cs} under v19.1`, ocr(LEGACY_V5_LABEL, cs), ocr('19.1', cs)],
      [`${cs} under v16`, ocr(LEGACY_V5_LABEL, cs), ocr('16', cs)],
      [`${cs}, prompt row with no version`, ocr(LEGACY_V5_LABEL, cs), ocr(undefined, cs)],
    ] as [string, any, any][]),
    ['the orchestrator under v19.1 (never stamped v5)', ocr('19.1', 'scripts/workers/pipeline-orchestrator.mjs'), ocr('19.1', 'scripts/workers/pipeline-orchestrator.mjs')],
    ['a legacy v4 page', ocr('v4.2026-02'), ocr('v4.2026-02')],
    ['a v5 page with no engine block', ocr(LEGACY_V5_LABEL), ocr(LEGACY_V5_LABEL)],
    ['no OCR label at all', ocr(undefined), ocr(undefined)],
  ];
  const old = {
    in: (labels: string[]) => ({ 'ocr.prompt_version': { $in: labels } }),
    nin: (labels: string[]) => ({ 'ocr.prompt_version': { $nin: labels } }),
  };
  const selectors: [string, string[]][] = [
    ['realtime-ocr / realtime-reocr-efm --old-ocr', ACCEPTABLE],
    ['bulk-reocr-local (default v19.1)', ['19.1', LEGACY_V5_LABEL]],
    ['bulk-reocr-local (default v20)', ['20', LEGACY_V5_LABEL]],
    ['batch-extract-chapters --new-ocr', ['v4.2026-02', LEGACY_V5_LABEL]],
  ];
  for (const [sel, labels] of selectors) {
    for (const [what, before, after] of twins) {
      it(`${sel}: ${what} is selected as before`, () => {
        expect(matches(after, ocrLabelNotIn(labels))).toBe(matches(before, old.nin(labels)));
        expect(matches(after, ocrLabelIn(labels))).toBe(matches(before, old.in(labels)));
      });
    }
  }
  it('a label list without v5 is the plain $in / $nin', () => {
    expect(ocrLabelIn(['16'])).toEqual({ $or: [{ 'ocr.prompt_version': { $in: ['16'] } }] });
    expect(ocrLabelNotIn(['16'])).toEqual({ $nor: [{ 'ocr.prompt_version': { $in: ['16'] } }] });
  });
});
