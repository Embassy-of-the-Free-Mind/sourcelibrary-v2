/**
 * `--reason="..."` for manual queue scripts — the WHY behind a hand-dispatched job.
 *
 * PRIOR ART: scripts/lib/sweep-log.mjs — records a sweep's verdict about a BOOK as
 * a row in `sweep_log`. Different question: this records why a HUMAN dispatched a
 * processing job, and it belongs on the `jobs` row itself (that is what
 * `src/lib/book-history.ts` reads, and what `initiated_by` already lives on).
 *
 * WHY (issue #4336): the `jobs` ledger stamps every dispatch with `initiated_by`
 * (`user`, `script:queue-translations`, `bulk-translate-script`, …), which was enough
 * to reconstruct 715 manually-processed books in 19 episodes — but the *reason* was
 * never captured at queue time, so each episode had to be inferred from what its
 * books had in common. Recoverable today, unrecoverable in a year.
 *
 * Usage in a queue script:
 *
 *   import { parseInitiatedReason } from '../lib/initiated-reason.mjs';
 *   const REASON = parseInitiatedReason(args, 'script:queue-translations');
 *   // ...
 *   await db.collection('jobs').insertOne({
 *     ...,
 *     initiated_by: 'script:queue-translations',
 *     ...initiatedReasonFields(REASON),
 *   });
 *
 * Warns (never fails) when omitted: a missing reason must not stop an operator
 * from queueing work at 2am. The nudge is the point, not a gate.
 */

/**
 * Read `--reason="..."` (or `--reason ...`) out of an argv slice.
 *
 * @param {string[]} args - `process.argv.slice(2)`
 * @param {string} initiatedBy - the `initiated_by` value the caller writes, used in the warning
 * @returns {string|undefined} the trimmed reason, or undefined when absent/blank
 */
export function parseInitiatedReason(args, initiatedBy) {
  let raw;
  const inline = args.find(a => a.startsWith('--reason='));
  if (inline) {
    raw = inline.slice('--reason='.length);
  } else {
    const idx = args.indexOf('--reason');
    if (idx >= 0) raw = args[idx + 1];
  }

  // A following flag is not a reason — `--reason --dry-run` means the value is missing.
  if (raw && raw.startsWith('--')) raw = undefined;

  const reason = raw?.trim();
  if (!reason) {
    console.warn(
      `WARNING: no --reason="..." given. Jobs will record initiated_by="${initiatedBy}" with no\n` +
      `         reason, and why this batch was run by hand will not be recoverable later (#4336).`
    );
    return undefined;
  }
  return reason;
}

/**
 * Spread into a job document. Omits the key entirely when there is no reason, so
 * absent stays absent rather than becoming an empty string.
 *
 * @param {string|undefined} reason
 * @returns {{initiated_reason?: string}}
 */
export function initiatedReasonFields(reason) {
  return reason ? { initiated_reason: reason } : {};
}
