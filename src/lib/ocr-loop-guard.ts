/**
 * PRIOR ART: scripts/lib/ocr-loop-guard.mjs — this is its TS twin, for the OCR write
 * paths that live in Next.js routes (`/api/books/[id]/batch-ocr-async` and the tenant
 * copy). Same arrangement as `src/lib/r2-key.ts` beside `scripts/lib/r2-key.mjs`, and
 * for the same reason: guarding only the script-side writer left the other half of the
 * corpus unguarded when the identical bug shipped twice in one week (#3362/#3365).
 *
 * Refuse OCR that degenerated into a repetition loop (#4850). The rationale, the
 * calibration and the false-positive classes are documented on the .mjs twin; keep the
 * two in lockstep — `tests/unit/ocr-loop-guard.test.ts` pins their parity.
 */

export const DEFAULT_MIN_BODY = 300;
export const DEFAULT_MIN_RUN = 240;
export const DEFAULT_MIN_SHARE = 0.5;
export const DEFAULT_MIN_REPS = 6;
const MAX_PERIOD = 200;
const RUN_MIN_REPS = 5;
const RUN_MIN_CHARS = 80;
const SCREEN_MAX = 0.35;

/** Elements whose contents describe the page rather than transcribe it. */
const META = ['language', 'page-type', 'script', 'quality', 'scan-quality', 'image-desc',
  'vocab', 'header', 'sig', 'page-num', 'catchword', 'meta', 'warning', 'columns'];

/** The part of an OCR response that claims to be words on the page. */
export function transcriptionBody(data: string): string {
  let out = data || '';
  for (const t of META) {
    out = out.replace(new RegExp(`<${t}[^>]*>[\\s\\S]*?</${t}>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${t}[^>]*/?>`, 'gi'), ' ');
  }
  return out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalise(body: string): string[] {
  return [...body
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\[[^\]\n]{0,40}\]/g, ' ')
    .replace(/([.·・‧…\-—_*=~+])(?:[\s]*\1){3,}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()];
}

function hasContent(unit: string): boolean {
  return /[\p{L}\p{N}]/u.test(unit);
}

export interface PeriodicRun { period: number; chars: number; reps: number; at: number; unit: string }

export function periodicRuns(cp: string[]): PeriodicRun[] {
  const n = cp.length;
  const runs: PeriodicRun[] = [];
  const push = (p: number, end: number, matches: number) => {
    const chars = matches + p;
    const reps = Math.floor(chars / p);
    if (reps < RUN_MIN_REPS || chars < RUN_MIN_CHARS) return;
    const at = end - chars;
    const unit = cp.slice(at, at + p).join('');
    if (!hasContent(unit)) return;
    runs.push({ period: p, chars, reps, at, unit });
  };
  for (let p = 1; p <= Math.min(MAX_PERIOD, Math.floor(n / 2)); p++) {
    let matches = 0;
    for (let i = 0; i + p < n; i++) {
      if (cp[i] === cp[i + p]) { matches++; continue; }
      if (matches) push(p, i + p, matches);
      matches = 0;
    }
    if (matches) push(p, n, matches);
  }
  return runs.sort((a, b) => b.chars - a.chars);
}

export function coveredChars(runs: PeriodicRun[]): number {
  const iv = runs.map(r => [r.at, r.at + r.chars]).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -1;
  for (const [s, e] of iv) {
    if (e <= end) continue;
    total += e - Math.max(s, end);
    end = e;
  }
  return total;
}

export function distinctTrigramShare(cp: string[]): number {
  if (cp.length < 3) return 1;
  const seen = new Set<string>();
  for (let i = 0; i + 3 <= cp.length; i++) seen.add(cp[i] + cp[i + 1] + cp[i + 2]);
  return seen.size / (cp.length - 2);
}

export function guardEnabled(): boolean {
  return String(process.env.OCR_LOOP_GUARD || '').toLowerCase() !== 'off';
}

export interface LoopVerdict {
  refuse: boolean; reason: string; share: number; covered: number; body: number;
  period: number; reps: number; chars: number; unit: string; runs: number;
}

export function loopVerdict(text: string, {
  minBody = DEFAULT_MIN_BODY,
  minRun = DEFAULT_MIN_RUN,
  minShare = DEFAULT_MIN_SHARE,
  minReps = DEFAULT_MIN_REPS,
}: { minBody?: number; minRun?: number; minShare?: number; minReps?: number } = {}): LoopVerdict {
  const empty = { share: 0, covered: 0, period: 0, reps: 0, chars: 0, unit: '', runs: 0 };
  if (!guardEnabled()) return { refuse: false, reason: 'guard_disabled', body: 0, ...empty };

  const cp = normalise(transcriptionBody(text));
  const body = cp.length;
  if (body < minBody) return { refuse: false, reason: 'body_too_short', body, ...empty };
  if (distinctTrigramShare(cp) > SCREEN_MAX) {
    return { refuse: false, reason: 'not_repetitive', body, ...empty };
  }

  const runs = periodicRuns(cp);
  const top = runs[0] || { period: 0, chars: 0, reps: 0, unit: '' };
  const covered = coveredChars(runs);
  const share = covered / body;
  const out = {
    share: +share.toFixed(3), covered, body,
    period: top.period, reps: top.reps, chars: top.chars, unit: top.unit, runs: runs.length,
  };
  if (covered >= minRun && top.reps >= minReps && share >= minShare) {
    return { refuse: true, reason: 'repetition_loop', ...out };
  }
  return { refuse: false, reason: 'repetition_below_threshold', ...out };
}
