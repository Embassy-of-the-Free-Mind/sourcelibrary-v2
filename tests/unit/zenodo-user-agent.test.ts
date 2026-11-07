import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Every file that calls Zenodo's API must send a User-Agent.
 *
 * Zenodo's firewall answers Node's default User-Agent with 403 "Access to this resource has been restricted
 * due to unusual traffic from your network" (measured 2026-10-26: the same token got 403 bare and 200 with a
 * named User-Agent). The page reads like a network ban, so the cause is easy to misdiagnose. src/lib/zenodo.ts
 * and batch-mint-doi.mjs already sent one; deposit-ft-dataset.mjs and export-lemma-datasets.mjs did not, and
 * the first failed a real deposit. This sweeps the tracked files instead of trusting each new caller to know.
 */

const ROOT = path.resolve(__dirname, '../..');
const callers = execSync("git grep -l -E 'zenodo\\.org/api' -- 'scripts/*.mjs' 'scripts/**/*.mjs' 'src/**/*.ts'", { cwd: ROOT })
  .toString().split('\n').filter(Boolean);

describe('Zenodo API callers send a User-Agent', () => {
  it('finds the known callers (the sweep itself works)', () => {
    expect(callers).toContain('src/lib/zenodo.ts');
    expect(callers).toContain('scripts/eval/deposit-ft-dataset.mjs');
  });

  for (const f of callers) {
    it(f, () => {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      if (!/fetch\(/.test(src)) return; // names the URL without calling it
      expect(src, `${f} calls Zenodo with fetch() but sends no User-Agent`).toMatch(/['"]User-Agent['"]\s*:/);
    });
  }
});
