#!/usr/bin/env node
/**
 * Backfill `tenant_slug` / `surface` onto feedback rows written before the
 * route started tagging them (see src/app/api/feedback/route.ts).
 *
 * Old rows carry only the client-supplied `page`, so this is necessarily the
 * same heuristic the new code replaces. It is therefore DELIBERATELY TIMID:
 *
 *   - only rows whose `page` starts with `/catalog/` or `/catalogue`
 *   - MINUS `/catalog/scholar` and its children, which are a global-site route
 *     and the single known false positive of the old triage classifier
 *   - never touches a row that already has `tenant_slug`
 *   - anything ambiguous is left untagged rather than guessed
 *
 * Leaving a row untagged is cheap (it shows up under `?tenant=none` and can be
 * tagged by hand). Tagging a global row as BPH is not: it would show a
 * stranger's feedback to a partner's librarians.
 *
 * Rows are stamped `tenant_source: 'backfill-page-heuristic'` so a later pass
 * can find and revisit exactly what this script guessed at.
 *
 * Run (report, writes nothing):
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-feedback-tenant.mjs
 *
 * Apply:
 *   ... backfill-feedback-tenant.mjs --apply
 *
 * Options:
 *   --tenant <slug>   tenant to assign (default: bph)
 *   --limit N         cap the number of rows written, for a cautious first pass
 *   --apply           actually write; omitted = dry run
 */

import { withMongo } from '../lib/mongo.mjs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : null;
};
const has = (k) => process.argv.includes(k);

const APPLY = has('--apply');
const TENANT = arg('--tenant') || 'bph';
const LIMIT = Number(arg('--limit') || 0);

/** Global-site catalogue routes that must never be tagged as a partner's. */
const GLOBAL_CATALOG_PREFIXES = ['/catalog/scholar'];

function isGlobalCatalogPath(page) {
  return GLOBAL_CATALOG_PREFIXES.some((p) => page === p || page.startsWith(`${p}/`));
}

/** Mirrors deriveSurface() in src/lib/feedback-origin.ts for these paths. */
function surfaceForPage(page) {
  if (page === '/catalog' || page === '/catalogue') return 'catalog';
  if (page.startsWith('/catalog/') || page.startsWith('/catalogue/')) return 'catalog';
  return null;
}

await withMongo(async (db) => {
  const fb = db.collection('feedback');

  // Only rows that have never been tagged. `$exists: false` and an explicit
  // null both count as untagged — the route writes null for global rows.
  const untagged = {
    $or: [{ tenant_slug: { $exists: false } }, { tenant_slug: null }],
  };

  const totalUntagged = await fb.countDocuments(untagged);
  const candidates = await fb
    .find({
      ...untagged,
      page: { $regex: '^/catalogue?(/|$)' },
    })
    .project({ _id: 1, page: 1, created_at: 1, message: 1 })
    .sort({ created_at: 1 })
    .toArray();

  const eligible = [];
  const skipped = [];
  for (const row of candidates) {
    const page = row.page || '';
    if (isGlobalCatalogPath(page)) {
      skipped.push({ row, why: 'global-site catalogue route' });
      continue;
    }
    const surface = surfaceForPage(page);
    if (!surface) {
      skipped.push({ row, why: 'no surface derived' });
      continue;
    }
    eligible.push({ row, surface });
  }

  const toWrite = LIMIT > 0 ? eligible.slice(0, LIMIT) : eligible;

  console.log(`\nFeedback tenant backfill — ${APPLY ? 'APPLYING' : 'DRY RUN (no writes)'}`);
  console.log(`  tenant:            ${TENANT}`);
  console.log(`  untagged rows:     ${totalUntagged}`);
  console.log(`  matched /catalog*: ${candidates.length}`);
  console.log(`  eligible:          ${eligible.length}`);
  console.log(`  skipped:           ${skipped.length}`);
  if (LIMIT > 0) console.log(`  limited to:        ${toWrite.length}`);

  if (skipped.length) {
    console.log('\nSkipped (left untagged on purpose):');
    for (const { row, why } of skipped.slice(0, 20)) {
      console.log(`  ${row._id}  ${String(row.page).padEnd(34)}  ${why}`);
    }
    if (skipped.length > 20) console.log(`  … and ${skipped.length - 20} more`);
  }

  console.log('\nSample of what would be written:');
  for (const { row, surface } of toWrite.slice(0, 15)) {
    const when = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '??';
    const msg = String(row.message || '').replace(/\s+/g, ' ').slice(0, 48);
    console.log(`  ${when}  ${String(row.page).padEnd(30)} → ${TENANT}/${surface}  "${msg}"`);
  }
  if (toWrite.length > 15) console.log(`  … and ${toWrite.length - 15} more`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.\n');
    return;
  }

  let written = 0;
  for (const { row, surface } of toWrite) {
    const res = await fb.updateOne(
      { _id: row._id, ...untagged }, // re-assert untagged at write time
      {
        $set: {
          tenant_slug: TENANT,
          surface,
          tenant_source: 'backfill-page-heuristic',
          tenant_backfilled_at: new Date(),
        },
      }
    );
    written += res.modifiedCount;
  }

  console.log(`\nWrote ${written} of ${toWrite.length} rows.`);
  console.log(`Undo: db.feedback.updateMany({ tenant_source: 'backfill-page-heuristic' }, { $unset: { tenant_slug: '', surface: '', tenant_source: '', tenant_backfilled_at: '' } })\n`);
});
