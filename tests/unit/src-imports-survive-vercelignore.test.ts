import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';

// .vercelignore removes scripts/eval/results from the production build, and the
// `next-build` PR check does not apply .vercelignore. An import from there passes
// CI and fails only on Vercel: #6128 broke five production builds on 2026-10-09.
describe('src never imports from a folder .vercelignore removes', () => {
  it('has no import of scripts/eval/results', () => {
    const root = path.resolve(__dirname, '../..');
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-n', '-E', "(from|import\\(|require\\() *['\"][^'\"]*scripts/eval/results/", '--', 'src'], { cwd: root, encoding: 'utf8' });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e; // 1 = no match
    }
    expect(hits.trim().split('\n').filter(Boolean)).toEqual([]);
  });
});
