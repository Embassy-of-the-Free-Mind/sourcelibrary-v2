#!/usr/bin/env node
// Backfill feedback.channel ('mcp' | 'web') from the stored user_agent.
//
// The MCP server proxies submit_feedback to /api/feedback server-side with
// User-Agent "SourceLibrary-MCP/<version>", so the UA prefix identifies
// agent-submitted rows retroactively. Everything else (footer widget,
// translation-request prompt) is 'web'. Inserts set the field since 2026-08
// (src/app/api/feedback/route.ts); this is the one-time catch-up.
//
// Dry-run by default:
//   set -a; source .env.production.local; set +a
//   node scripts/maintenance/backfill-feedback-channel.mjs [--apply]

import { withMongo } from '../lib/mongo.mjs';

const APPLY = process.argv.includes('--apply');

await withMongo(async (db) => {
  const fb = db.collection('feedback');
  const mcpFilter = { channel: { $exists: false }, user_agent: { $regex: '^SourceLibrary-MCP' } };
  const webFilter = { channel: { $exists: false }, $or: [{ user_agent: { $not: { $regex: '^SourceLibrary-MCP' } } }, { user_agent: null }] };

  const [mcpN, webN, already] = await Promise.all([
    fb.countDocuments(mcpFilter),
    fb.countDocuments(webFilter),
    fb.countDocuments({ channel: { $exists: true } }),
  ]);
  console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'}: ${mcpN} rows → channel:'mcp', ${webN} rows → channel:'web' (${already} already have the field)`);
  if (!APPLY) { console.log('(add --apply to write)'); return; }

  const r1 = await fb.updateMany(mcpFilter, { $set: { channel: 'mcp' } });
  const r2 = await fb.updateMany(webFilter, { $set: { channel: 'web' } });
  console.log(`modified: mcp=${r1.modifiedCount}, web=${r2.modifiedCount}`);
  const remaining = await fb.countDocuments({ channel: { $exists: false } });
  console.log(`rows still without channel: ${remaining}${remaining ? '  ⚠ investigate' : ''}`);
}, { timeoutMs: 90000 });
