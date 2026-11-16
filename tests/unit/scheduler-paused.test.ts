import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain .mjs worker, no types
import { WORKERS, pauseExemptWorkers } from '../../scripts/workers/scheduler.mjs';

// #5492: under a full stop the scheduler used to start nothing, and nothing else collects Gemini
// batches on main, so a pause longer than 48h threw away batches already paid for. The collector
// now runs while paused. The guard here is the other half: nothing that SPENDS may join it.
const perimeter = readFileSync('scripts/audit/spend-perimeter.mjs', 'utf8');

function perimeterEntry(cmd: string): string | null {
  const file = cmd.match(/scripts\/\S+?\/([\w.-]+\.m?[jt]s)/)?.[1];
  if (!file) return null;
  const at = perimeter.indexOf(`match: '${file}'`);
  if (at < 0) return null;
  return perimeter.slice(at, perimeter.indexOf('}', at));
}

describe('scheduler under a full stop (#5492)', () => {
  it('still runs the batch collector', () => {
    expect(pauseExemptWorkers(WORKERS).map((w: { name: string }) => w.name)).toContain('batch-collector');
  });

  it('runs only workers the spend perimeter classifies as non-spenders', () => {
    const exempt = pauseExemptWorkers(WORKERS);
    expect(exempt.length).toBeGreaterThan(0);
    for (const w of exempt) {
      const entry = perimeterEntry(w.cmd);
      expect(entry, `${w.name} has no spend-perimeter entry`).not.toBeNull();
      expect(entry, `${w.name} is a spender and must not run while paused`).toMatch(/spends:\s*false/);
    }
  });

  it('exempts nothing else by accident', () => {
    expect(pauseExemptWorkers([{ name: 'x' }, { name: 'y', runsWhilePaused: 'yes' }, { name: 'z', runsWhilePaused: true }]))
      .toEqual([{ name: 'z', runsWhilePaused: true }]);
  });
});
