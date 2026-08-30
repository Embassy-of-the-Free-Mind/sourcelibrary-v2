#!/usr/bin/env node
/**
 * set-dial — THE versioned lever for the pipeline's spend/pause state.
 *
 * Replaces raw one-liner $sets on processing_control (which have a history of
 * clobbering concurrent state and leaving no trail). Every change snapshots
 * the prior doc to system_config_revisions via versioned-config.mjs.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/set-dial.mjs --show
 *   node --env-file=.env.production.local scripts/maintenance/set-dial.mjs --budget 15 --by "derek: scale up"
 *   node --env-file=.env.production.local scripts/maintenance/set-dial.mjs --pause  --by "reason"
 *   node --env-file=.env.production.local scripts/maintenance/set-dial.mjs --resume --by "reason"
 *   node --env-file=.env.production.local scripts/maintenance/set-dial.mjs --history        # last 10 changes
 */

import { withMongo } from '../lib/mongo.mjs';
import { setProcessingControl } from '../lib/versioned-config.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

await withMongo(async (db) => {
  if (flag('history')) {
    const rows = await db.collection('system_config_revisions')
      .find({ config_id: 'processing_control' }).sort({ created_at: -1 }).limit(10).toArray();
    for (const r of rows) {
      console.log(`${r.created_at.toISOString()}  by ${r.changed_by}`);
      console.log(`  change: ${JSON.stringify(r.change)}`);
      console.log(`  prior:  paused=${r.prior?.paused} budget=$${r.prior?.daily_budget_usd ?? 'unset'}`);
    }
    return;
  }

  const show = async (label) => {
    const c = await db.collection('system_config').findOne({ _id: 'processing_control' });
    console.log(`${label}: paused=${c?.paused} daily_budget_usd=$${c?.daily_budget_usd ?? 'unset'}`);
  };

  if (flag('show')) return show('current');

  const by = val('by');
  if (!by) { console.error('--by "who/why" is required for any change (the trail is the point)'); process.exit(1); }

  const fields = {};
  if (val('budget') != null) {
    const b = Number(val('budget'));
    if (!Number.isFinite(b) || b < 0) { console.error('--budget must be a number >= 0'); process.exit(1); }
    fields.daily_budget_usd = b;
  }
  if (flag('pause')) fields.paused = true;
  if (flag('resume')) fields.paused = false;
  if (Object.keys(fields).length === 0) { console.error('nothing to change — pass --budget/--pause/--resume'); process.exit(1); }

  await show('before');
  await setProcessingControl(db, fields, by);
  await show('after ');
  console.log('(prior state snapshotted to system_config_revisions — see --history)');
});
