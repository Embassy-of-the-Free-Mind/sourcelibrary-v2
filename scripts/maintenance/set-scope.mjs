#!/usr/bin/env node
/**
 * set-scope — manage named allow_scopes entries, including budget envelopes (#4540).
 *
 * A scope names a set of books (ids and/or collections) that may run while the
 * line is otherwise stopped: past the global PAUSE (#2610), and — when the
 * scope carries a budget_usd envelope — past the closed daily spend dial, on
 * its own separately-measured ceiling. Removing the scope removes the
 * permission immediately.
 *
 * Writes are versioned (system_config_revisions) and touch ONLY this scope's
 * key — never the allow_scopes map as a whole. That is the multi-session rule:
 * ~10 concurrent sessions share this config, and whole-map writes have
 * clobbered other sessions' scopes before (2026-06-20).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs --show
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs \
 *     --tag wellcome-2026-09 --collection forum-of-conscience --budget 30 --by "derek: finish the 34"
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs \
 *     --tag repair-xyz --books id1,id2 --budget 5 --by "why"
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs --tag wellcome-2026-09 --budget 40 --by "top up"
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs --tag wellcome-2026-09 --remove --by "done"
 *
 * --books and --collection ADD to the existing scope (set union) — the safe
 * default for shared state (the 2026-06-20 clobber was a replace). To shrink
 * a scope, pass --replace-books with the complete new list. Collection-based
 * scopes grow implicitly too: membership resolves at every gate check, so
 * tagging a book into the collection adds it to the lane.
 *
 * Monitor with: scripts/audit/scope-progress.mjs --scope <tag>
 */

import { withMongo } from '../lib/mongo.mjs';
import { updateConfigVersioned } from '../lib/versioned-config.mjs';
import { readScopeEnvelopes, getScopeSpendUsd } from '../lib/spend-guard.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

await withMongo(async (db) => {
  const control = (await db.collection('system_config').findOne({ _id: 'processing_control' })) || {};
  const scopes = control.allow_scopes || {};

  if (flag('show')) {
    const tags = Object.keys(scopes);
    if (!tags.length) { console.log('No allow_scopes configured.'); return; }
    const envelopes = new Map(readScopeEnvelopes(control).map((e) => [e.tag, e]));
    for (const tag of tags) {
      const s = scopes[tag];
      const env = envelopes.get(tag);
      let spendNote = 'no envelope (pause-bypass only — does NOT open the spend dial)';
      if (env) {
        const ids = new Set((s.book_ids || []).map(String));
        if (env.collections.length) {
          const rows = await db.collection('books').find({ collections: { $in: env.collections } }).project({ id: 1 }).toArray();
          for (const b of rows) ids.add(String(b.id));
        }
        const spend = await getScopeSpendUsd(db, { ids: [...ids], since: env.created_at });
        const state = spend.meterError ? `METER ERROR: ${spend.meterError}` : (spend.usd < env.budget_usd ? 'OPEN' : 'SPENT');
        spendNote = `envelope $${spend.usd.toFixed(2)} / $${env.budget_usd.toFixed(2)} → ${state} (${ids.size} books, ${spend.rows} usage rows)`;
      }
      console.log(`${tag}`);
      console.log(`  book_ids: ${(s.book_ids || []).length}  collections: ${(s.collections || []).join(', ') || '(none)'}`);
      console.log(`  created: ${s.created_at ? new Date(s.created_at).toISOString() : '(unknown)'} by ${s.created_by || '(unknown)'}`);
      console.log(`  ${spendNote}`);
    }
    return;
  }

  const tag = val('tag');
  const by = val('by');
  if (!tag) { console.error('--tag <name> is required (or --show)'); process.exit(1); }
  if (!/^[a-zA-Z0-9_-]+$/.test(tag)) { console.error('--tag must be [a-zA-Z0-9_-]+ (it becomes a Mongo field name)'); process.exit(1); }
  if (!by) { console.error('--by "who/why" is required for any change (the trail is the point)'); process.exit(1); }

  if (flag('remove')) {
    if (!scopes[tag]) { console.error(`No scope '${tag}' to remove.`); process.exit(1); }
    await updateConfigVersioned(db, 'processing_control', { $unset: { [`allow_scopes.${tag}`]: '' } }, by);
    console.log(`Removed scope '${tag}' — its pause bypass and any envelope are gone immediately.`);
    return;
  }

  const existing = scopes[tag] || null;
  const books = val('books') ? val('books').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const collection = val('collection');
  const budgetRaw = val('budget');
  const budget = budgetRaw != null ? Number(budgetRaw) : null;
  if (budgetRaw != null && (!Number.isFinite(budget) || budget <= 0)) {
    console.error('--budget must be a positive number of USD'); process.exit(1);
  }
  if (!existing && !books && !collection) {
    console.error(`Scope '${tag}' does not exist — creating one needs --books and/or --collection.`); process.exit(1);
  }
  if (flag('replace-books') && !books) {
    console.error('--replace-books needs --books with the complete new list.'); process.exit(1);
  }

  // Build the scope doc: on update, only the passed fields change; the
  // envelope's created_at is set once and never touched by a budget top-up
  // (envelope spend is measured from created_at — resetting it would forgive
  // spend already accounted). Book ids are UNIONED unless --replace-books.
  const nextBookIds = books
    ? (flag('replace-books') ? books : [...new Set([...(existing?.book_ids || []), ...books])])
    : existing?.book_ids ?? [];
  const next = {
    book_ids: nextBookIds,
    collections: collection ? [...new Set([...(existing?.collections || []), collection])] : (existing?.collections ?? []),
    created_at: existing?.created_at ?? new Date(),
    created_by: existing?.created_by ?? by,
    updated_at: new Date(),
    updated_by: by,
  };
  if (budget != null) next.budget_usd = budget;
  else if (existing?.budget_usd != null) next.budget_usd = existing.budget_usd;

  await updateConfigVersioned(db, 'processing_control', { $set: { [`allow_scopes.${tag}`]: next } }, by);
  console.log(`${existing ? 'Updated' : 'Created'} scope '${tag}': ${next.book_ids.length} book_ids, collections [${next.collections.join(', ')}]${next.budget_usd != null ? `, envelope $${next.budget_usd}` : ' (no envelope — pause bypass only)'}`);
  if (next.budget_usd != null) {
    console.log('Envelope spend is measured from created_at over both usage stores; monitor with scripts/audit/scope-progress.mjs --scope ' + tag);
  }
  console.log('(prior state snapshotted to system_config_revisions)');
});
