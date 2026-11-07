// PRIOR ART: scripts/eval/confidence-7866/lib.mjs (OUT/arg conventions, seeds fixed up front) and
// scripts/eval/latin-strata-7947/lib.mjs (claim ids the second reader keys back onto) — this file holds only #7991's
// own constants; the instruments are imported from those studies, not copied.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'sa-gr-served-7991'));
/** Fixed before the draw. */
export const SEED = 7991;
export const BOOT_SEED = 79910;
/** Books per stratum (#7991: 30 Sanskrit print/manuscript, 40 Greek print/manuscript × before/after 1600). */
export const ALLOC = Object.freeze({
  Sanskrit: { print: 15, manuscript: 15 },
  Greek: { 'print|before 1600': 10, 'print|1600 and later': 10, 'manuscript|before 1600': 10, 'manuscript|1600 and later': 10 },
});
/** Stable claim id for one defect of one lane of one page: the second reader's key. */
export const claimId = (pageId, lane, i) => `${pageId}:${lane}:${i}`;
