/**
 * Inter-method agreement for the first-translation eval harness (#2876).
 *
 * Agreement is the one quality signal that needs NO ground truth: when two
 * independent evidence *families* (catalog lookup vs model-knowledge vs the
 * Claude agent — see `attemptFamily` in ./prior-evidence) reach the same
 * verdict on a book, that concordance is informative on its own, and the books
 * where they disagree are exactly where verification effort should go.
 *
 * Cohen's κ corrects raw agreement for the agreement expected by chance, so it
 * stays honest when one label dominates (a corpus that is ~95% "first" would
 * show 95% raw agreement from two coin-flippers; κ would show ~0).
 *
 * Pure math, no I/O — unit-tested. The inline 3-class κ in
 * `scripts/eval/ft-reliability-report.ts` predates this; new callers use this.
 */

/** Result of comparing two paired label sequences. */
export interface KappaResult {
  /** Number of items both raters labelled (paired, non-empty). */
  n: number;
  /** Observed proportion of exact agreement. */
  po: number;
  /** Agreement expected by chance, from the marginal label frequencies. */
  pe: number;
  /** Cohen's κ = (po − pe) / (1 − pe). NaN when n=0; 1 when pe=1 (degenerate). */
  kappa: number;
  /** Distinct labels seen across both raters. */
  labels: string[];
}

/**
 * Cohen's κ for two raters over the SAME ordered list of items. `a[i]` and
 * `b[i]` are the two raters' labels for item i. Entries where either side is
 * null/undefined/'' are dropped (a rater that didn't rate that item).
 */
export function cohenKappa(
  a: ReadonlyArray<string | null | undefined>,
  b: ReadonlyArray<string | null | undefined>,
): KappaResult {
  if (a.length !== b.length) {
    throw new Error(`cohenKappa: length mismatch ${a.length} vs ${b.length}`);
  }
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x != null && x !== '' && y != null && y !== '') pairs.push([x, y]);
  }
  const n = pairs.length;
  const labels = [...new Set(pairs.flat())].sort();
  if (n === 0) return { n: 0, po: 0, pe: 0, kappa: NaN, labels };

  let agree = 0;
  const rowM: Record<string, number> = {};
  const colM: Record<string, number> = {};
  for (const [x, y] of pairs) {
    if (x === y) agree++;
    rowM[x] = (rowM[x] ?? 0) + 1;
    colM[y] = (colM[y] ?? 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const l of labels) pe += ((rowM[l] ?? 0) / n) * ((colM[l] ?? 0) / n);

  // pe===1 means a single label was used by both raters everywhere → κ
  // undefined; report perfect agreement (po is also 1 in that case).
  const kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe);
  return { n, po, pe, kappa, labels };
}

/** Map of rater-name → (item-id → label). Items absent from a rater are unrated. */
export type RaterLabels = Record<string, Map<string, string>>;

/** Cohen's κ for one pair of raters, restricted to items both rated. */
export interface PairKappa extends KappaResult {
  raterA: string;
  raterB: string;
}

export interface PairwiseAgreement {
  pairs: PairKappa[];
  /** Mean κ across pairs that had ≥1 shared item (ignores NaN pairs). */
  meanKappa: number;
  /** Total distinct items appearing in any pair comparison. */
  itemsCompared: number;
}

/**
 * All pairwise Cohen's κ across ≥2 raters. For each rater pair we line up the
 * items both rated and run {@link cohenKappa}. Returns per-pair κ plus the mean
 * over pairs that shared at least one item. This is the honest way to summarize
 * multi-family agreement when families don't all rate every book (Fleiss κ
 * needs a fixed rater count per item, which we don't have).
 */
export function pairwiseKappa(raters: RaterLabels): PairwiseAgreement {
  const names = Object.keys(raters).sort();
  const pairs: PairKappa[] = [];
  const allItems = new Set<string>();

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const A = raters[names[i]];
      const B = raters[names[j]];
      const a: string[] = [];
      const b: string[] = [];
      for (const [item, la] of A) {
        const lb = B.get(item);
        if (lb != null) {
          a.push(la);
          b.push(lb);
          allItems.add(item);
        }
      }
      const k = cohenKappa(a, b);
      pairs.push({ ...k, raterA: names[i], raterB: names[j] });
    }
  }

  const valid = pairs.filter((p) => p.n > 0 && !Number.isNaN(p.kappa));
  const meanKappa = valid.length
    ? valid.reduce((s, p) => s + p.kappa, 0) / valid.length
    : NaN;

  return { pairs, meanKappa, itemsCompared: allItems.size };
}

/**
 * Qualitative band for a κ value (Landis & Koch, 1977) — for report prose only.
 */
export function kappaBand(k: number): string {
  if (Number.isNaN(k)) return 'n/a';
  if (k < 0) return 'poor';
  if (k < 0.2) return 'slight';
  if (k < 0.4) return 'fair';
  if (k < 0.6) return 'moderate';
  if (k < 0.8) return 'substantial';
  return 'almost perfect';
}
