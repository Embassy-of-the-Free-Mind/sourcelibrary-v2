/**
 * Confirmed copy pairs — the one loader for "is book X a confirmed copy of book K?" (#5689).
 *
 * PRIOR ART: src/lib/search/work-grouping.ts groups by work for search and says confirmed
 * pairs MAY join, but it has no evidence source; scripts/lib/text-copy-comparator.mjs scores
 * pairs but does not decide them. Nothing read the committed copy-verdict evidence before this.
 *
 * Reads the committed evidence in scripts/identity-evidence/:
 *   collection-copies-<date>.jsonl             visual verdicts with provenance (row: "pair")
 *   collection-copies-<date>.comparator.jsonl  #4285 comparator scores, one row per pair
 *
 * A pair is CONFIRMED only when all of these hold:
 *   - the visual reviewer said `copies`, and the pair's status is not `reversed`;
 *   - AND either the comparator says `same_printing`, or the pair was checked by eye
 *     and the comparator does NOT say `different`.
 * A comparator `different` vetoes a by-eye "consistent" — on 2026-10-03, 18 of 65 by-eye
 * pairs disagreed with the text and wait for a second look (#5689). `gray` with no by-eye
 * check is not confirmed.
 *
 * Callers: the enrich worker's collection tagger (Phase 7.6), which refuses to add a copy to a
 * collection that already holds its keeper, and scripts/maintenance/apply-collection-copy-keepers.mjs.
 * Read-only. A missing evidence directory yields an empty set (no skips) — the tagger then
 * behaves exactly as it did before this guard existed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVIDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../identity-evidence');
const VERDICT_FILE = /^collection-copies-\d{4}-\d{2}-\d{2}\.jsonl$/;

const pairKey = (copyId, keeperId) => `${copyId}|${keeperId}`;

/** The rule, on one verdict row and its comparator row (may be undefined). */
export function confirmPair(verdict, comparator) {
  if (verdict?.row !== 'pair') return { confirmed: false, reason: 'not a pair row' };
  if (verdict.reviewer?.verdict !== 'copies') return { confirmed: false, reason: 'visual verdict is not copies' };
  if (verdict.status === 'reversed') return { confirmed: false, reason: 'reversed' };
  const cv = comparator?.verdict ?? null;
  if (cv === 'same_printing') return { confirmed: true, basis: 'comparator', comparator_verdict: cv };
  if (verdict.spot_check && cv !== 'different') return { confirmed: true, basis: 'by-eye', comparator_verdict: cv };
  return { confirmed: false, reason: cv ? `comparator ${cv}${verdict.spot_check ? ' (vetoes by-eye)' : ''}` : 'no comparator score and no by-eye check', comparator_verdict: cv };
}

/**
 * Build the confirmed set from parsed rows. `source` labels where the rows came from.
 * Returns { pairs, rejected, keepersOfCopy: Map<copy_id, pair[]> }.
 */
export function buildConfirmedCopies(verdictRows, comparatorRows, source = null) {
  const scores = new Map();
  for (const c of comparatorRows || []) scores.set(pairKey(c.copy_id, c.keeper_id), c);
  const pairs = [], rejected = [];
  for (const v of verdictRows || []) {
    if (v?.row !== 'pair') continue;
    const c = scores.get(pairKey(v.copy_id, v.keeper_id));
    const d = confirmPair(v, c);
    const rec = {
      copy_id: v.copy_id, keeper_id: v.keeper_id, ...d,
      comparator_score: c?.score ?? null, comparator_version: c?.comparator_version ?? null,
      source,
    };
    (d.confirmed ? pairs : rejected).push(rec);
  }
  const keepersOfCopy = new Map();
  for (const p of pairs) {
    if (!keepersOfCopy.has(p.copy_id)) keepersOfCopy.set(p.copy_id, []);
    keepersOfCopy.get(p.copy_id).push(p);
  }
  return { pairs, rejected, keepersOfCopy };
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/** Load every collection-copies evidence file in `dir` (default: the committed one). */
export function loadConfirmedCopies({ dir = EVIDENCE_DIR } = {}) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => VERDICT_FILE.test(f)).sort(); } catch { /* no evidence on this checkout */ }
  const all = { pairs: [], rejected: [], keepersOfCopy: new Map(), files: [] };
  for (const f of files) {
    const cmpFile = path.join(dir, f.replace(/\.jsonl$/, '.comparator.jsonl'));
    const cmp = fs.existsSync(cmpFile) ? readJsonl(cmpFile) : [];
    const built = buildConfirmedCopies(readJsonl(path.join(dir, f)), cmp, f);
    all.pairs.push(...built.pairs);
    all.rejected.push(...built.rejected);
    for (const [k, v] of built.keepersOfCopy) all.keepersOfCopy.set(k, [...(all.keepersOfCopy.get(k) || []), ...v]);
    all.files.push(f);
  }
  return all;
}

/**
 * Tagger guard: which of `slugs` must NOT be added to book `bookId`?
 * `keeperCollections` maps keeper id → that keeper's current `collections` (visible keepers
 * only — a hidden keeper is not on the grid, so its copy may take the place).
 * Returns { keep: string[], skipped: [{ slug, keeper_id, basis, source }] }.
 */
export function copyGuard(bookId, slugs, confirmed, keeperCollections) {
  const keepers = confirmed?.keepersOfCopy?.get(bookId) || [];
  if (!keepers.length) return { keep: [...slugs], skipped: [] };
  const keep = [], skipped = [];
  for (const slug of slugs) {
    const hit = keepers.find((k) => (keeperCollections.get(k.keeper_id) || []).includes(slug));
    if (hit) skipped.push({ slug, keeper_id: hit.keeper_id, basis: hit.basis, source: hit.source });
    else keep.push(slug);
  }
  return { keep, skipped };
}
