#!/usr/bin/env node

/**
 * Migrate the orphan `hide_reason` column off `books` (#3969, family 2).
 *
 * `hide_reason` (500 docs as of 2026-08-13) was written by a dedup sweep whose
 * script is not in git history. Zero call sites read it. Canonical field is
 * `hidden_reason` (prior incident #3099). The cohort splits by whether the
 * verdict was ever enforced:
 *
 *   ENFORCED   (hidden:true or visible:false)  — copy the verdict into
 *              `hidden_reason` where that is absent, then $unset hide_reason.
 *   UNENFORCED (visible:true, ~81 docs)        — the book is publicly visible
 *              and carries no unhide provenance, so the verdict has unknown
 *              standing. Do NOT hide (never derive a destructive flag from
 *              unverified data; duplicate-vs-edition is a subtle call, see
 *              edition-identity.md). Preserve the verdict as a sweep_log ROW
 *              for re-adjudication, then $unset the column.
 *
 * Every touched book gets a row in `sweep_log` (scripts/lib/sweep-log.mjs)
 * recording the original value — the column is removed, the information is not.
 * This script NEVER writes `visible`, `hidden`, or flips any flag (#3099).
 *
 * Nothing reads `sweep_log` (by design), and the only automated readers of
 * `hidden_reason` are takedown-respect guards, for which a dedup reason on an
 * already-hidden book is accurate and protective — so this migration actuates
 * nothing ("ingest is actuation" check, 2026-08-08).
 *
 * Dry-run by default; pass --apply to write.
 */

import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import 'dotenv/config';

const SWEEP = 'hide-reason-column-migration-2026-08';

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    mongoUri: process.env.MONGODB_URI || process.env.MONGODB_URL || '',
    dbName: process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore',
  };
}

async function main() {
  const { apply, mongoUri, dbName } = parseArgs(process.argv);
  if (!mongoUri) throw new Error('Missing Mongo URI. Set MONGODB_URI');

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(dbName);
  const books = db.collection('books');

  console.log(`Migrate hide_reason → hidden_reason + sweep_log rows`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}  DB: ${dbName}  sweep: ${SWEEP}`);

  const cohort = await books
    .find(
      { hide_reason: { $exists: true } },
      { projection: { _id: 0, id: 1, hide_reason: 1, hidden_reason: 1, hidden: 1, visible: 1 } }
    )
    .toArray();

  const enforced = cohort.filter((b) => b.visible !== true);
  const unenforced = cohort.filter((b) => b.visible === true);
  const needsBackfill = enforced.filter((b) => !b.hidden_reason);

  console.log(`cohort=${cohort.length}  enforced=${enforced.length} (backfill hidden_reason on ${needsBackfill.length})  unenforced-visible=${unenforced.length}`);

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to migrate.');
    await client.close();
    return;
  }

  let rows = 0;
  let backfilled = 0;
  let unset = 0;

  for (const b of cohort) {
    const isEnforced = b.visible !== true;
    await recordSweepAction(db, {
      sweep: SWEEP,
      book_id: b.id,
      action: isEnforced ? 'verdict-migrated-to-hidden-reason' : 'unenforced-verdict-preserved',
      detail: {
        hide_reason: b.hide_reason,
        had_hidden_reason: Boolean(b.hidden_reason),
        state: { hidden: b.hidden ?? null, visible: b.visible ?? null },
      },
    });
    rows += 1;

    if (isEnforced && !b.hidden_reason) {
      const r = await books.updateOne(
        { id: b.id, hidden_reason: { $in: [null, undefined] } },
        { $set: { hidden_reason: b.hide_reason } }
      );
      backfilled += r.modifiedCount;
    }

    const u = await books.updateOne({ id: b.id }, { $unset: { hide_reason: '' } });
    unset += u.modifiedCount;
  }

  const residual = await books.countDocuments({ hide_reason: { $exists: true } });
  console.log(`\nsweep_log rows written : ${rows}`);
  console.log(`hidden_reason backfilled: ${backfilled}`);
  console.log(`hide_reason unset       : ${unset}`);
  console.log(`residual hide_reason    : ${residual} ${residual === 0 ? '(clean)' : '(!! investigate)'}`);
  console.log(`\nUnenforced verdicts (visible books) are preserved in sweep_log`);
  console.log(`(sweep='${SWEEP}', action='unenforced-verdict-preserved') for re-adjudication`);
  console.log(`by the edition/duplicate machinery — do not bulk-hide off them.`);
  await client.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
