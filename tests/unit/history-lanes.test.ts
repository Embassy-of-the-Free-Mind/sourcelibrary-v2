// The sense chart on a conceptual history page (content/lanes.json) places claims by hand and draws everything else
// from the claims files. A re-import can drop a claim that the audit has since disputed; the page would then quietly
// lose a dot, and a lane's first or last dot is what draws its line. This fails instead, so the placement gets looked at.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/app/explore/histories/content');
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));

type Dot = { c: string; id: string; who: string; date: number };
type Lane = { key: string; dots: Dot[] };
const charts = Object.entries(read('lanes.json').concepts as Record<string, { lanes: Lane[] }>);

describe('history sense lanes', () => {
  for (const [concept, chart] of charts) {
    it(`${concept}: every placed claim is one the site shows`, () => {
      const missing = chart.lanes
        .flatMap((l) => l.dots)
        .filter((d) => !(read(`${d.c}-claims.json`) as { id: string }[]).some((x) => x.id === d.id))
        .map((d) => `${d.c}:${d.id}`);
      expect(missing).toEqual([]);
    });

    it(`${concept}: each lane runs forward in time, and no claim is placed twice`, () => {
      for (const lane of chart.lanes) {
        const dates = lane.dots.map((d) => d.date);
        expect(dates).toEqual([...dates].sort((a, b) => a - b));
      }
      const keys = chart.lanes.flatMap((l) => l.dots.map((d) => `${d.c}:${d.id}`));
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});
