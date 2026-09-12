import { describe, it, expect } from 'vitest';
import { parsePromptVersion, nextPromptVersion } from '@/lib/prompts';

/**
 * #3614. `prompts.version` held numbers, `'v1'` strings, and nothing at all, so
 * `latestVersion.version + 1` produced `'v11'` from `'v1'` and `NaN` from a
 * missing field, and `sort({version: -1})` followed BSON type order rather than
 * intent. These are the two functions that now stand between that mix and every
 * new prompt version.
 */
describe('parsePromptVersion', () => {
  it('passes numbers through', () => {
    expect(parsePromptVersion(12)).toBe(12);
    expect(parsePromptVersion(0)).toBe(0);
  });

  it('parses the `v`-prefixed strings that were mixed into the collection', () => {
    expect(parsePromptVersion('v1')).toBe(1);
    expect(parsePromptVersion('V12')).toBe(12);
    expect(parsePromptVersion(' 3 ')).toBe(3);
  });

  it('returns 0 — not 1 — for a pre-versioning row', () => {
    // The old `x || 1` recorded an unversioned row as v1, pointing provenance at
    // a prompt that never produced the text. 0 is the "no real DB version"
    // sentinel the hardcoded fallbacks already use.
    expect(parsePromptVersion(undefined)).toBe(0);
    expect(parsePromptVersion(null)).toBe(0);
    expect(parsePromptVersion('latest')).toBe(0);
    expect(parsePromptVersion(NaN)).toBe(0);
  });
});

describe('nextPromptVersion', () => {
  const fakeCollection = (rows: Array<{ version?: unknown }>) => ({
    find: () => ({ toArray: async () => rows }),
  });

  it('is max + 1 over PARSED versions, not over raw sort order', async () => {
    // The exact mix that was live: a string, a number, and a missing field.
    const coll = fakeCollection([{ version: 'v1' }, { version: 12 }, {}]);
    expect(await nextPromptVersion(coll, 'translation', 'Standard Translation')).toBe(13);
  });

  it('starts a new lineage at 1', async () => {
    expect(await nextPromptVersion(fakeCollection([]), 'ocr', 'Brand New OCR')).toBe(1);
  });

  it('never returns a string, whatever the rows hold', async () => {
    const next = await nextPromptVersion(fakeCollection([{ version: 'v9' }]), 'ocr', 'Standard OCR');
    expect(typeof next).toBe('number');
    expect(next).toBe(10);
  });

  it('scopes the query to (type, name) — name alone collides across types', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const coll = {
      find: (q: Record<string, unknown>) => { seen.push(q); return { toArray: async () => [] }; },
    };
    await nextPromptVersion(coll, 'summary', 'Standard Summary');
    expect(seen).toEqual([{ type: 'summary', name: 'Standard Summary' }]);
  });
});
