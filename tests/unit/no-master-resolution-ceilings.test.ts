import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * We do not impose resolution ceilings on masters (#4406).
 *
 * A master is the copy that cannot be re-derived. Silently downsizing one before
 * storage is the only mistake in this system that is both permanent and
 * invisible: the stored file is a perfectly good JPEG, nothing errors, no counter
 * moves, and the discarded pixels are gone the moment the source is.
 *
 * Three of these were found in one afternoon, each individually reasonable and
 * none of them ever revisited:
 *
 *   archive-bulk.mjs      MAX_DIMENSION = 3000    (no comment at all)
 *   archive-erara.mjs     PDF_DPI = 200           "Good balance of quality vs size"
 *   batch-split-bph.mjs   CROPPED_MAX_WIDTH = 2000 — and the crop IS the master
 *                          for a split book, on BPH, which is tier 0 with no
 *                          re-acquisition path at all.
 *
 * The distinction this test encodes: a DERIVATIVE may be capped — that is what a
 * display variant or a thumbnail is for. A MASTER may not. So it only inspects
 * the resize that produces the bytes written to a master key.
 *
 * A pathological-size guard is fine and expected — but it must SKIP loudly, not
 * shrink quietly. A gap someone can see beats a success that is silently worse.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ARCHIVER_DIRS = ['scripts/workers', 'scripts/catalog-coverage', 'scripts/maintenance', 'scripts/migration'];

/** Writers that produce a page master. Same shape as archivers-record-dimensions. */
const WRITES_PAGE_IMAGES = /uploadPageVariants|storagePut\(\s*`?pages\/|uploadToR2\(\s*`?(archived|pages)\//;

/**
 * A downsize applied to the master path: `.resize(` with a literal number, where
 * that number is small enough to cut a real scan.
 *
 * DERIVATIVE_WIDTHS are the sizes this codebase uses for display copies,
 * thumbnails and model inputs. They are legitimate and deliberately ignored —
 * catching them would flag every thumbnail generator and the guard would be
 * allowlisted into meaninglessness within a week.
 */
const DERIVATIVE_WIDTHS = new Set([150, 200, 256, 300, 400, 500, 512, 1024, 1200, 1500]);

/** Above this, a resize is a safety valve rather than a quality ceiling. */
const SAFETY_VALVE_FLOOR = 10000;

/**
 * Master writers whose upload key is a variable, so the pattern above cannot see
 * them. Same blind spot, and same remedy, as archivers-record-dimensions.test.ts:
 * name it rather than let the file be silently exempt.
 */
const EXTRA_WRITERS = [
  'scripts/workers/batch-split-bph.mjs',       // uploadToR2(r2, key, buf) — key is arg 2
  'scripts/maintenance/archive-ia-bulk.mjs',   // key built into a const first
];

function listMasterWriters(): string[] {
  const found: string[] = [];
  for (const dir of ARCHIVER_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(path.join(PROJECT_ROOT, dir), { recursive: true } as never) as string[];
    } catch {
      continue;
    }
    for (const rel of entries) {
      if (!/\.(mjs|ts)$/.test(String(rel))) continue;
      if (String(rel).includes('lib/')) continue;
      const repoPath = path.posix.join(dir, String(rel).split(path.sep).join('/'));
      let src: string;
      try {
        src = readFileSync(path.join(PROJECT_ROOT, repoPath), 'utf8');
      } catch {
        continue;
      }
      if (WRITES_PAGE_IMAGES.test(src)) found.push(repoPath);
    }
  }
  return found.sort();
}

/**
 * Strip comments before scanning.
 *
 * Without this the guard flags its own documentation: the comment explaining that
 * archive-bulk USED to call `.resize(3000, 3000, …)` matches the very pattern it
 * is describing. A guard that goes red on prose is one someone disables.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Literal-number resizes in a file that look like a ceiling on a master. */
function ceilingResizes(src: string): number[] {
  const hits: number[] = [];
  for (const m of stripComments(src).matchAll(/\.resize\(\s*(\d{3,5})/g)) {
    const n = Number(m[1]);
    if (DERIVATIVE_WIDTHS.has(n)) continue;   // a display/thumb/model size
    if (n >= SAFETY_VALVE_FLOOR) continue;    // a pathological-size guard
    hits.push(n);
  }
  return hits;
}

const writers = [...new Set([...listMasterWriters(), ...EXTRA_WRITERS])].sort();
const read = (f: string) => readFileSync(path.join(PROJECT_ROOT, f), 'utf8');

describe('no resolution ceilings on masters (#4406)', () => {
  it('finds the master writers at all (guards the guard)', () => {
    expect(writers.length).toBeGreaterThan(5);
    expect(writers).toContain('scripts/workers/archive-bulk.mjs');
    expect(writers).toContain('scripts/workers/batch-split-bph.mjs');
  });

  it('no master writer downsizes to a fixed sub-10000px width', () => {
    const offenders: string[] = [];
    for (const f of writers) {
      const hits = ceilingResizes(read(f));
      if (hits.length) offenders.push(`${f} → .resize(${[...new Set(hits)].join(', ')})`);
    }
    expect(
      offenders,
      'These downsize an image on a path that writes a page MASTER. A master is the copy\n' +
      'that cannot be re-derived, so capping it discards pixels permanently and invisibly —\n' +
      'the stored file is still a valid JPEG and nothing reports a loss.\n\n' +
      'If this is a DERIVATIVE (display/thumb/model input), add its width to\n' +
      'DERIVATIVE_WIDTHS. If it is a pathological-size guard, raise it above\n' +
      `${SAFETY_VALVE_FLOOR} and make it SKIP rather than shrink.\n\n  ` +
      offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the e-rara PDF rasterization is not back below the preservation floor', () => {
    // pdftoppm -r <dpi> is a resolution ceiling that no .resize() call reveals.
    // 200 was the shipped value across 1.92M pages; 400 ppi is the FADGI /
    // Metamorfoze working minimum for reformatted print.
    const src = read('scripts/workers/archive-erara.mjs');
    const m = src.match(/const PDF_DPI = parseInt\(process\.env\.ERARA_PDF_DPI \|\| '(\d+)'/);
    expect(m, 'PDF_DPI is no longer declared in the expected form — re-check this guard').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(400);
  });
});
