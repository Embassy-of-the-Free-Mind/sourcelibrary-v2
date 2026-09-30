/**
 * The seeded generator behind every bootstrap interval in scripts/eval (scripts/eval/lib/paired-stats.mjs).
 *
 * #5373: the generator was an LCG written in double arithmetic. `seed * 1103515245` passes 2^53, the low
 * bits were rounded away before `& 0x7fffffff` kept exactly those bits, and the stream fell onto a short
 * cycle — 13,676 distinct values in 1,000,000 draws, decile counts 95,446–104,437. Intervals built on it
 * came out the wrong width (a paired difference read (1.0 to 6.9) where a sound bootstrap gives (0.0 to 7.6)).
 *
 * These tests pin the three things that failure broke: the stream does not repeat, it is uniform, and an
 * interval built on it has the width theory says it should. The last block keeps the lossy LCG from being
 * pasted into another script, which is how it reached ten files.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  resetSeed, seededRand, makeRng, bootstrapCI, diffCI, bootstrapRatioCI,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/lib/paired-stats.mjs';

const N = 1_000_000;

describe('paired-stats seeded generator', () => {
  it('does not cycle: at least 999,000 distinct values in 1,000,000 draws', () => {
    resetSeed();
    const seen = new Set<number>();
    for (let i = 0; i < N; i++) seen.add(seededRand());
    expect(seen.size).toBeGreaterThanOrEqual(999_000);
  });

  it('is uniform: every decile holds 10% of 1,000,000 draws, within 1%', () => {
    resetSeed();
    const deciles = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const x = seededRand();
      expect(x >= 0 && x < 1).toBe(true);
      deciles[Math.floor(x * 10)]++;
    }
    for (const count of deciles) {
      expect(count).toBeGreaterThanOrEqual(99_000);
      expect(count).toBeLessThanOrEqual(101_000);
    }
  });

  it('is uniform over an index range that is not a power of two (the resampling use)', () => {
    // 304 is the page count of the run that exposed the bug; chi-square there was 3,105 against ≈ 303.
    resetSeed();
    const bins = new Array(304).fill(0), per = 5000;
    for (let i = 0; i < 304 * per; i++) bins[Math.floor(seededRand() * 304)]++;
    const chi2 = bins.reduce((s: number, o: number) => s + (o - per) ** 2 / per, 0);
    expect(chi2).toBeLessThan(420); // 303 df: p ≈ 1e-5 at 420; a sound generator sits near 303
  });

  it('is reproducible: the same seed gives the same stream, a different seed a different one', () => {
    resetSeed(1234); const a = Array.from({ length: 50 }, () => seededRand());
    resetSeed(1234); const b = Array.from({ length: 50 }, () => seededRand());
    resetSeed(1235); const c = Array.from({ length: 50 }, () => seededRand());
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    const own = makeRng(1234);
    expect(Array.from({ length: 50 }, () => own())).toEqual(a);
  });
});

describe('bootstrap intervals have the width theory predicts', () => {
  // Checked over twenty seeds, not one: the broken generator's error depended on the seed. Measured on the
  // paired shape below it gave 0.88 of the analytic width on most seeds and 0.35 on two of forty; the
  // generator now in place stays within 0.97–1.01. A single default-seed check passed on BOTH generators.
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  const widthRatio = (ci: number[], se: number) => (ci[1] - ci[0]) / (2 * 1.96 * se);

  // 304 binary outcomes at 85% — the shape of a "fidelity ≥ 4" rate. Normal-approximation half-width is
  // 1.96 · sqrt(p(1−p)/n).
  const xs = Array.from({ length: 304 }, (_, i) => (i < 258 ? 1 : 0));
  const p = 258 / 304, se = Math.sqrt(p * (1 - p) / 304);

  it('bootstrapCI on paired differences (the shape that exposed the bug: 23 pages up, 11 down, 270 ties)', () => {
    const d = Array.from({ length: 304 }, (_, i) => (i % 13 === 0 && i / 13 < 23 ? 1 : i % 25 === 7 && (i - 7) / 25 < 12 ? -1 : 0));
    const m = d.reduce((s: number, x: number) => s + x, 0) / d.length;
    const seD = Math.sqrt(d.reduce((s: number, x: number) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length);
    for (const seed of SEEDS) {
      resetSeed(seed);
      const ci = bootstrapCI(d);
      expect(widthRatio(ci, seD), `seed ${seed}`).toBeGreaterThan(0.93);
      expect(widthRatio(ci, seD), `seed ${seed}`).toBeLessThan(1.07);
      expect(Math.abs((ci[0] + ci[1]) / 2 - m) / seD, `seed ${seed}`).toBeLessThan(0.2);
    }
  });

  it('bootstrapCI on a proportion', () => {
    for (const seed of SEEDS) {
      resetSeed(seed);
      const ci = bootstrapCI(xs);
      expect(widthRatio(ci, se), `seed ${seed}`).toBeGreaterThan(0.93);
      expect(widthRatio(ci, se), `seed ${seed}`).toBeLessThan(1.07);
    }
  });

  it('bootstrapRatioCI with unit denominators agrees with bootstrapCI', () => {
    resetSeed();
    const r = bootstrapRatioCI(xs, xs.map(() => 1));
    expect(r.rate).toBeCloseTo(p, 10);
    expect((r.ci[1] - r.ci[0]) / (2 * 1.96 * se)).toBeGreaterThan(0.93);
    expect((r.ci[1] - r.ci[0]) / (2 * 1.96 * se)).toBeLessThan(1.07);
  });

  it('diffCI on two independent proportions', () => {
    const ys = Array.from({ length: 304 }, (_, i) => (i < 228 ? 1 : 0));
    const q = 228 / 304, seDiff = Math.sqrt(se ** 2 + q * (1 - q) / 304);
    resetSeed();
    const d = diffCI(xs, ys);
    expect(d.delta).toBeCloseTo(q - p, 10);
    expect((d.ci[1] - d.ci[0]) / (2 * 1.96 * seDiff)).toBeGreaterThan(0.93);
    expect((d.ci[1] - d.ci[0]) / (2 * 1.96 * seDiff)).toBeLessThan(1.07);
  });
});

describe('the lossy LCG is not pasted into another script', () => {
  // `x * 1103515245` in double arithmetic is the bug; `Math.imul(1103515245, x)` is the correct form.
  // These files carry it and are left alone ON PURPOSE: each seeds a sample draw or a blinded shuffle
  // that was already made and judged, and changing the generator would stop the draw reproducing.
  // The legacy generator in paired-stats.mjs is there for the same reason. Do not add to this list —
  // a new script imports `makeRng` / `seededRand` from scripts/eval/lib/paired-stats.mjs.
  const FROZEN = new Set([
    'scripts/eval/lib/paired-stats.mjs',
    'scripts/analysis/gap-validation-gold-export.mjs',
    'scripts/eval/contact-sheet-screen.mjs',
    'scripts/eval/harvest-wikisource-gt.mjs',
    'scripts/eval/neighbour-leaf-test.mjs',
    'scripts/eval/repeat-instability-draw.mjs',
    'scripts/eval/suda-sol/make-pilot.mjs',
  ]);
  const LOSSY = /[\w)\]]\s*\*\s*1103515245|1103515245\s*\*\s*[\w(]/;
  const root = path.resolve(__dirname, '../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'results' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(mjs|cjs|js|ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };

  it('no script outside the frozen list multiplies by the LCG constant in double arithmetic', () => {
    const offenders = ['scripts', 'src'].flatMap((d) => walk(path.join(root, d)))
      .filter((f) => LOSSY.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f))
      .filter((f) => !FROZEN.has(f));
    expect(offenders).toEqual([]);
  });

  it('every frozen file still exists and still carries it (drop the entry when the file is fixed or removed)', () => {
    for (const f of FROZEN) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
      expect(LOSSY.test(fs.readFileSync(path.join(root, f), 'utf8')), f).toBe(true);
    }
  });
});
