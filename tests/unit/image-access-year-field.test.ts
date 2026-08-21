import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * #4131 — the image-download gate released pre-1930 books by reading
 * `year_published`, a field ZERO of 104,690 books have. It never fired, and
 * 4,840 public-domain library scans stayed blocked on an `unknown` license.
 *
 * This is an ABSENCE invariant, which is the one case where a source-shape
 * assertion earns its keep (see .claude/docs/invariants/tests-that-are-not-guards.md):
 * the failure mode is re-introducing the dead field name, and re-adding it is
 * exactly what the test catches. It cannot be satisfied by a comment, because
 * comments are stripped before matching.
 */
const repoRoot = join(__dirname, '..', '..');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const GUARDED = [
  'src/lib/purchases.ts',
  'src/app/book/[id]/page.tsx',
];

describe('image-access gate reads a field that exists', () => {
  for (const rel of GUARDED) {
    it(`${rel} does not read year_published`, () => {
      const code = stripComments(readFileSync(join(repoRoot, rel), 'utf8'));
      expect(code).not.toMatch(/year_published/);
    });
  }

  it('purchases.ts still gates on a numeric year below 1930', () => {
    const code = stripComments(readFileSync(join(repoRoot, 'src/lib/purchases.ts'), 'utf8'));
    // The rule itself must survive — deleting it would also make the above pass.
    expect(code).toMatch(/year\s*<\s*1930/);
    expect(code).toMatch(/projection:\s*\{[^}]*\byear:\s*1/);
  });
});
