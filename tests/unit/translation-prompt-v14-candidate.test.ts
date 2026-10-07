/**
 * The v14 translation-prompt candidate measured in the #5305 A/B (2026-10-02): live v13 + the edits in
 * V14_EDITS, and on Tibetan books the leaf lines. The input is the real v13 text the run recorded
 * (scripts/eval/results/translation-prompt-v14-ab-2026-10-02/arms.json).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { buildV14, V14_EDITS, TIBETAN_LINES } from '../../scripts/eval/translation-prompt-v14-ab.mjs';

const ARMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/eval/results/translation-prompt-v14-ab-2026-10-02/arms.json'), 'utf8'));
const V13: string = ARMS.text.v13;
const sha = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 12);

describe('the arms the v14 A/B ran are unchanged', () => {
  it('rebuilds v14 and v14t to the recorded hashes', () => {
    expect(sha(V13)).toBe(ARMS.arms.v13.sha);
    expect(sha(buildV14(V13))).toBe(ARMS.arms.v14.sha);
    expect(sha(buildV14(V13, { tibetan: true }))).toBe(ARMS.arms.v14t.sha);
  });
});

describe('buildV14', () => {
  const v14 = buildV14(V13);

  it('applies every edit, each anchor exactly once', () => {
    for (const [a, b] of V14_EDITS) {
      expect(V13.split(a).length).toBe(2);
      expect(v14).toContain(b);
    }
  });
  it('shows the model only the bare continuity marker', () => {
    const shown = [...v14.matchAll(/<meta>continues from previous page[\s\S]*?<\/meta>/g)].map(m => m[0]);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const s of shown) expect(s).toBe('<meta>continues from previous page</meta>');
  });
  it('repairs the numbering: 1 to 11, each once', () => {
    const nums = [...v14.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1]));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it('adds the Tibetan leaf lines only when asked', () => {
    expect(v14).not.toContain(TIBETAN_LINES);
    expect(buildV14(V13, { tibetan: true })).toContain(TIBETAN_LINES);
  });
  it('refuses a v13 row whose anchor has changed', () => {
    expect(() => buildV14(V13.replace(V14_EDITS[0][0], 'something else'))).toThrow(/anchor/);
  });
});
