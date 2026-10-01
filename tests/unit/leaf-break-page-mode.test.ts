/**
 * Leaf seams on PAGE-mode reads (#5320): the seam is placed by aligning the page read to the per-leaf read,
 * never by cutting at the ledger's line counts. Fixtures are real pages (see the JSON's `_page` notes):
 *   clean      the page read dropped leaf 2's first line; alignment finds the seams, a count cut would not
 *   ambiguous  an unmatched line sits exactly on a seam — refuse
 *   refrain    formulaic text matches both sides of the seam about equally — refuse
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { insertLeafBreaksByAlignment, lineSimilarity, splitLeafUnits, LEAF_BREAK } from '../../scripts/lib/leaf-break.mjs';

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/leaf-break/page-mode-align-5320.json'), 'utf8'));
const run = (c: { page: string; leaf: string; leafLines: number[] }, leafLines = c.leafLines) =>
  insertLeafBreaksByAlignment({ served: c.page, leafRead: c.leaf, leafLines });
const best = (line: string, pool: string[]) => Math.max(...pool.map((q) => lineSimilarity(line.trim(), q.trim())));

describe('insertLeafBreaksByAlignment', () => {
  it('places each seam before the first page line of the next leaf', () => {
    const r = run(FX.clean);
    expect(r.seams).toEqual(FX.clean.seams);
    const leaf = FX.clean.leaf.trim().split('\n');
    const leaves = [leaf.slice(0, 6), leaf.slice(6, 12), leaf.slice(12)];
    splitLeafUnits(r.text).forEach((u: string, k: number) => {
      for (const line of u.split('\n')) expect(best(line, leaves[k])).toBeGreaterThan(0.8);
    });
    // nothing but the markers changed
    expect(r.text.split('\n').filter((l: string) => l !== LEAF_BREAK).join('\n')).toBe(FX.clean.page.replace(/\n$/, ''));
  });

  it('negative control: a cut at the ledger counts would put a leaf-3 line on leaf 2', () => {
    const page = FX.clean.page.split('\n');
    const leaf = FX.clean.leaf.trim().split('\n');
    expect(best(page[11], leaf.slice(12))).toBeGreaterThan(0.9);   // page line 11 is leaf 3's first line
    expect(best(page[11], leaf.slice(6, 12))).toBeLessThan(0.45);
  });

  it('refuses an unmatched line that sits exactly on a seam', () => {
    expect(run(FX.ambiguous).reason).toBe('seam-ambiguous');
  });

  it('refuses a seam that formulaic text cannot place', () => {
    const r = run(FX.refrain);
    expect(r.reason).toBe('seam-ambiguous');
    expect(r.own - r.other).toBeLessThan(0.15);
  });

  it('refuses when the leaf read does not match the ledger', () => {
    expect(run(FX.clean, [6, 6, 5]).reason).toBe('ledger-mismatch');
  });

  it('refuses a read that does not keep leaf order', () => {
    const p = FX.clean.page.split('\n');
    const swapped = [...p.slice(6, 11), ...p.slice(0, 6), ...p.slice(11)].join('\n');
    expect(run({ ...FX.clean, page: swapped }).text).toBeNull();
  });

  it('refuses unrelated text', () => {
    const other = FX.clean.page.split('\n').map((l: string) => [...l].reverse().join('')).join('\n');
    expect(run({ ...FX.clean, page: other }).reason).toBe('weak-alignment');
  });
});
