import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * /admin/quality (#5474) is a renderer: every figure, date, issue number, engine and judge name
 * comes from the ops_reports document. A number typed into the page is a number that never
 * updates — the failure this page exists to prevent. This sweeps the renderer's source for the
 * shapes such a literal takes. Layout digits (Tailwind classes, SVG geometry, toFixed precision)
 * are not data and do not match these patterns.
 *
 * Negative control (run 2026-10-01): adding `<span>14.3%</span>` to page.tsx turns
 * "no percentages" red; adding `Gemini` to a label turns "no engine or judge names" red.
 */
const DIR = path.join(process.cwd(), 'src/app/admin/quality');
const files = fs.readdirSync(DIR).filter(f => /\.tsx?$/.test(f));
// Comments may cite issues and explain rules; only code is swept.
const code = (f: string) =>
  fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const RULES: [string, RegExp][] = [
  // 95% names an interval's level, 50%/100% are CSS; any other percentage is a figure.
  ['no percentages', /\b(?!95%|50%|100%)\d+(\.\d+)?\s?%/],
  ['no dates', /\b(19|20)\d\d-\d\d(-\d\d)?\b/],
  ['no issue or PR numbers', /#\d{3,5}\b/],
  ['no CER / identity values (three decimals)', /\b0\.\d{3}\b/],
  ['no sample sizes', /\bn\s?=\s?\d/],
  ['no money', /\$\d/],
  ['no engine or judge names', /\b(gemini|flash-lite|opus|sonnet|claude|yigdzin|kraken|derge|gretil)\b/i],
  ['no script or language names', /\b(latin|greek|han|tibetan|sanskrit|syriac|armenian|hebrew|arabic|chinese)\b/i],
];

describe('/admin/quality renderer holds no figures', () => {
  it('found the renderer files', () => {
    expect(files).toEqual(expect.arrayContaining(['page.tsx', 'QualityCharts.tsx']));
  });
  for (const [name, re] of RULES) {
    it(name, () => {
      const hits = files.flatMap(f => code(f).split('\n').map((l, i) => [f, i + 1, l] as const).filter(([, , l]) => re.test(l)));
      expect(hits.map(([f, i, l]) => `${f}:${i}: ${l.trim().slice(0, 120)}`)).toEqual([]);
    });
  }
});
