/**
 * Row-shaped sweep logging — the alternative to writing a new COLUMN on `books`.
 *
 * WHY (issue #3969): maintenance sweeps historically recorded their verdicts by
 * stamping a new field on the `books` documents they touched — ~140 distinct
 * sweep-era fields accreted this way, including orphans like `hide_reason`
 * (500 production docs whose writer is not even in git history). A sweep that
 * wants to record "I did X to book Y" should write a ROW here instead:
 *
 *   await recordSweepAction(db, {
 *     sweep: 'dedup-2026-08',
 *     book_id: '66f0...',
 *     action: 'hidden-as-duplicate',
 *     detail: { kept: '66f1...', reason: 'same edition_key' },
 *   });
 *
 * Rows land in the `sweep_log` collection, stamped with timestamp + the
 * basename of the running script. Query by book_id or by sweep name.
 *
 * DELIBERATELY separate from `audit_log` (src/lib/audit-logger.ts): audit_log
 * feeds the user-facing book history timeline, so writing there would let a
 * bulk sweep actuate something readers see ("ingest is actuation", #3776).
 * Nothing user-facing reads `sweep_log`; the timeline can opt in later,
 * deliberately, per action type.
 *
 * Dependency-free by design: the caller passes its already-connected `db`
 * (a MongoClient.db() handle), so this works from any script without pulling
 * in a driver or config of its own.
 */

import { basename } from 'node:path';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Insert one sweep-action row into `sweep_log`. Throws on invalid input —
 * a sweep should fail loudly, not write junk.
 *
 * @param {import('mongodb').Db} db - connected Mongo db handle (caller owns the client)
 * @param {object} entry
 * @param {string} entry.sweep - kebab-case sweep name, e.g. 'dedup-2026-08' (required)
 * @param {string} entry.book_id - the book this action touched (required)
 * @param {string} entry.action - what was done, e.g. 'hidden-as-duplicate' (required)
 * @param {object|string} [entry.detail] - free-form context: plain object or string
 * @returns {Promise<object>} the inserted row (driver adds `_id` in place)
 */
export async function recordSweepAction(db, { sweep, book_id, action, detail } = {}) {
  if (!db || typeof db.collection !== 'function') {
    throw new TypeError('recordSweepAction: first argument must be a connected Mongo db handle');
  }
  if (typeof sweep !== 'string' || !KEBAB_CASE.test(sweep)) {
    throw new TypeError(
      `recordSweepAction: 'sweep' must be a kebab-case string (e.g. 'dedup-2026-08'), got ${JSON.stringify(sweep)}`
    );
  }
  if (typeof book_id !== 'string' || book_id.length === 0) {
    throw new TypeError(`recordSweepAction: 'book_id' must be a non-empty string, got ${JSON.stringify(book_id)}`);
  }
  if (typeof action !== 'string' || action.length === 0) {
    throw new TypeError(`recordSweepAction: 'action' must be a non-empty string, got ${JSON.stringify(action)}`);
  }
  if (detail !== undefined && typeof detail !== 'string' && !isPlainObject(detail)) {
    throw new TypeError(
      `recordSweepAction: 'detail' must be a plain object or string when provided, got ${Object.prototype.toString.call(detail)}`
    );
  }

  const row = {
    timestamp: new Date(),
    sweep,
    book_id,
    action,
    ...(detail !== undefined ? { detail } : {}),
    script: basename(process.argv[1] || 'unknown'),
  };
  await db.collection('sweep_log').insertOne(row);
  return row;
}
