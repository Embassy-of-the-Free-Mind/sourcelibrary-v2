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
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs \
 *     --tag chained-x --books id1,id2 --budget 10 --lanes translate-batch-chained --by "why"
 *     (--lanes: the envelope opens only for gates whose label starts with one of these —
 *      without it every scoped worker may spend it on these books)
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs \
 *     --tag embed-x --books id1,id2 --budget 15 --lanes embed-gemini --meter-endpoints worker/embed-gemini --by "why"
 *     (--meter-endpoints: the envelope's meter counts only usage rows with these endpoints —
 *      without it, every lane's spend on these books counts against it, #5729)
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs \
 *     --tag embed-sitewide-2026-10 --all-books --budget 40 --lanes embed-gemini --meter-endpoints worker/embed-gemini \
 *     --expires 2026-11-26 --by "why"
 *     (--all-books: a LANE-WIDE envelope, no book list, #7402 — its lanes dispatch UNSCOPED on every
 *      book while it has room, metered by endpoint alone since created_at. Refused without --lanes
 *      and --meter-endpoints, and with --books/--collection. It grants no pause bypass.)
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs --tag wellcome-2026-09 --remove --by "done"
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs --tag wellcome-2026-09 --extend 7 --by "why"
 *     (every envelope expires, #4599: expires_at = created + 14 days unless --expires <ISO date>
 *      sets it; --extend <days> pushes it out — from now, if it has already lapsed. An expired
 *      envelope is closed: no gate opens on it. Nothing else reopens one, not even --budget.)
 *   node --env-file=.env.production.local scripts/maintenance/set-scope.mjs --backfill-expiry [--apply] --by "why"
 *     (stamps expires_at = now + 14 days on every envelope that has none; dry run without --apply)
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
import { readScopeEnvelopes, getScopeSpendUsd, nextEnvelopeExpiry, envelopeShapeError, envelopeMeterIds, ENVELOPE_TTL_DAYS } from '../lib/spend-guard.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

await withMongo(async (db) => {
  const control = (await db.collection('system_config').findOne({ _id: 'processing_control' })) || {};
  const scopes = control.allow_scopes || {};

  if (flag('show')) {
    const tags = Object.keys(scopes);
    if (!tags.length) { console.log('No allow_scopes configured.'); return; }
    const envelopes = new Map(readScopeEnvelopes(control, { includeExpired: true }).map((e) => [e.tag, e]));
    for (const tag of tags) {
      const s = scopes[tag];
      const env = envelopes.get(tag);
      let spendNote = 'no envelope (pause-bypass only — does NOT open the spend dial)';
      if (env) {
        const ids = await envelopeMeterIds(db, env);
        const spend = env.misconfigured ? { usd: 0, rows: 0, meterError: null }
          : await getScopeSpendUsd(db, { ids, since: env.created_at, endpoints: env.meter_endpoints });
        const state = env.misconfigured ? `MISCONFIGURED (${env.misconfigured}) — closed`
          : env.expired ? 'EXPIRED (closed)'
          : spend.meterError ? `METER ERROR: ${spend.meterError}` : (spend.usd < env.budget_usd ? 'OPEN' : 'SPENT');
        const reach = env.all_books ? 'ALL BOOKS' : `${ids.length} books`;
        spendNote = `envelope $${spend.usd.toFixed(2)} / $${env.budget_usd.toFixed(2)} → ${state} (${reach}, ${spend.rows} usage rows${env.lanes ? `; lanes ${env.lanes.join(', ')}` : ''}${env.meter_endpoints ? `; metering only ${env.meter_endpoints.join(', ')}` : ''})`;
      }
      console.log(`${tag}${env?.all_books ? '  [LANE-WIDE: all books, unscoped dispatch for its lanes]' : ''}`);
      console.log(`  book_ids: ${(s.book_ids || []).length}  collections: ${(s.collections || []).join(', ') || '(none)'}`);
      console.log(`  created: ${s.created_at ? new Date(s.created_at).toISOString() : '(unknown)'} by ${s.created_by || '(unknown)'}`);
      if (env) {
        const exp = !env.expires_at ? '(none — run --backfill-expiry)'
          : Number.isNaN(env.expires_at.getTime()) ? `unparseable (${s.expires_at}) — treated as expired`
          : env.expires_at.toISOString();
        console.log(`  expires: ${exp}`);
      }
      console.log(`  ${spendNote}`);
    }
    return;
  }

  if (flag('backfill-expiry')) {
    // One-off for envelopes written before expires_at existed (#4599): each gets now + TTL, one
    // versioned write per tag touching only that tag's expires_at.
    const by = val('by');
    if (!by) { console.error('--by "who/why" is required for any change (the trail is the point)'); process.exit(1); }
    const now = new Date();
    const todo = readScopeEnvelopes(control, { now, includeExpired: true }).filter((e) => !e.expires_at);
    const expiresAt = nextEnvelopeExpiry({ now });
    console.log(`${todo.length} envelope(s) without expires_at → ${expiresAt.toISOString()} (now + ${ENVELOPE_TTL_DAYS} d)${flag('apply') ? '' : ' — DRY RUN, pass --apply to write'}`);
    for (const e of todo) {
      console.log(`  ${e.tag}  budget $${e.budget_usd}  created ${e.created_at ? e.created_at.toISOString() : '(unknown)'}`);
      if (flag('apply')) await updateConfigVersioned(db, 'processing_control', { $set: { [`allow_scopes.${e.tag}.expires_at`]: expiresAt } }, by);
    }
    if (flag('apply')) console.log('(prior state snapshotted to system_config_revisions, one revision per tag)');
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
  const allBooks = flag('all-books') || existing?.all_books === true;
  if (allBooks && (books || collection)) {
    console.error('--all-books cannot be combined with --books/--collection: a lane-wide envelope has no book list.'); process.exit(1);
  }
  if (!existing && !books && !collection && !allBooks) {
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
  if (val('lanes')) next.lanes = val('lanes').split(',').map((s) => s.trim()).filter(Boolean);
  else if (existing?.lanes) next.lanes = existing.lanes;
  if (val('meter-endpoints') && !next.lanes) {
    console.error('--meter-endpoints needs --lanes: an unlaned envelope can be spent by any worker, and a one-endpoint meter would not see them.'); process.exit(1);
  }
  if (val('meter-endpoints')) next.meter_endpoints = val('meter-endpoints').split(',').map((s) => s.trim()).filter(Boolean);
  else if (existing?.meter_endpoints) next.meter_endpoints = existing.meter_endpoints;
  if (allBooks) next.all_books = true;
  // A lane-wide envelope funds its lanes on every book (#7402): refuse it unless it is laned and
  // metered by endpoint, so it can never fund another worker or meter the whole site.
  const shapeError = envelopeShapeError(next);
  if (shapeError) {
    console.error(`Refused: ${shapeError}. --all-books needs --lanes and --meter-endpoints.`); process.exit(1);
  }
  if (budget != null) next.budget_usd = budget;
  else if (existing?.budget_usd != null) next.budget_usd = existing.budget_usd;
  const extendRaw = val('extend');
  if ((val('expires') || extendRaw != null) && next.budget_usd == null) {
    console.error('--expires/--extend apply to an envelope; this scope has no --budget.'); process.exit(1);
  }
  if (allBooks && next.budget_usd == null) {
    console.error('--all-books needs --budget: without an envelope it would grant nothing.'); process.exit(1);
  }
  if (next.budget_usd != null) {
    try {
      next.expires_at = nextEnvelopeExpiry({
        existing: existing?.expires_at ?? null,
        expires: val('expires'),
        extendDays: extendRaw != null ? Number(extendRaw) : null,
      });
    } catch (err) { console.error(`--expires/--extend: ${err.message}`); process.exit(1); }
  }

  await updateConfigVersioned(db, 'processing_control', { $set: { [`allow_scopes.${tag}`]: next } }, by);
  console.log(`${existing ? 'Updated' : 'Created'} scope '${tag}': ${next.book_ids.length} book_ids, collections [${next.collections.join(', ')}]${next.budget_usd != null ? `, envelope $${next.budget_usd}` : ' (no envelope — pause bypass only)'}${next.lanes ? `, envelope lanes [${next.lanes.join(', ')}]` : ''}${next.meter_endpoints ? `, metering only [${next.meter_endpoints.join(', ')}]` : ''}${next.all_books ? ' — LANE-WIDE: these lanes dispatch unscoped on every book' : ''}`);
  if (next.expires_at) {
    const lapsed = next.expires_at <= new Date();
    console.log(`Envelope expires ${next.expires_at.toISOString()}${lapsed ? ' — ALREADY EXPIRED, so it is CLOSED: pass --extend <days> to reopen it' : ''}`);
  }
  if (next.budget_usd != null) {
    console.log('Envelope spend is measured from created_at over both usage stores; monitor with scripts/audit/scope-progress.mjs --scope ' + tag);
  }
  console.log('(prior state snapshotted to system_config_revisions)');
});
