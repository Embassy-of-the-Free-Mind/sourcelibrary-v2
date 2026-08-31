/**
 * Every LIVE writer of the book page counters must use the canonical module.
 *
 * This is the check that three separate incidents wanted and did not have. The rule
 * — count visible pages only, exclude blank placeholders from the numerator — has
 * been written down, centralised in `page-counts`, and pinned by
 * `page-counts.test.ts` since #3293. None of that helps a writer that never calls it,
 * and on 2026-08-31 three did not:
 *
 *  - `recount-page-stats.mjs` had a private pipeline whose numerator counted blank
 *    placeholders; it wrote 3–10 too many translated pages onto six books.
 *  - `job-completion.ts` had one that ALSO dropped the `page_number > 0` filter. On
 *    60 random live books it disagreed 30% of the time; on "Phantasms of the Living,
 *    Vol. I" (663 visible pages, 1,514 soft-hidden) it would have written
 *    `pages_translated: 2175` against `pages_count: 663`.
 *  - `batch-translate-async/route.ts` would have left `pages_translatable` stale
 *    while updating its three siblings.
 *
 * A doc cannot catch that; a list can. This test enumerates the request-path and
 * worker files that write these counters and asserts each one imports the module.
 *
 * ADDING A WRITER: import `page-counts` and use `buildVisiblePageCountPipeline` (or
 * `countVisiblePageStats` if you already hold the pages).
 *
 * The 34 pre-existing divergent writers are captured in
 * `tests/fixtures/page-counter-writers-baseline.json` — a ratchet that may shrink and
 * must not grow (#4499). If a file genuinely writes a counter without deriving it —
 * zeroing on clear, say — it still belongs in the baseline with that noted, because
 * "does not derive" is a claim someone should be able to re-check.
 *
 * Negative control, run 2026-08-31: adding a file that `$set`s `pages_translated`
 * without importing the module turns both assertions red and names the file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COUNTERS = ['pages_count', 'pages_ocr', 'pages_translated', 'pages_translatable'];

/** Scratch, archived and one-off migration scripts are not live writers. */
const SKIP_PATH = /node_modules|\.next|\.claude|_archived|\/_tmp|\/tmp-|scripts\/migration\//;

/**
 * The known-divergent writers, captured 2026-08-31. A RATCHET, not an approval: the
 * test below asserts this list never grows. Burning it down is #4499.
 *
 * Two of these were confirmed to carry the exact defect (`detect-ghost-pages.ts`
 * counts `translation.data` without excluding blank placeholders); the rest are
 * unreviewed and are listed as suspects, not as absolved.
 */
const BASELINE: string[] = JSON.parse(
  readFileSync('tests/fixtures/page-counter-writers-baseline.json', 'utf8'),
).files;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (SKIP_PATH.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|ts|tsx|js)$/.test(p)) out.push(p);
  }
  return out;
}

/** Read a balanced `{ … }` starting at `open`, skipping string and template literals. */
function readBraces(src: string, open: number): string | null {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { i += 2; continue; } i++; }
      continue;
    }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(open + 1, i); }
  }
  return null;
}

function counterWriters(): { file: string; counters: string[]; usesLib: boolean }[] {
  const files = [...walk('scripts'), ...walk('src')];
  const rows: { file: string; counters: string[]; usesLib: boolean }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!/collection\(\s*['"]books['"]\s*\)/.test(src)) continue;
    const hits = new Set<string>();
    const re = /\$set(?:OnInsert)?\s*:\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const body = readBraces(src, m.index + m[0].length - 1);
      if (!body) continue;
      for (const c of COUNTERS) {
        if (new RegExp(`(^|[^\\w.])${c}\\s*:`).test(body)) hits.add(c);
      }
    }
    if (hits.size) rows.push({ file, counters: [...hits], usesLib: /page-counts/.test(src) });
  }
  return rows;
}

describe('book page-counter writers', () => {
  it('every live writer derives its counters from the canonical module', () => {
    const known = new Set(BASELINE);
    const novel = counterWriters()
      .filter(r => !r.usesLib)
      .filter(r => !known.has(r.file))
      .map(r => `${r.file} (writes ${r.counters.join(', ')})`);

    expect(novel, [
      'NEW files recompute book page counters without importing the canonical module.',
      'A private count WILL drift — three did, and one would have written',
      'pages_translated: 2175 onto a 663-page book. Use buildVisiblePageCountPipeline',
      'or countVisiblePageStats instead.',
      '',
      ...novel,
    ].join('\n')).toEqual([]);
  });

  it('the baseline shrinks or holds — never grows', () => {
    // The ratchet. A file leaving the baseline (fixed) is fine; the list gaining one
    // without the fixture being edited in the same commit is the regression.
    const stillDivergent = counterWriters().filter(r => !r.usesLib).map(r => r.file);
    const notInBaseline = stillDivergent.filter(f => !BASELINE.includes(f));
    expect(notInBaseline).toEqual([]);
    expect(BASELINE.length).toBeLessThanOrEqual(34);
  });

  it('finds writers at all (guards against the matcher silently matching nothing)', () => {
    // Without this, a broken matcher would make the test above pass vacuously — the
    // exact failure mode that let three divergent writers exist under a green suite.
    const rows = counterWriters();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.some(r => r.usesLib)).toBe(true);
  });
});
