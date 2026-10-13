// PRIOR ART: scripts/audit/convergent-audit-weekly.mjs (the #6420 weekly audit: it runs its commands at the top
// level, so nothing in it can be imported by a test) and scripts/eval/second-reader/second-reader.mjs cli-assemble
// (writes assemble.json: how many replies were written, with no reason for the ones that were not). The pure parts
// both the weekly audit and the #6203 cross-family run need: why a reader has no verdicts, and agreement per kind.
import { binaryAgreement } from '../eval/lib/agreement-stats.mjs';
import { KINDS, INVENTING_KINDS, kindOfFinding } from '../lib/review-vocabulary.mjs';
import { locate, normSpan, OMISSION_RE, OMISSION_CLASSES } from '../eval/second-reader/lib.mjs';

/** How run-cli-arm.py classes an attempt in a row's `error` ("quota: …", "timeout: …", "exit_1: …"). */
const errorClass = (row) => (row?.error ? String(row.error).split(':')[0].trim() : row?.blocked ? 'safety_filter' : row?.empty ? 'empty' : null);

/**
 * Why a CLI reader has the verdicts it has. Pure: pass what the run left on disk.
 *   uids       the request uids (requests.jsonl)
 *   rows       cli-out.jsonl rows, in file order (the last row per uid wins, as cli-assemble reads it)
 *   quotaText  QUOTA.txt beside cli-out.jsonl, or '' (run-cli-arm.py writes it when a quota error stops the run)
 *   reviewed   uids whose review file was written AND validated (the scorer's own count)
 * Returns { requested, read, not_run, failed: { class: n }, unparsable, quota_stopped, quota_at, models, ok, why }.
 * `why` is one plain sentence when the reader is incomplete, else null. The 2026-10-12 run posted "Gemini 0" and a
 * row of dashes with no reason: the account's quota was out, the runner stopped on the first call, and nothing said so.
 */
export function readerStatus({ uids, rows = [], quotaText = '', reviewed = [] }) {
  const last = new Map();
  for (const r of rows) if (r && r.uid) last.set(r.uid, r);
  const done = new Set(reviewed);
  const failed = {}, models = new Set();
  let notRun = 0, unparsable = 0;
  for (const u of uids) {
    const r = last.get(u);
    if (r?.model) models.add(r.model);
    if (done.has(u)) continue;
    if (!r) { notRun++; continue; }
    if (r.text) { unparsable++; continue; }
    const c = errorClass(r) ?? 'empty';
    failed[c] = (failed[c] || 0) + 1;
  }
  const quotaAt = (String(quotaText).match(/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+/m) || [null])[0];
  const quotaStopped = !!quotaAt || (failed.quota || 0) > 0;
  const read = uids.filter((u) => done.has(u)).length;
  const parts = [];
  if (quotaStopped) parts.push(`the CLI account's quota was exhausted${quotaAt ? ` (first refusal ${quotaAt.slice(0, 16).replace('T', ' ')} UTC)` : ''}, so the runner stopped${notRun ? ` with ${notRun} pages not attempted` : ''}`);
  else if (notRun) parts.push(`${notRun} pages were never attempted (the runner did not run or stopped early)`);
  for (const [c, n] of Object.entries(failed)) if (c !== 'quota') parts.push(`${n} ended ${c.replace('_', ' ')}`);
  if (unparsable) parts.push(`${unparsable} replies could not be parsed as a review`);
  const ok = read === uids.length;
  return { requested: uids.length, read, not_run: notRun, failed, unparsable, quota_stopped: quotaStopped, quota_at: quotaAt, models: [...models], ok,
    why: ok ? null : `read ${read} of ${uids.length}: ${parts.join('; ') || 'no reply rows were found'}` };
}

/** A reader counts toward a rate or an agreement figure only when it read at least this share of the pages. */
export const MIN_READ_SHARE = 0.8;

const allErrors = (p) => [...(p?.ocr_errors || []), ...(p?.tr_errors || []), ...(p?.other || [])].filter((e) => e && typeof e === 'object');
/** The kinds of a page review's SERIOUS findings (the reader's own kind, else the class default), plus wrong_leaf for right_page 'no'. */
export function seriousKinds(p) {
  if (!p) return [];
  return [...new Set([...allErrors(p).filter((e) => e.severity === 'serious').map(kindOfFinding).filter(Boolean), ...(p.right_page === 'no' ? ['wrong_leaf'] : [])])];
}
export const isSeriousPage = (p) => !!p && (allErrors(p).some((e) => e.severity === 'serious') || p.right_page === 'no');

/**
 * Agreement between two readers over the pages BOTH read, per kind and overall. `a`, `b`: Map(page key → review).
 * Each line: { n, a_yes, b_yes, both, raw, kappa } where kappa is Cohen's, null when neither or both readers are
 * constant (no variance to agree about: say "not estimable", never 0 or 1).
 *   any_serious   a serious finding of any kind
 *   not_on_leaf   any kind in INVENTING_KINDS
 *   <kind>        a serious finding of that kind
 */
export function kindAgreement(a, b) {
  const keys = [...a.keys()].filter((k) => b.has(k));
  const line = (pred) => {
    const pairs = keys.map((k) => [pred(a.get(k)), pred(b.get(k))]);
    const n = pairs.length, ay = pairs.filter(([x]) => x).length, by = pairs.filter(([, y]) => y).length;
    if (!n) return { n: 0, a_yes: 0, b_yes: 0, both: 0, raw: null, kappa: null };
    const r = binaryAgreement(pairs);
    return { n, a_yes: ay, b_yes: by, both: pairs.filter(([x, y]) => x && y).length, raw: r.observed, kappa: Number.isFinite(r.kappa) ? r.kappa : null };
  };
  return {
    any_serious: line(isSeriousPage),
    not_on_leaf: line((p) => seriousKinds(p).some((k) => INVENTING_KINDS.includes(k))),
    ...Object.fromEntries(KINDS.map((k) => [k, line((p) => seriousKinds(p).includes(k))])),
  };
}

// ── planted controls (#6203): a neighbouring leaf, a dropped line, a flipped negation ────────────────────────
/** The kind a reader should name for each control (scripts/eval/cross-family-6203/run.mjs plants them). */
export const CONTROL_KIND = { wrong_leaf: 'wrong_leaf', dropped: 'omission', negation: 'mistranslation' };

/**
 * Did a reader's page review catch a planted control? { detected, serious, kind_named, missing }. Pure.
 *   wrong_leaf  right_page 'no', ocr_score 1, or a finding of kind wrong_leaf / carry_over
 *   dropped     a translation finding that names an omission (kind, class T1/T9/O5, or the #6338 wording)
 *   negation    a translation finding whose quoted English overlaps the planted sentence
 */
export function caughtControl(control, page, plantedTranslation) {
  if (!page) return { detected: false, serious: false, kind_named: false, missing: true };
  const all = [...(page.ocr_errors || []).map((e) => ({ ...e, list: 'ocr' })), ...(page.tr_errors || []).map((e) => ({ ...e, list: 'tr' })), ...(page.other || []).map((e) => ({ ...e, list: 'other' }))];
  let hits;
  if (control.class === 'wrong_leaf') {
    hits = all.filter((e) => ['wrong_leaf', 'carry_over'].includes(kindOfFinding(e)));
    if (page.right_page === 'no' || page.ocr_score === 1) return { detected: true, serious: true, kind_named: page.right_page === 'no' || hits.length > 0, missing: false };
  } else if (control.class === 'dropped') {
    hits = all.filter((e) => e.list !== 'ocr' && (e.kind === 'omission' || OMISSION_CLASSES.has(String(e.class)) || OMISSION_RE.test(`${e.problem ?? ''}`)));
  } else {
    const sp = normSpan(plantedTranslation, control.span);
    hits = all.filter((e) => { if (e.list === 'ocr') return false; const iv = e.english ? locate(e.english, plantedTranslation) : null; return iv && sp && iv[0] <= sp[1] && sp[0] <= iv[1]; });
  }
  return { detected: hits.length > 0, serious: hits.some((h) => h.severity === 'serious'), kind_named: hits.some((h) => kindOfFinding(h) === CONTROL_KIND[control.class]), missing: false };
}

