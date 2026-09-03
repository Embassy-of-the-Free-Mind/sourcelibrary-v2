import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

/**
 * An archiver that cannot say what it stored, and what was available, has not
 * finished archiving (#4406).
 *
 * "Do we hold the full-resolution master?" compares two numbers: the width we
 * stored, and the width the source said was native. The corpus records the
 * first for 66.7% of pages and the second for **7.7%**, so the question was
 * only answerable by re-probing the institution — slowly, in small samples,
 * from servers that have blocked us three times in 48 hours. Asked three ways
 * on 2026-08-30 it answered ~11%, 42.8% and 63.8% of pages below master.
 *
 * The 7.7% carrying a native width were almost exactly the pages
 * `archive-eap.mjs` wrote — the one worker that both tile-stitches to native
 * AND records `iiif_info`. Measured over that subset the corpus read 95.2%
 * full-resolution: true of the subset, meaningless as a corpus figure. **The
 * population we could measure was the population we had archived correctly.**
 * No sampling strategy fixes that; only recording at write time does.
 *
 * The two halves are not equally recoverable, which is why they are asserted
 * separately below:
 *   - STORED width can be backfilled from our own R2 whenever we like
 *     (scripts/maintenance/backfill-stored-dimensions.mjs). Cheap, ours, safe.
 *   - NATIVE width can only be captured at fetch time. Recovering it later
 *     means asking the institution again, which is the cost this exists to
 *     stop paying — and on the seven SILENT_CAP_HOSTS the late answer is
 *     wrong anyway, because the cap masquerades as native.
 *
 * So this is a guard rather than a doc: a new archiver must record, or add
 * itself to NATIVE_WIDTH_DEBT with a reason. Silence is the failure mode this
 * entire class of bug is made of.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** Directories whose scripts write page masters. */
const ARCHIVER_DIRS = ['scripts/workers', 'scripts/catalog-coverage', 'scripts/maintenance', 'scripts/migration'];

/**
 * A file is a "page-master writer" if it constructs a page-master R2 key or goes
 * through the shared variant helper.
 *
 * This pattern is TIGHT ON PURPOSE, and its blind spot is named below rather
 * than left implicit. Two looser drafts were tried and both were worse:
 * matching any upload call swept in CSV snapshots, thumbnail generators and
 * blob migrations; matching the string `archived_photo` swept in every audit
 * and watchdog that merely PROJECTS the field. Neither over-match is safe,
 * because a guard that flags twenty innocent files gets an allowlist bolted on
 * and stops meaning anything.
 *
 * The cost of tightness is EXTRA_WRITERS: writers whose key is a variable are
 * invisible to it. archive-ia-bulk.mjs was exactly that — a major writer,
 * recording nothing, missed by the first version of this test.
 */
const WRITES_PAGE_IMAGES = /uploadPageVariants|storagePut\(\s*`?pages\/|uploadToR2\(\s*`?(archived|pages)\//;

/**
 * Known page-master writers the pattern above cannot see (variable key paths).
 * Verified by hand. If you add a writer that builds its key in a variable, add
 * it here — the alternative is that it is silently exempt, which is the exact
 * failure this whole file exists to prevent.
 */
const EXTRA_WRITERS = [
  'scripts/maintenance/archive-ia-bulk.mjs',  // key built into a const, then uploadToR2(key, buf)
];

/** Records the dimensions of the object it just wrote. */
const RECORDS_STORED = /image_width|displayWidth|dimensionFields\(/;

/**
 * Records what the SOURCE said was available — the half that cannot be backfilled.
 *
 * Deliberately NOT matching `fetchIiifInfo`: the first draft of this guard did,
 * and the negative control caught it staying green after the recording was
 * deleted, because the import line still matched. A detector that fires on an
 * import is asserting that a symbol is in scope, not that a value is written.
 * See invariants/tests-that-are-not-guards.md.
 */
const RECORDS_NATIVE = /['"`]?iiif_info\.width['"`]?\s*[:=]|iiif_info\.width'\]\s*=|dimensionFields\(/;

/**
 * Only writers that actually FETCH from a remote source can record a native
 * width. A repair pass re-deriving from an image we already hold has nobody to
 * ask, and the shared variant helper never fetches at all — asserting against
 * them would be a list to maintain rather than a property to hold.
 */
const FETCHES_FROM_SOURCE = /rateLimitedFetch|downloadImage|await fetch\(|downloadPdf/;

/**
 * Writers that fetch from a remote source and do NOT yet record the native
 * width. Real debt from #4406, kept in code rather than a checklist so it is
 * visible to whoever next opens these files, and shrinks by deletion.
 *
 * Not on this list, deliberately: writers that re-derive from an image we
 * already hold (repair/regeneration passes). They have no source to ask, and
 * the native width is a property of the original acquisition, not of a re-encode.
 */
const NATIVE_WIDTH_DEBT = new Set([
  'scripts/workers/archive-bulk.mjs',
  'scripts/workers/archive-erara.mjs',      // PDF rasterization at PDF_DPI=200; no IIIF fetch at all
  'scripts/maintenance/repair-bulk-jp2-offset.mjs',  // one-off #3368 repair; refetches, but records stored width only
  'scripts/maintenance/archive-ia-bulk.mjs',        // archive.org is not a silent capper: /full/full/ is the master, no native width to chase
]);

function listArchivers(): string[] {
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
      // scripts/workers/lib/ holds shared helpers (display-image.mjs), not
      // archivers. They produce the bytes; the caller owns the page document.
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

const archivers = [...new Set([...listArchivers(), ...EXTRA_WRITERS])].sort();
const read = (f: string) => readFileSync(path.join(PROJECT_ROOT, f), 'utf8');

describe('archivers record what they stored and what was available (#4406)', () => {
  it('finds the page-image writers at all (guards the guard)', () => {
    // If the detector matched nothing, every assertion below would pass
    // vacuously — the failure mode that makes a test a decoration.
    expect(archivers.length).toBeGreaterThan(5);
    expect(archivers).toContain('scripts/catalog-coverage/archive-acquired.ts');
    expect(archivers).toContain('scripts/workers/archive-eap.mjs');
    // The blind-spot list must actually be reachable, or it is decoration too.
    expect(archivers).toContain('scripts/maintenance/archive-ia-bulk.mjs');
  });

  it('every page-image writer records the dimensions it stored', () => {
    const silent = archivers.filter((f) => !RECORDS_STORED.test(read(f)));
    expect(
      silent,
      'These write a page image but never record its size, so nothing downstream can tell what\n' +
      'we hold without re-reading the object. Set image_width/image_height — the buffer is\n' +
      'already decoded, so it is free. See scripts/catalog-coverage/archive-acquired.ts.\n\n  ' +
      silent.join('\n  '),
    ).toEqual([]);
  });

  it('writers that fetch from a source record the native width, or declare the debt', () => {
    const silent = archivers.filter((f) => {
      const src = read(f);
      if (!FETCHES_FROM_SOURCE.test(src)) return false; // nothing to ask
      return !RECORDS_NATIVE.test(src) && !NATIVE_WIDTH_DEBT.has(f);
    });
    expect(
      silent,
      'These fetch from an institution but never record what the source said was available, so\n' +
      '"did we get the master?" can only be answered by asking that institution again — which\n' +
      'is slow, rate-limited, and on the seven SILENT_CAP_HOSTS returns the cap as if it were\n' +
      'native. Record iiif_info.width/height at fetch time, as archive-acquired.ts and\n' +
      'archive-eap.mjs do. If this writer has no source to ask (a repair pass over an image we\n' +
      'already hold), add it to NATIVE_WIDTH_DEBT with that reason.\n\n  ' +
      silent.join('\n  '),
    ).toEqual([]);
  });

  it('the debt list has no stale entries', () => {
    // A file since fixed, or renamed away, must leave the list — otherwise the
    // list stops describing reality and starts excusing it.
    const stale: string[] = [];
    for (const f of NATIVE_WIDTH_DEBT) {
      let src: string;
      try {
        src = read(f);
      } catch {
        stale.push(`${f} (no longer exists)`);
        continue;
      }
      if (RECORDS_NATIVE.test(src)) stale.push(`${f} (now records native width — delete this line)`);
      else if (!FETCHES_FROM_SOURCE.test(src)) stale.push(`${f} (fetches nothing — not debt; delete this line)`);
    }
    expect(stale, `Stale NATIVE_WIDTH_DEBT entries:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
