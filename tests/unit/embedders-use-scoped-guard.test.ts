import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Both embedding workers must consult the SCOPED spend guard (#4865).
//
// With the unscoped `budgetAllowsDispatch` they can only see the global daily
// dial, and the dial is spent by OCR and translation before they run — so
// every scheduled run is refused and a scope envelope cannot fund them,
// because the envelope lane is unreachable from that function. Measured
// 2026-09-15: four consecutive embed-gemini runs logged "CEILING REACHED"
// ($11.75 / $25.23 / $29.60 / $36.67 against $5) and the image cron the same,
// while 23,200 live books held OCR text and no page vector and
// gallery_text_embeddings last gained a row on 9 August.
//
// The failure is silent on every read path — an unembedded book and a book
// nothing matches both return an empty list — so it has to be pinned here.
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const WORKERS = [
  'scripts/workers/embed-gemini.mjs',
  'scripts/workers/image-embeddings-cron.mjs',
];

describe('embedding workers can reach the scope-envelope lane', () => {
  for (const w of WORKERS) {
    it(`${w} uses budgetAllowsDispatchScoped`, () => {
      const src = read(w);
      expect(src).toContain('budgetAllowsDispatchScoped');
      // The unscoped guard must not survive anywhere in the file: importing it
      // and calling it on one path is how this regressed in the first place.
      expect(src).not.toMatch(/\bbudgetAllowsDispatch\b(?!Scoped)/);
    });
  }

  it('embed-gemini confines the run to the envelope books rather than widening', () => {
    const src = read('scripts/workers/embed-gemini.mjs');
    // Narrowing must intersect what the mode branch chose. A plain assignment
    // to pageQuery.book_id before the branches would be overwritten by them;
    // one after them that ignored the existing value would turn a --book run
    // into a corpus run.
    expect(src).toMatch(/ENVELOPE_IDS/);
    expect(src).toMatch(/narrowed = existing\.\$in\.filter/);
  });
});
